import { appendFile, mkdir, readFile, rm, stat, writeFile, } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { readPluginAuth, reconcileSyncProject, } from "./engine.mjs";
const VERSION = "0.1.0";
const DEFAULT_INTERVAL_MS = 30_000;
const HEARTBEAT_MS = 10_000;
const STALE_LOCK_MS = 45_000;
const PROJECT_CONCURRENCY = 2;
const ACTIONABLE_EVENTS = new Set([
    "sync_ready",
    "sync_observe",
    "auth_required",
    "sync_conflict",
    "sync_error",
]);
const args = new Set(process.argv.slice(2));
const runOnce = args.has("--once");
const intervalMs = readNumberArg("--interval-ms", DEFAULT_INTERVAL_MS);
function readNumberArg(name, fallback) {
    const prefix = `${name}=`;
    const raw = process.argv.find((arg) => arg.startsWith(prefix));
    if (!raw)
        return fallback;
    const parsed = Number.parseInt(raw.slice(prefix.length), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function conversionHome() {
    return join(homedir(), ".conversion");
}
function logFilePath() {
    return join(conversionHome(), "logs", "sync-monitor.log");
}
async function log(level, message) {
    const file = logFilePath();
    await mkdir(dirname(file), { recursive: true });
    const line = JSON.stringify({
        ts: new Date().toISOString(),
        level,
        surface: "plugin-sync-monitor",
        version: VERSION,
        message: redact(message),
    });
    await appendFile(file, `${line}\n`, "utf8");
}
function redact(value) {
    return value
        .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [redacted]")
        .replace(/(authorization|x-renewed-token)\s*[:=]\s*[^\s,}]+/giu, "$1=[redacted]")
        .replace(/token=([A-Za-z0-9._~+/=-]+)/giu, "token=[redacted]")
        .replace(/([A-Z0-9._%+-]{2})[A-Z0-9._%+-]*@([A-Z0-9.-]+\.[A-Z]{2,})/giu, "$1***@$2");
}
function emit(event, payload = {}) {
    if (!ACTIONABLE_EVENTS.has(event))
        return;
    process.stdout.write(`${JSON.stringify({
        event,
        surface: "conversion-sync-monitor",
        version: VERSION,
        ...payload,
    })}\n`);
}
async function pathExists(path) {
    try {
        await stat(path);
        return true;
    }
    catch {
        return false;
    }
}
async function findHubRoot(startDir) {
    let current = resolve(startDir);
    for (;;) {
        if (await pathExists(join(current, ".conversion-hub.json")))
            return current;
        const parent = dirname(current);
        if (parent === current)
            return null;
        current = parent;
    }
}
async function readHubState(hubRoot) {
    if (!hubRoot) {
        return {
            hubRoot: null,
            projectCount: 0,
            activeProject: null,
            syncProjects: [],
        };
    }
    const raw = await readFile(join(hubRoot, ".conversion-hub.json"), "utf8");
    const parsed = JSON.parse(raw);
    const projects = Array.isArray(parsed.projects)
        ? parsed.projects
        : [];
    const active = parseActiveProject(parsed.active);
    return {
        hubRoot,
        projectCount: projects.length,
        activeProject: active,
        syncProjects: selectSyncProjects(hubRoot, projects, active),
    };
}
function parseActiveProject(active) {
    if (!active || typeof active !== "object")
        return null;
    const obj = active;
    if (typeof obj.ws_slug !== "string" || typeof obj.proj_slug !== "string") {
        return null;
    }
    return `${obj.ws_slug}/${obj.proj_slug}`;
}
function isMaterializedSyncProject(project) {
    return (typeof project.ws_slug === "string" &&
        typeof project.proj_slug === "string" &&
        typeof project.ws_id === "string" &&
        typeof project.proj_id === "string" &&
        typeof project.path === "string");
}
function projectAbsolutePath(hubRoot, projectPath) {
    return join(hubRoot, ...projectPath.split("/"));
}
function isWithinPath(candidate, parent) {
    const rel = relative(parent, candidate);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
function selectSyncProjects(hubRoot, projects, activeProject) {
    const projectDir = resolve(process.env["CLAUDE_PROJECT_DIR"] || process.cwd());
    const normalizedHub = resolve(hubRoot);
    const selected = [];
    for (const project of projects) {
        if (!isMaterializedSyncProject(project))
            continue;
        const absolutePath = resolve(projectAbsolutePath(hubRoot, project.path));
        const key = `${project.ws_slug}/${project.proj_slug}`;
        const openedHub = projectDir === normalizedHub;
        const openedProject = isWithinPath(projectDir, absolutePath);
        if (!openedHub && !openedProject)
            continue;
        selected.push({ ...project, absolutePath, key });
    }
    selected.sort((a, b) => {
        const activeA = a.key === activeProject ? 0 : 1;
        const activeB = b.key === activeProject ? 0 : 1;
        return activeA - activeB || a.key.localeCompare(b.key);
    });
    return selected;
}
function lockDir(projectDir, hubRoot) {
    void hubRoot;
    return join(projectDir, ".conversion", "sync", "project.lock");
}
async function readLockMetadata(dir) {
    try {
        const raw = await readFile(join(dir, "owner.json"), "utf8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
function isFreshLock(meta) {
    if (!meta)
        return false;
    const heartbeatMs = Date.parse(meta.heartbeatAt);
    if (!Number.isFinite(heartbeatMs))
        return false;
    return Date.now() - heartbeatMs < STALE_LOCK_MS && isProcessAlive(meta.pid);
}
async function writeLockMetadata(dir, projectDir, hubRoot) {
    const now = new Date().toISOString();
    const meta = {
        pid: process.pid,
        startedAt: now,
        heartbeatAt: now,
        version: VERSION,
        projectDir,
        hubRoot,
    };
    await writeFile(join(dir, "owner.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}
async function acquireLock(projectDir, hubRoot) {
    const dir = lockDir(projectDir, hubRoot);
    await mkdir(dirname(dir), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            await mkdir(dir);
            await writeLockMetadata(dir, projectDir, hubRoot);
            return dir;
        }
        catch {
            const meta = await readLockMetadata(dir);
            if (isFreshLock(meta))
                return null;
            await rm(dir, { recursive: true, force: true });
        }
    }
    return null;
}
async function releaseLock(dir) {
    await rm(dir, { recursive: true, force: true });
}
async function reconcileSelectedProject(input) {
    const { project, auth, lastObserveKeys } = input;
    const acquiredLock = await acquireLock(project.absolutePath, null);
    if (!acquiredLock) {
        await log("info", `project ${project.key} skipped: lock in use`);
        return;
    }
    const heartbeat = setInterval(() => {
        void writeLockMetadata(acquiredLock, project.absolutePath, null).catch((err) => {
            void log("warn", `lock heartbeat failed ${project.key}: ${String(err)}`);
        });
    }, HEARTBEAT_MS);
    try {
        const result = await reconcileSyncProject({
            projectRoot: project.absolutePath,
            project,
            auth,
        });
        if (result.status === "ok") {
            const pendingUpload = result.plan.upload.length;
            const pendingDownload = result.plan.download.length + result.plan.deleteLocal.length;
            await log(result.mode === "observe" && pendingUpload + pendingDownload > 0 ? "warn" : "info", `project ${project.key} mode=${result.mode} plan=${result.plan.status} pendingUpload=${pendingUpload} pendingDownload=${pendingDownload} commit=${result.commitId ?? "none"}`);
            if (result.mode === "observe" && pendingUpload + pendingDownload > 0) {
                const observeKey = `${pendingUpload}:${pendingDownload}:${result.plan.upload.join(",")}:${result.plan.download.join(",")}:${result.plan.deleteLocal.join(",")}`;
                if (lastObserveKeys.get(project.key) !== observeKey) {
                    lastObserveKeys.set(project.key, observeKey);
                    emit("sync_observe", {
                        project: project.key,
                        pendingUpload,
                        pendingDownload,
                    });
                }
            }
            else {
                lastObserveKeys.delete(project.key);
            }
            return;
        }
        if (result.status === "skipped") {
            await log("info", `project ${project.key} skipped mode=${result.mode} reason=${result.reason}`);
            return;
        }
        if (result.status === "conflict") {
            emit("sync_conflict", {
                project: project.key,
                conflicts: result.conflicts.length,
                snapshot: result.snapshotDir,
            });
            await log("warn", `project ${project.key} conflict mode=${result.mode} conflicts=${result.conflicts.length} snapshot=${result.snapshotDir}`);
            return;
        }
        emit("sync_error", { project: project.key, code: "reconcile_failed" });
        await log("error", `reconcile ${project.key} failed: ${result.error}`);
    }
    finally {
        clearInterval(heartbeat);
        await releaseLock(acquiredLock);
    }
}
async function mapLimit(items, limit, fn) {
    let cursor = 0;
    const worker = async () => {
        for (;;) {
            const index = cursor;
            cursor += 1;
            const item = items[index];
            if (item === undefined)
                return;
            await fn(item);
        }
    };
    const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
    await Promise.all(workers);
}
async function run() {
    const projectDir = resolve(process.env["CLAUDE_PROJECT_DIR"] || process.cwd());
    let lastReadyKey = null;
    const lastAuthRequiredKeys = new Set();
    const lastObserveKeys = new Map();
    let stopped = false;
    let ticking = false;
    let finishLoop = null;
    const stop = () => {
        if (stopped)
            return;
        stopped = true;
        finishLoop?.();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    const tick = async () => {
        const hubRoot = await findHubRoot(projectDir);
        const state = await readHubState(hubRoot);
        await log("info", `tick hub=${state.hubRoot ? "present" : "missing"} projects=${state.projectCount} selected=${state.syncProjects.length}`);
        if (state.hubRoot && state.projectCount > 0) {
            const readyKey = `${state.hubRoot}:${state.projectCount}:${state.activeProject ?? ""}:${state.syncProjects.length}`;
            if (readyKey !== lastReadyKey) {
                lastReadyKey = readyKey;
                emit("sync_ready", {
                    projects: state.projectCount,
                    selected: state.syncProjects.length,
                    active: state.activeProject !== null,
                });
            }
        }
        if (!state.hubRoot || state.syncProjects.length === 0)
            return;
        const auth = await readPluginAuth();
        if (!auth) {
            for (const project of state.syncProjects) {
                if (lastAuthRequiredKeys.has(project.key))
                    continue;
                lastAuthRequiredKeys.add(project.key);
                emit("auth_required", { project: project.key });
            }
            return;
        }
        await mapLimit(state.syncProjects, PROJECT_CONCURRENCY, (project) => reconcileSelectedProject({
            project,
            auth,
            lastObserveKeys,
        }));
    };
    const guardedTick = async () => {
        if (ticking || stopped)
            return;
        ticking = true;
        try {
            await tick();
        }
        finally {
            ticking = false;
        }
    };
    try {
        await log("info", `started projectDir=${projectDir}`);
        await guardedTick();
        if (!runOnce) {
            await new Promise((resolvePromise) => {
                const timer = setInterval(() => {
                    void guardedTick().catch((err) => {
                        void log("error", `tick failed: ${String(err)}`);
                        emit("sync_error", { code: "tick_failed" });
                    });
                }, intervalMs);
                finishLoop = () => {
                    clearInterval(timer);
                    resolvePromise();
                };
            });
        }
    }
    catch (err) {
        await log("error", `startup failed: ${String(err)}`);
        emit("sync_error", { code: "startup_failed" });
        process.exitCode = 1;
    }
    finally {
        stopped = true;
    }
}
void run();
