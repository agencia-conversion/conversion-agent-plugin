import { appendFile, mkdir, readFile, rm, stat, writeFile, } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { readPluginAuth, reconcileSyncProject, } from "./engine.mjs";
const VERSION = "0.1.0";
const DEFAULT_INTERVAL_MS = 30_000;
const HEARTBEAT_MS = 10_000;
const STALE_LOCK_MS = 45_000;
const ACTIONABLE_EVENTS = new Set([
    "sync_ready",
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
            syncProject: null,
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
        syncProject: selectSyncProject(hubRoot, projects),
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
function selectSyncProject(hubRoot, projects) {
    const projectDir = resolve(process.env["CLAUDE_PROJECT_DIR"] || process.cwd());
    for (const project of projects) {
        if (!isMaterializedSyncProject(project))
            continue;
        if (resolve(projectAbsolutePath(hubRoot, project.path)) === projectDir) {
            return project;
        }
    }
    return null;
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
async function run() {
    const projectDir = resolve(process.env["CLAUDE_PROJECT_DIR"] || process.cwd());
    const initialHubRoot = await findHubRoot(projectDir);
    const acquiredLock = await acquireLock(projectDir, initialHubRoot);
    if (!acquiredLock) {
        await log("info", `another sync monitor already owns ${initialHubRoot ?? projectDir}`);
        return;
    }
    let lastReadyKey = null;
    let lastAuthRequiredKey = null;
    let stopped = false;
    const heartbeat = setInterval(() => {
        void writeLockMetadata(acquiredLock, projectDir, initialHubRoot).catch((err) => {
            void log("warn", `lock heartbeat failed: ${String(err)}`);
        });
    }, HEARTBEAT_MS);
    const stop = async () => {
        if (stopped)
            return;
        stopped = true;
        clearInterval(heartbeat);
        await releaseLock(acquiredLock);
    };
    process.once("SIGINT", () => {
        void stop().finally(() => process.exit(0));
    });
    process.once("SIGTERM", () => {
        void stop().finally(() => process.exit(0));
    });
    const tick = async () => {
        const hubRoot = await findHubRoot(projectDir);
        const state = await readHubState(hubRoot);
        await log("info", `tick hub=${state.hubRoot ? "present" : "missing"} projects=${state.projectCount}`);
        if (state.hubRoot && state.projectCount > 0) {
            const readyKey = `${state.hubRoot}:${state.projectCount}:${state.activeProject ?? ""}`;
            if (readyKey !== lastReadyKey) {
                lastReadyKey = readyKey;
                emit("sync_ready", {
                    projects: state.projectCount,
                    active: state.activeProject !== null,
                });
            }
        }
        if (!state.hubRoot || !state.syncProject)
            return;
        const auth = await readPluginAuth();
        const projectKey = `${state.syncProject.ws_slug}/${state.syncProject.proj_slug}`;
        if (!auth) {
            if (lastAuthRequiredKey !== projectKey) {
                lastAuthRequiredKey = projectKey;
                emit("auth_required", { project: projectKey });
            }
            return;
        }
        const result = await reconcileSyncProject({
            projectRoot: projectDir,
            project: state.syncProject,
            auth,
        });
        if (result.status === "conflict") {
            emit("sync_conflict", {
                project: projectKey,
                conflicts: result.conflicts.length,
                snapshot: result.snapshotDir,
            });
        }
        else if (result.status === "error") {
            emit("sync_error", { project: projectKey, code: "reconcile_failed" });
            await log("error", `reconcile ${projectKey} failed: ${result.error}`);
        }
    };
    try {
        await log("info", `started projectDir=${projectDir}`);
        await tick();
        if (!runOnce) {
            await new Promise((resolvePromise) => {
                const timer = setInterval(() => {
                    void tick().catch((err) => {
                        void log("error", `tick failed: ${String(err)}`);
                        emit("sync_error", { code: "tick_failed" });
                    });
                }, intervalMs);
                const finish = () => {
                    clearInterval(timer);
                    resolvePromise();
                };
                process.once("SIGINT", finish);
                process.once("SIGTERM", finish);
            });
        }
    }
    catch (err) {
        await log("error", `startup failed: ${String(err)}`);
        emit("sync_error", { code: "startup_failed" });
        process.exitCode = 1;
    }
    finally {
        await stop();
    }
}
void run();
