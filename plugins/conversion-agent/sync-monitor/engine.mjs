import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, stat, unlink, writeFile, } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
const BACKEND_URL = (process.env["CONVERSION_BACKEND_URL"] ?? "https://agent.conversion.com.br").replace(/\/+$/u, "");
const ZERO_TREE_HASH = "0".repeat(64);
const PROXY_THRESHOLD_BYTES = 4 * 1024 * 1024;
const PATH_MAX_LENGTH = 512;
const PATH_MAX_DEPTH = 16;
const SEGMENT_REGEX = /^[A-Za-z0-9._-]+$/u;
const WINDOWS_RESERVED_NAMES = new Set([
    "con",
    "prn",
    "aux",
    "nul",
    "com1",
    "com2",
    "com3",
    "com4",
    "com5",
    "com6",
    "com7",
    "com8",
    "com9",
    "lpt1",
    "lpt2",
    "lpt3",
    "lpt4",
    "lpt5",
    "lpt6",
    "lpt7",
    "lpt8",
    "lpt9",
]);
const TEXT_APPLICATION_MIMES = new Set([
    "application/json",
    "application/ld+json",
    "application/xml",
    "application/xhtml+xml",
    "application/yaml",
    "application/x-yaml",
]);
const BYTE_ORDER_MARK = /\uFEFF/gu;
const ZERO_WIDTH_WATERMARK_FRAME = /\u200D[\u200B\u200C]{32}\u200D/gu;
const CANONICAL_PLUGIN_DATA_DIR = process.env["CONVERSION_PLUGIN_DATA_DIR"] ??
    join(homedir(), ".conversion", "plugin-data");
export function pluginDataDir() {
    return process.env["CLAUDE_PLUGIN_DATA"] ?? join(homedir(), ".conversion", "plugin-data");
}
export function pluginAuthPath() {
    return join(pluginDataDir(), "auth.json");
}
function canonicalPluginAuthPath() {
    return join(CANONICAL_PLUGIN_DATA_DIR, "auth.json");
}
function authPaths() {
    return [...new Set([pluginAuthPath(), canonicalPluginAuthPath()])];
}
export async function readPluginAuth() {
    for (const path of authPaths()) {
        try {
            const parsed = JSON.parse(await readFile(path, "utf8"));
            if (!isAuthFile(parsed))
                continue;
            return {
                email: parsed.email,
                token: parsed.access_token,
                expiresAt: parsed.expires_at,
            };
        }
        catch {
            // Try the next auth source.
        }
    }
    return null;
}
export async function reconcileSyncProject(input) {
    let mode;
    try {
        mode = await readRemoteSyncMode(input.auth);
        if (mode === "disabled") {
            await writeSyncStatus(input.projectRoot, {
                mode,
                paused: false,
                lastRunAt: new Date().toISOString(),
            });
            return { status: "skipped", mode, reason: "disabled" };
        }
        const existingStatus = await readSyncStatus(input.projectRoot);
        if (existingStatus?.paused) {
            return { status: "skipped", mode, reason: "paused" };
        }
        const manifest = await readManifest(input.projectRoot);
        if (!manifest) {
            await writeSyncStatus(input.projectRoot, {
                mode,
                paused: false,
                lastRunAt: new Date().toISOString(),
                lastError: "missing_manifest",
            });
            return { status: "skipped", mode, reason: "missing_manifest" };
        }
        const [local, remote] = await Promise.all([
            scanLocalFiles(input.projectRoot),
            getProjectHead(input.auth, input.project),
        ]);
        const remoteTree = remote.head?.treeJson ?? {};
        const remoteCommitId = remote.head?.commitId ?? null;
        const remoteTreeHash = remote.head?.treeHash ?? computeTreeHash(remoteTree);
        const plan = reconcile({
            base: manifestToTree(manifest),
            local,
            remote: remoteTree,
        });
        if (plan.status === "conflict") {
            const snapshotDir = await writeConflictSnapshot({
                auth: input.auth,
                workspaceId: input.project.ws_id,
                projectRoot: input.projectRoot,
                conflicts: plan.conflicts,
                local,
            });
            await writeSyncStatus(input.projectRoot, {
                mode,
                paused: true,
                lastRunAt: new Date().toISOString(),
                lastError: "conflict",
                conflicts: plan.conflicts,
                pendingUpload: plan.upload,
                pendingDownload: [...plan.download, ...plan.deleteLocal],
            });
            return { status: "conflict", mode, conflicts: plan.conflicts, snapshotDir };
        }
        if (mode === "observe") {
            await writeSyncStatus(input.projectRoot, {
                mode,
                paused: false,
                lastRunAt: new Date().toISOString(),
                pendingUpload: plan.upload,
                pendingDownload: [...plan.download, ...plan.deleteLocal],
            });
            return {
                status: "ok",
                mode,
                plan,
                commitId: manifest.commitId,
                treeHash: manifest.treeHash,
            };
        }
        if (plan.status === "clean") {
            await writeSyncStatus(input.projectRoot, {
                mode,
                paused: false,
                lastRunAt: new Date().toISOString(),
                pendingUpload: [],
                pendingDownload: [],
            });
            return {
                status: "ok",
                mode,
                plan,
                commitId: remoteCommitId,
                treeHash: remoteTreeHash,
            };
        }
        if (mode === "pull" || plan.status === "pull") {
            const remoteMeta = await applyRemoteToDisk({
                auth: input.auth,
                workspaceId: input.project.ws_id,
                projectRoot: input.projectRoot,
                plan,
                remoteTree,
            });
            await writeManifest(input.projectRoot, buildManifest({
                previous: manifest,
                commitId: remoteCommitId,
                treeHash: remoteTreeHash,
                nextTree: remoteTree,
                local,
                remoteMeta,
            }));
            await writeSyncStatus(input.projectRoot, {
                mode,
                paused: false,
                lastRunAt: new Date().toISOString(),
                pendingUpload: mode === "pull" ? plan.upload : [],
                pendingDownload: [],
            });
            return {
                status: "ok",
                mode,
                plan,
                commitId: remoteCommitId,
                treeHash: remoteTreeHash,
            };
        }
        await uploadLocalChanges({
            auth: input.auth,
            workspaceId: input.project.ws_id,
            local,
            uploadPaths: plan.upload,
        });
        const nextTreeHash = computeTreeHash(plan.nextTree);
        const commit = await pushCommit({
            auth: input.auth,
            project: input.project,
            parentCommitId: remoteCommitId,
            parentTreeHash: remoteCommitId ? remoteTreeHash : null,
            treeHash: nextTreeHash,
            tree: plan.nextTree,
            message: plan.status === "merge" ? "plugin sync merge" : "plugin sync local changes",
        });
        if (commit.status === "conflict") {
            const conflict = {
                path: ".",
                kind: "same-file",
                details: "server_head_changed",
            };
            const snapshotDir = await writeConflictSnapshot({
                auth: input.auth,
                workspaceId: input.project.ws_id,
                projectRoot: input.projectRoot,
                conflicts: [conflict],
                local,
            });
            await writeSyncStatus(input.projectRoot, {
                mode,
                paused: true,
                lastRunAt: new Date().toISOString(),
                lastError: "server_head_changed",
                conflicts: [conflict],
                pendingUpload: plan.upload,
                pendingDownload: [...plan.download, ...plan.deleteLocal],
            });
            return { status: "conflict", mode, conflicts: [conflict], snapshotDir };
        }
        const remoteMeta = await applyRemoteToDisk({
            auth: input.auth,
            workspaceId: input.project.ws_id,
            projectRoot: input.projectRoot,
            plan,
            remoteTree,
        });
        await writeManifest(input.projectRoot, buildManifest({
            previous: manifest,
            commitId: commit.commitId,
            treeHash: commit.treeHash,
            nextTree: plan.nextTree,
            local,
            remoteMeta,
        }));
        await writeSyncStatus(input.projectRoot, {
            mode,
            paused: false,
            lastRunAt: new Date().toISOString(),
            pendingUpload: [],
            pendingDownload: [],
        });
        return {
            status: "ok",
            mode,
            plan,
            commitId: commit.commitId,
            treeHash: commit.treeHash,
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await writeSyncStatus(input.projectRoot, {
            mode: mode ?? "observe",
            paused: false,
            lastRunAt: new Date().toISOString(),
            lastError: message,
        }).catch(() => undefined);
        return { status: "error", mode, error: message };
    }
}
async function readRemoteSyncMode(auth) {
    try {
        const body = await authedJson(auth, "/api/v1/sync/config", {
            method: "GET",
        });
        if (body.kill_switch === true)
            return "disabled";
        if (isSyncMode(body.mode))
            return body.mode;
    }
    catch {
        const envMode = process.env["CONVERSION_SYNC_MODE"];
        if (isSyncMode(envMode))
            return envMode;
    }
    const envMode = process.env["CONVERSION_SYNC_MODE"];
    return isSyncMode(envMode) ? envMode : "observe";
}
async function getProjectHead(auth, project) {
    return authedJson(auth, `/api/v1/ws/${project.ws_id}/projects/${project.proj_id}/head`, { method: "GET" });
}
async function uploadLocalChanges(input) {
    const seen = new Set();
    for (const path of input.uploadPaths) {
        const entry = input.local[path];
        if (!entry || seen.has(entry.sha256))
            continue;
        seen.add(entry.sha256);
        if (entry.content.byteLength > PROXY_THRESHOLD_BYTES) {
            throw new Error(`file_too_large_for_plugin_proxy:${path}`);
        }
        const body = await authedJson(input.auth, `/api/v1/ws/${input.workspaceId}/blobs`, {
            method: "POST",
            headers: {
                "content-type": entry.mime ?? "application/octet-stream",
                "content-length": String(entry.content.byteLength),
                accept: "application/json",
            },
            body: entry.content,
        });
        if (body.blob?.sha256 !== entry.sha256) {
            throw new Error(`blob_hash_mismatch:${path}:${entry.sha256}:${body.blob?.sha256 ?? "missing"}`);
        }
    }
}
async function pushCommit(input) {
    const clientCommitId = deterministicCommitId({
        projectId: input.project.proj_id,
        actorUserId: input.auth.email,
        syncClientId: "plugin-sync-monitor",
        parentCommitId: input.parentCommitId,
        parentTreeHash: input.parentTreeHash,
        treeHash: input.treeHash,
        message: input.message,
    });
    const response = await authedFetch(input.auth, `/api/v1/ws/${input.project.ws_id}/projects/${input.project.proj_id}/commits`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
            parent_tree_hash: input.parentTreeHash,
            parent_commit_id: input.parentCommitId,
            client_commit_id: clientCommitId,
            tree: input.tree,
            message: input.message,
        }),
    });
    const text = await response.text();
    if (response.status === 409) {
        let serverHead;
        try {
            serverHead = JSON.parse(text).server_head;
        }
        catch {
            serverHead = undefined;
        }
        return { status: "conflict", serverHead };
    }
    if (!response.ok)
        throw new Error(`commit_http_${response.status}:${text.slice(0, 200)}`);
    const body = JSON.parse(text);
    const commitId = body.commit?.id;
    const treeHash = body.commit?.treeHash;
    if (!commitId || !treeHash)
        throw new Error("commit_response_invalid");
    return { status: "ok", commitId, treeHash };
}
async function applyRemoteToDisk(input) {
    const remoteMeta = {};
    for (const path of input.plan.download) {
        const sha = input.remoteTree[path];
        if (!sha)
            continue;
        const blob = await downloadCanonicalBlob(input.auth, input.workspaceId, sha);
        await writeQuietMarker(input.projectRoot, {
            path,
            sha256: sha,
            reason: "download",
        });
        await atomicWriteBytes(join(input.projectRoot, path), blob.content);
        remoteMeta[path] = {
            sha256: sha,
            size: blob.content.byteLength,
            mime: blob.mime,
        };
    }
    for (const path of input.plan.deleteLocal) {
        await writeQuietMarker(input.projectRoot, {
            path,
            sha256: "",
            reason: "delete",
        });
        try {
            await unlink(join(input.projectRoot, path));
        }
        catch (err) {
            if (!isEnoent(err))
                throw err;
        }
    }
    return remoteMeta;
}
async function downloadCanonicalBlob(auth, workspaceId, sha) {
    const response = await authedFetch(auth, `/api/v1/ws/${workspaceId}/blobs/${sha}?variant=canonical-sync`, { method: "GET", headers: { accept: "*/*" } });
    if (!response.ok) {
        throw new Error(`blob_http_${response.status}:${sha.slice(0, 12)}`);
    }
    const content = new Uint8Array(await response.arrayBuffer());
    // Integrity gate: canonical-sync returns the blob's stored CAS bytes
    // byte-exact, so they MUST hash back to the requested sha. An older
    // backend (or a middlebox dropping ?variant=canonical-sync) would serve
    // the per-user WATERMARKED variant instead — the exact bytes that used to
    // mirror to disk and feed the phantom-commit pull loop. The scan-side
    // strip (canonicalizeContent) already neutralizes the markdown frame, but
    // this gate is the general backstop: it fails loudly (blob_hash_mismatch,
    // mirroring the upload guard) for anything the strip is not an exact
    // inverse of, instead of writing divergent bytes and looping next cycle.
    const actual = hashBytes(content);
    if (actual !== sha) {
        throw new Error(`blob_hash_mismatch:${sha.slice(0, 12)}:got_${actual.slice(0, 12)}:` +
            `backend_nao_devolveu_bytes_canonicos`);
    }
    return {
        content,
        mime: response.headers.get("content-type") ?? "application/octet-stream",
    };
}
async function authedJson(auth, path, init) {
    const response = await authedFetch(auth, path, init);
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`http_${response.status}:${path}:${text.slice(0, 200)}`);
    }
    return (text ? JSON.parse(text) : undefined);
}
async function authedFetch(auth, path, init) {
    const response = await fetch(`${BACKEND_URL}${path}`, {
        ...init,
        headers: {
            ...init.headers,
            authorization: `Bearer ${auth.token}`,
        },
    });
    const renewed = response.headers.get("x-renewed-token");
    if (renewed) {
        await savePluginAuth({
            email: auth.email,
            token: renewed,
            expiresAt: auth.expiresAt,
        }).catch(() => undefined);
        auth.token = renewed;
    }
    return response;
}
async function savePluginAuth(input) {
    const [primary, ...fallbacks] = authPaths();
    if (primary)
        await savePluginAuthAt(primary, input);
    for (const path of fallbacks) {
        await savePluginAuthAt(path, input).catch(() => undefined);
    }
}
async function savePluginAuthAt(path, input) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await chmod(dirname(path), 0o700).catch(() => undefined);
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify({
        email: input.email,
        access_token: input.token,
        expires_at: input.expiresAt,
        updated_at: new Date().toISOString(),
    }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(tmp, 0o600).catch(() => undefined);
    await renameWithRetry(tmp, path);
}
async function readManifest(projectRoot) {
    try {
        const parsed = JSON.parse(await readFile(join(projectRoot, ".conversion", "manifest.json"), "utf8"));
        return isManifest(parsed) ? parsed : null;
    }
    catch {
        return null;
    }
}
async function writeManifest(projectRoot, manifest) {
    await atomicWriteJson(join(projectRoot, ".conversion", "manifest.json"), manifest);
}
async function readSyncStatus(projectRoot) {
    try {
        return JSON.parse(await readFile(join(projectRoot, ".conversion", "sync", "status.json"), "utf8"));
    }
    catch {
        return null;
    }
}
async function writeSyncStatus(projectRoot, status) {
    await atomicWriteJson(join(projectRoot, ".conversion", "sync", "status.json"), {
        ...status,
        updatedAt: status.updatedAt ?? new Date().toISOString(),
    });
}
async function writeQuietMarker(projectRoot, marker) {
    const reason = validateSyncPath(marker.path);
    if (reason)
        throw new Error(`invalid_path:${reason}:${marker.path}`);
    await atomicWriteJson(join(projectRoot, ".conversion", "sync", "quiet", `${hashText(marker.path)}.json`), {
        ...marker,
        createdAt: new Date().toISOString(),
    });
}
async function writeConflictSnapshot(input) {
    const firstPath = input.conflicts[0]?.path ?? "conflict";
    const id = `${new Date().toISOString().replace(/[:.]/gu, "-")}-${hashText(firstPath).slice(0, 8)}`;
    const dir = join(input.projectRoot, ".conversion", "sync", "snapshots", id);
    await mkdir(dir, { recursive: true });
    await atomicWriteJson(join(dir, "conflicts.json"), {
        createdAt: new Date().toISOString(),
        conflicts: input.conflicts,
    });
    for (const conflict of input.conflicts) {
        if (conflict.localSha && input.local[conflict.path]) {
            await atomicWriteBytes(join(dir, "local", conflict.path), input.local[conflict.path].content);
        }
        if (conflict.baseSha) {
            const blob = await downloadCanonicalBlob(input.auth, input.workspaceId, conflict.baseSha).catch(() => null);
            if (blob)
                await atomicWriteBytes(join(dir, "base", conflict.path), blob.content);
        }
        if (conflict.remoteSha) {
            const blob = await downloadCanonicalBlob(input.auth, input.workspaceId, conflict.remoteSha).catch(() => null);
            if (blob)
                await atomicWriteBytes(join(dir, "remote", conflict.path), blob.content);
        }
    }
    return dir;
}
async function scanLocalFiles(projectRoot) {
    const files = {};
    await scanDirectory(projectRoot, projectRoot, files);
    const collision = caseCollisionConflicts(Object.keys(files))[0];
    if (collision) {
        throw new Error(`case_collision:${collision.details ?? collision.path}`);
    }
    return files;
}
async function scanDirectory(root, dir, out) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.name === ".conversion" || entry.name === ".git" || entry.name === "node_modules") {
            continue;
        }
        const absolute = join(dir, entry.name);
        if (entry.isDirectory()) {
            await scanDirectory(root, absolute, out);
            continue;
        }
        if (!entry.isFile())
            continue;
        const rel = normalizeRelativePath(relative(root, absolute));
        const reason = validateSyncPath(rel);
        if (reason)
            throw new Error(`invalid_path:${reason}:${rel}`);
        const raw = new Uint8Array(await readFile(absolute));
        const mime = inferMime(rel);
        const content = canonicalizeContent(raw, mime);
        const fileStat = await stat(absolute);
        out[rel] = {
            sha256: hashBytes(content),
            size: fileStat.size,
            mime,
            content,
        };
    }
}
function reconcile(input) {
    const localTree = localToTree(input.local);
    const allPaths = sortedUnion(Object.keys(input.base), Object.keys(localTree), Object.keys(input.remote));
    const conflicts = [
        ...validatePathSet("base", Object.keys(input.base)),
        ...validatePathSet("local", Object.keys(localTree)),
        ...validatePathSet("remote", Object.keys(input.remote)),
        ...caseCollisionConflicts(allPaths),
    ];
    const conflictKeys = new Set(conflicts.map((c) => `${c.kind}:${c.path}`));
    const nextTree = {};
    const upload = [];
    const download = [];
    const deleteLocal = [];
    let remoteChanged = false;
    let localChanged = false;
    for (const path of allPaths) {
        const baseSha = input.base[path];
        const localSha = localTree[path];
        const remoteSha = input.remote[path];
        const localTouched = localSha !== baseSha;
        const remoteTouched = remoteSha !== baseSha;
        if (localTouched)
            localChanged = true;
        if (remoteTouched)
            remoteChanged = true;
        if (localTouched && remoteTouched && localSha !== remoteSha) {
            const kind = localSha === undefined || remoteSha === undefined
                ? "delete-vs-edit"
                : "same-file";
            const key = `${kind}:${path}`;
            if (!conflictKeys.has(key)) {
                conflicts.push({ path, kind, baseSha, localSha, remoteSha });
                conflictKeys.add(key);
            }
            if (localSha !== undefined)
                nextTree[path] = localSha;
            continue;
        }
        const chosenSha = localTouched ? localSha : remoteSha;
        if (chosenSha !== undefined)
            nextTree[path] = chosenSha;
        if (!localTouched && remoteTouched) {
            if (remoteSha === undefined)
                deleteLocal.push(path);
            else
                download.push(path);
        }
        if (localTouched && !remoteTouched && localSha !== undefined) {
            upload.push(path);
        }
    }
    upload.sort();
    download.sort();
    deleteLocal.sort();
    conflicts.sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind));
    return {
        status: statusFor({ conflicts, upload, download, deleteLocal }),
        nextTree,
        upload,
        download,
        deleteLocal,
        conflicts,
        remoteChanged,
        localChanged,
    };
}
function manifestToTree(manifest) {
    const tree = {};
    for (const [path, meta] of Object.entries(manifest.files)) {
        tree[path] = meta.sha256;
    }
    return tree;
}
function localToTree(local) {
    const tree = {};
    for (const [path, meta] of Object.entries(local)) {
        tree[path] = meta.sha256;
    }
    return tree;
}
function buildManifest(input) {
    const files = {};
    for (const [path, sha256] of Object.entries(input.nextTree)) {
        const local = input.local[path];
        if (local && local.sha256 === sha256) {
            files[path] = {
                sha256,
                size: local.size,
                mime: local.mime,
            };
            continue;
        }
        const remote = input.remoteMeta[path];
        if (remote) {
            files[path] = remote;
            continue;
        }
        const previous = input.previous.files[path];
        if (previous?.sha256 === sha256) {
            files[path] = previous;
            continue;
        }
        files[path] = { sha256, size: 0, mime: "application/octet-stream" };
    }
    return {
        ...input.previous,
        treeHash: input.treeHash,
        commitId: input.commitId,
        updatedAt: new Date().toISOString(),
        files,
    };
}
function computeTreeHash(tree) {
    const keys = Object.keys(tree).sort();
    let json = "{";
    for (let i = 0; i < keys.length; i += 1) {
        const key = keys[i];
        if (i > 0)
            json += ",";
        json += JSON.stringify(key);
        json += ":";
        json += JSON.stringify(tree[key]);
    }
    json += "}";
    return createHash("sha256").update(json, "utf8").digest("hex");
}
function deterministicCommitId(input) {
    const hex = createHash("sha256")
        .update([
        "conversion-client-commit-v2",
        input.projectId,
        input.actorUserId,
        input.syncClientId,
        input.parentCommitId ?? "null",
        input.parentTreeHash ?? "null",
        input.treeHash,
        input.message ?? "",
    ].join("\0"))
        .digest("hex");
    const chars = hex.slice(0, 32).split("");
    chars[12] = "4";
    const variant = Number.parseInt(chars[16], 16);
    chars[16] = ((variant & 0x3) | 0x8).toString(16);
    const id = chars.join("");
    return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20, 32)}`;
}
function canonicalizeContent(input, mime) {
    if (!isTextMime(mime))
        return input;
    const withoutBom = input.length >= 3 && input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf
        ? input.subarray(3)
        : input;
    const decoded = new TextDecoder("utf-8").decode(withoutBom);
    const clean = isMarkdownMime(mime) ? stripMarkdownWatermark(decoded) : decoded;
    const lfOnly = clean.replace(/\r\n?/gu, "\n");
    const normalized = lfOnly.length > 0 ? lfOnly.replace(/\n+$/gu, "") + "\n" : lfOnly;
    return new TextEncoder().encode(normalized);
}
function stripMarkdownWatermark(text) {
    return text
        .replace(BYTE_ORDER_MARK, "")
        .replace(ZERO_WIDTH_WATERMARK_FRAME, "");
}
function isMarkdownMime(mime) {
    const lower = mime.toLowerCase().split(";")[0]?.trim() ?? "";
    return lower === "text/markdown" || lower === "text/x-markdown";
}
function isTextMime(mime) {
    const lower = mime.toLowerCase().split(";")[0]?.trim() ?? "";
    if (lower.startsWith("text/"))
        return true;
    return TEXT_APPLICATION_MIMES.has(lower);
}
function inferMime(path) {
    const lower = path.toLowerCase();
    if (lower.endsWith(".md") || lower.endsWith(".markdown"))
        return "text/markdown";
    if (lower.endsWith(".txt"))
        return "text/plain";
    if (lower.endsWith(".json"))
        return "application/json";
    if (lower.endsWith(".yml") || lower.endsWith(".yaml"))
        return "application/yaml";
    if (lower.endsWith(".html"))
        return "text/html";
    if (lower.endsWith(".css"))
        return "text/css";
    if (lower.endsWith(".csv"))
        return "text/csv";
    return "application/octet-stream";
}
function validateSyncPath(path) {
    if (path.length === 0)
        return "empty";
    if (path.length > PATH_MAX_LENGTH)
        return "too_long";
    if (path.includes("\0"))
        return "null_byte";
    if (path.includes("\\"))
        return "backslash";
    if (path.startsWith("/"))
        return "absolute";
    if (/^[A-Za-z]:/u.test(path))
        return "windows_drive";
    if (path.endsWith("/"))
        return "trailing_slash";
    if (path.includes("//"))
        return "empty_segment";
    const segments = path.split("/");
    if (segments.length > PATH_MAX_DEPTH)
        return "too_deep";
    for (const segment of segments) {
        if (segment === "." || segment === "..")
            return "dot_segment";
        if (segment.endsWith(".") || segment.endsWith(" ")) {
            return "windows_trailing_dot_or_space";
        }
        const stem = segment.split(".")[0].toLowerCase();
        if (WINDOWS_RESERVED_NAMES.has(stem))
            return "windows_reserved_name";
        if (!SEGMENT_REGEX.test(segment))
            return "invalid_segment";
    }
    return null;
}
function validatePathSet(source, paths) {
    const conflicts = [];
    for (const path of paths) {
        const reason = validateSyncPath(path);
        if (reason) {
            conflicts.push({
                path,
                kind: "invalid-path",
                details: `${source}:${reason}`,
            });
        }
    }
    return conflicts;
}
function caseCollisionConflicts(paths) {
    const byFolded = new Map();
    for (const path of paths) {
        const folded = path.normalize("NFC").toLocaleLowerCase("en-US");
        const list = byFolded.get(folded) ?? [];
        list.push(path);
        byFolded.set(folded, list);
    }
    const out = [];
    for (const pathsForKey of byFolded.values()) {
        const unique = Array.from(new Set(pathsForKey));
        if (unique.length <= 1)
            continue;
        for (const path of unique) {
            out.push({
                path,
                kind: "case-collision",
                details: unique.sort().join(" | "),
            });
        }
    }
    return out;
}
function statusFor(input) {
    if (input.conflicts.length > 0)
        return "conflict";
    const hasLocal = input.upload.length > 0;
    const hasRemote = input.download.length > 0 || input.deleteLocal.length > 0;
    if (hasLocal && hasRemote)
        return "merge";
    if (hasLocal)
        return "push";
    if (hasRemote)
        return "pull";
    return "clean";
}
async function atomicWriteJson(path, value) {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
    });
    await chmod(tmp, 0o600).catch(() => undefined);
    await renameWithRetry(tmp, path);
}
async function atomicWriteBytes(path, value) {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, value);
    await renameWithRetry(tmp, path);
}
async function renameWithRetry(src, dst) {
    const delays = [10, 25, 50, 100, 200];
    let lastErr;
    for (let attempt = 0; attempt <= delays.length; attempt += 1) {
        try {
            await rename(src, dst);
            return;
        }
        catch (err) {
            lastErr = err;
            if (!isTransientRenameError(err))
                throw err;
            if (attempt === delays.length)
                break;
            await sleep(delays[attempt]);
        }
    }
    throw lastErr;
}
function isTransientRenameError(err) {
    if (!err || typeof err !== "object")
        return false;
    const code = err.code;
    return code === "EPERM" || code === "EBUSY" || code === "EACCES";
}
function isAuthFile(value) {
    if (!value || typeof value !== "object")
        return false;
    const obj = value;
    return (typeof obj["email"] === "string" &&
        typeof obj["access_token"] === "string" &&
        (obj["expires_at"] === undefined || typeof obj["expires_at"] === "string"));
}
function isManifest(value) {
    if (!value || typeof value !== "object")
        return false;
    const obj = value;
    return (typeof obj["projectId"] === "string" &&
        typeof obj["workspaceId"] === "string" &&
        typeof obj["workspaceSlug"] === "string" &&
        typeof obj["projectSlug"] === "string" &&
        typeof obj["treeHash"] === "string" &&
        (obj["commitId"] === null || typeof obj["commitId"] === "string") &&
        typeof obj["updatedAt"] === "string" &&
        !!obj["files"] &&
        typeof obj["files"] === "object");
}
function isSyncMode(value) {
    return (value === "observe" ||
        value === "pull" ||
        value === "bidirectional" ||
        value === "disabled");
}
function sortedUnion(...sets) {
    return Array.from(new Set(sets.flat())).sort();
}
function normalizeRelativePath(path) {
    return sep === "/" ? path : path.split(sep).join("/");
}
function hashBytes(value) {
    return createHash("sha256").update(value).digest("hex");
}
function hashText(value) {
    return createHash("sha256").update(value, "utf8").digest("hex");
}
function isEnoent(err) {
    return (typeof err === "object" &&
        err !== null &&
        "code" in err &&
        err.code === "ENOENT");
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export const __test = {
    computeTreeHash,
    canonicalizeContent,
    inferMime,
    validateSyncPath,
    ZERO_TREE_HASH,
};
