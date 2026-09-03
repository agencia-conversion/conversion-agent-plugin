import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, readdir, rename, rm, stat, writeFile, } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
const VERSION = "0.1.0";
const DEFAULT_STALE_MS = 45_000;
const defaultFileSystem = {
    link,
    mkdir,
    readFile,
    readdir,
    rename,
    rm,
    stat,
    writeFile,
};
async function readJson(fileSystem, path) {
    try {
        return JSON.parse(await fileSystem.readFile(path, "utf8"));
    }
    catch {
        return null;
    }
}
async function pathExists(fileSystem, path) {
    try {
        await fileSystem.stat(path);
        return true;
    }
    catch {
        return false;
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
function isActive(metadata, staleMs) {
    if (!metadata)
        return false;
    const heartbeatMs = Date.parse(metadata.heartbeatAt);
    const heartbeatFresh = Number.isFinite(heartbeatMs) && Date.now() - heartbeatMs < staleMs;
    return isProcessAlive(metadata.pid) || heartbeatFresh;
}
async function readBusinessLock(fileSystem, dir) {
    const owner = await readJson(fileSystem, join(dir, "owner.json"));
    if (!owner)
        return null;
    const heartbeat = await readJson(fileSystem, join(dir, "heartbeat.json"));
    if (heartbeat?.ownerId === owner.ownerId &&
        typeof heartbeat?.heartbeatAt === "string") {
        return { ...owner, heartbeatAt: heartbeat.heartbeatAt };
    }
    return owner;
}
async function writeJson(fileSystem, path, value) {
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
        await fileSystem.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
        await fileSystem.rename(temporary, path);
    }
    catch (error) {
        await fileSystem.rm(temporary, { force: true }).catch(() => undefined);
        throw error;
    }
}
async function readGuardSnapshot(fileSystem, guardDir) {
    let mtimeMs = null;
    try {
        mtimeMs = (await fileSystem.stat(guardDir)).mtimeMs;
    }
    catch {
        // The guard disappeared before inspection.
    }
    try {
        const raw = await fileSystem.readFile(join(guardDir, "owner.json"), "utf8");
        try {
            return { raw, metadata: JSON.parse(raw), mtimeMs };
        }
        catch {
            return { raw, metadata: null, mtimeMs };
        }
    }
    catch {
        return { raw: null, metadata: null, mtimeMs };
    }
}
function guardIsActive(snapshot, staleMs) {
    if (snapshot.metadata) {
        const startedMs = Date.parse(snapshot.metadata.startedAt);
        const fresh = Number.isFinite(startedMs) && Date.now() - startedMs < staleMs;
        return isProcessAlive(snapshot.metadata.pid) || fresh;
    }
    return snapshot.mtimeMs !== null && Date.now() - snapshot.mtimeMs < staleMs;
}
function guardSnapshotMatches(left, right) {
    return left.raw === right.raw && left.mtimeMs === right.mtimeMs;
}
async function waitForGuardRetry() {
    await new Promise((resolve) => setTimeout(resolve, 2));
}
function isAlreadyExists(error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
function recoveryActivePath(guardDir) {
    return `${guardDir}.recovery-active.json`;
}
function recoveryClaimPath(guardDir, claimId) {
    return `${guardDir}.recovery-${claimId}.json`;
}
function recoveredGuardPath(guardDir, claimId) {
    return `${guardDir}.recovered-${claimId}`;
}
async function readRecoverySnapshot(fileSystem, path) {
    let mtimeMs = null;
    try {
        mtimeMs = (await fileSystem.stat(path)).mtimeMs;
    }
    catch {
        return { raw: null, metadata: null, mtimeMs: null };
    }
    try {
        const raw = await fileSystem.readFile(path, "utf8");
        try {
            return { raw, metadata: JSON.parse(raw), mtimeMs };
        }
        catch {
            return { raw, metadata: null, mtimeMs };
        }
    }
    catch {
        return { raw: null, metadata: null, mtimeMs };
    }
}
function recoverySnapshotIsActive(snapshot, staleMs) {
    if (snapshot.metadata) {
        const startedMs = Date.parse(snapshot.metadata.startedAt);
        const fresh = Number.isFinite(startedMs) && Date.now() - startedMs < staleMs;
        return isProcessAlive(snapshot.metadata.pid) || fresh;
    }
    return snapshot.mtimeMs !== null && Date.now() - snapshot.mtimeMs < staleMs;
}
async function listRecoveryClaimPaths(fileSystem, guardDir) {
    const directory = dirname(guardDir);
    const prefix = `${basename(guardDir)}.recovery-`;
    const activeName = basename(recoveryActivePath(guardDir));
    let entries;
    try {
        entries = await fileSystem.readdir(directory);
    }
    catch {
        return [];
    }
    return entries
        .filter((entry) => entry !== activeName && entry.startsWith(prefix) && entry.endsWith(".json"))
        .map((entry) => join(directory, entry))
        .sort((left, right) => left.localeCompare(right));
}
async function cleanupAbandonedClaim(fileSystem, guardDir, path, metadata) {
    if (metadata) {
        await fileSystem.rm(recoveredGuardPath(guardDir, metadata.claimId), {
            recursive: true,
            force: true,
        });
    }
    await fileSystem.rm(path, { force: true });
}
async function listLiveRecoveryClaims(fileSystem, guardDir, staleMs) {
    const live = [];
    for (const path of await listRecoveryClaimPaths(fileSystem, guardDir)) {
        const snapshot = await readRecoverySnapshot(fileSystem, path);
        if (recoverySnapshotIsActive(snapshot, staleMs)) {
            live.push(path);
        }
        else {
            await cleanupAbandonedClaim(fileSystem, guardDir, path, snapshot.metadata);
        }
    }
    return live.sort((left, right) => left.localeCompare(right));
}
async function releaseRecoveryFence(fileSystem, guardDir, metadata) {
    const activePath = recoveryActivePath(guardDir);
    const releasePath = `${activePath}.release-${randomUUID()}`;
    try {
        await fileSystem.rename(activePath, releasePath);
    }
    catch {
        throw new Error("sync_lock_recovery_ownership_lost");
    }
    const current = await readRecoverySnapshot(fileSystem, releasePath);
    if (!current.metadata || current.metadata.claimId !== metadata.claimId) {
        try {
            await fileSystem.rename(releasePath, activePath);
        }
        catch {
            // Never overwrite a newer recovery owner.
        }
        throw new Error("sync_lock_recovery_ownership_lost");
    }
    await fileSystem.rm(releasePath, { force: true });
    await fileSystem.rm(recoveryClaimPath(guardDir, metadata.claimId), { force: true });
}
async function acquireRecoveryFence(fileSystem, guardDir, lockDir, staleMs) {
    const claimId = randomUUID();
    const metadata = {
        claimId,
        pid: process.pid,
        startedAt: new Date().toISOString(),
        lockDir,
    };
    const ownPath = recoveryClaimPath(guardDir, claimId);
    await writeJson(fileSystem, ownPath, metadata);
    const liveClaims = await listLiveRecoveryClaims(fileSystem, guardDir, staleMs);
    if (liveClaims[0] !== ownPath) {
        await fileSystem.rm(ownPath, { force: true });
        return null;
    }
    const activePath = recoveryActivePath(guardDir);
    const active = await readRecoverySnapshot(fileSystem, activePath);
    if (active.mtimeMs !== null) {
        if (recoverySnapshotIsActive(active, staleMs)) {
            await fileSystem.rm(ownPath, { force: true });
            return null;
        }
        const abandonedPath = `${activePath}.abandoned-${randomUUID()}`;
        try {
            await fileSystem.rename(activePath, abandonedPath);
        }
        catch {
            await fileSystem.rm(ownPath, { force: true });
            return null;
        }
        const claimedActive = await readRecoverySnapshot(fileSystem, abandonedPath);
        if (claimedActive.raw !== active.raw ||
            claimedActive.mtimeMs !== active.mtimeMs ||
            recoverySnapshotIsActive(claimedActive, staleMs)) {
            try {
                await fileSystem.rename(abandonedPath, activePath);
            }
            catch {
                // A newer active recovery exists; preserve its unique predecessor.
            }
            await fileSystem.rm(ownPath, { force: true });
            return null;
        }
        await cleanupAbandonedClaim(fileSystem, guardDir, recoveryClaimPath(guardDir, claimedActive.metadata?.claimId ?? "unknown"), claimedActive.metadata);
        await fileSystem.rm(abandonedPath, { force: true });
    }
    const finalClaims = await listLiveRecoveryClaims(fileSystem, guardDir, staleMs);
    if (finalClaims[0] !== ownPath) {
        await fileSystem.rm(ownPath, { force: true });
        return null;
    }
    try {
        await fileSystem.link(ownPath, activePath);
    }
    catch {
        await fileSystem.rm(ownPath, { force: true });
        return null;
    }
    return {
        claimId,
        release: () => releaseRecoveryFence(fileSystem, guardDir, metadata),
    };
}
async function withRecoveryFence(fileSystem, guardDir, lockDir, staleMs, operation) {
    for (;;) {
        const fence = await acquireRecoveryFence(fileSystem, guardDir, lockDir, staleMs);
        if (!fence) {
            await waitForGuardRetry();
            continue;
        }
        try {
            return await operation(fence.claimId);
        }
        finally {
            await fence.release();
        }
    }
}
async function recoveryFenceIsClear(fileSystem, guardDir, lockDir, staleMs) {
    const active = await readRecoverySnapshot(fileSystem, recoveryActivePath(guardDir));
    if (active.mtimeMs !== null) {
        if (recoverySnapshotIsActive(active, staleMs))
            return false;
        const recovered = await acquireRecoveryFence(fileSystem, guardDir, lockDir, staleMs);
        if (recovered)
            await recovered.release();
        return false;
    }
    return (await listLiveRecoveryClaims(fileSystem, guardDir, staleMs)).length === 0;
}
async function releaseGuard(fileSystem, guardDir, lockDir, staleMs, ownerId) {
    await withRecoveryFence(fileSystem, guardDir, lockDir, staleMs, async () => {
        const claimDir = `${guardDir}.release-${process.pid}-${randomUUID()}`;
        for (;;) {
            try {
                await fileSystem.rename(guardDir, claimDir);
                break;
            }
            catch {
                const stillOwned = await readJson(fileSystem, join(guardDir, "owner.json"));
                if (!stillOwned || stillOwned.ownerId !== ownerId) {
                    throw new Error("sync_lock_guard_ownership_lost");
                }
                await waitForGuardRetry();
            }
        }
        const current = await readJson(fileSystem, join(claimDir, "owner.json"));
        if (!current || current.ownerId !== ownerId) {
            try {
                await fileSystem.rename(claimDir, guardDir);
            }
            catch {
                // Never overwrite a newer guard owner.
            }
            throw new Error("sync_lock_guard_ownership_lost");
        }
        await fileSystem.rm(claimDir, { recursive: true, force: true });
    });
}
async function recoverStaleGuard(fileSystem, guardDir, lockDir, staleMs) {
    return withRecoveryFence(fileSystem, guardDir, lockDir, staleMs, async (claimId) => {
        const observed = await readGuardSnapshot(fileSystem, guardDir);
        if (guardIsActive(observed, staleMs))
            return null;
        const movedPath = recoveredGuardPath(guardDir, claimId);
        try {
            await fileSystem.rename(guardDir, movedPath);
        }
        catch {
            return null;
        }
        const moved = await readGuardSnapshot(fileSystem, movedPath);
        if (guardSnapshotMatches(observed, moved) && !guardIsActive(moved, staleMs)) {
            await fileSystem.rm(movedPath, { recursive: true, force: true });
            const metadata = makeGuardMetadata(lockDir);
            await fileSystem.mkdir(guardDir);
            try {
                await writeJson(fileSystem, join(guardDir, "owner.json"), metadata);
            }
            catch (error) {
                await fileSystem.rm(guardDir, { recursive: true, force: true });
                throw error;
            }
            return metadata;
        }
        try {
            await fileSystem.rename(movedPath, guardDir);
        }
        catch {
            // The recovery fence prevents a normal replacement; preserve unexpected state.
        }
        return null;
    });
}
function makeGuardMetadata(lockDir) {
    return {
        ownerId: randomUUID(),
        pid: process.pid,
        startedAt: new Date().toISOString(),
        lockDir,
    };
}
async function acquireGuard(fileSystem, lockDir, staleMs) {
    const guardDir = `${lockDir}.guard`;
    for (;;) {
        if (!(await recoveryFenceIsClear(fileSystem, guardDir, lockDir, staleMs))) {
            await waitForGuardRetry();
            continue;
        }
        const metadata = makeGuardMetadata(lockDir);
        try {
            await fileSystem.mkdir(guardDir);
        }
        catch (error) {
            if (!isAlreadyExists(error))
                throw error;
            const recovered = await recoverStaleGuard(fileSystem, guardDir, lockDir, staleMs);
            if (recovered) {
                return {
                    release: () => releaseGuard(fileSystem, guardDir, lockDir, staleMs, recovered.ownerId),
                };
            }
            await waitForGuardRetry();
            continue;
        }
        try {
            await writeJson(fileSystem, join(guardDir, "owner.json"), metadata);
        }
        catch (error) {
            await fileSystem.rm(guardDir, { recursive: true, force: true });
            throw error;
        }
        if (!(await recoveryFenceIsClear(fileSystem, guardDir, lockDir, staleMs))) {
            await releaseGuard(fileSystem, guardDir, lockDir, staleMs, metadata.ownerId);
            await waitForGuardRetry();
            continue;
        }
        return {
            release: () => releaseGuard(fileSystem, guardDir, lockDir, staleMs, metadata.ownerId),
        };
    }
}
function makeHandle(fileSystem, dir, metadata, staleMs) {
    return {
        dir,
        metadata,
        async heartbeat() {
            const guard = await acquireGuard(fileSystem, dir, staleMs);
            try {
                const current = await readJson(fileSystem, join(dir, "owner.json"));
                if (!current || current.ownerId !== metadata.ownerId) {
                    throw new Error("sync_lock_ownership_lost");
                }
                await writeJson(fileSystem, join(dir, "heartbeat.json"), {
                    ownerId: metadata.ownerId,
                    heartbeatAt: new Date().toISOString(),
                });
            }
            finally {
                await guard.release();
            }
        },
        async release() {
            const guard = await acquireGuard(fileSystem, dir, staleMs);
            try {
                const current = await readJson(fileSystem, join(dir, "owner.json"));
                if (!current || current.ownerId !== metadata.ownerId) {
                    throw new Error("sync_lock_ownership_lost");
                }
                await fileSystem.rm(dir, { recursive: true, force: true });
            }
            finally {
                await guard.release();
            }
        },
    };
}
export async function acquireMonitorLock(input) {
    const fileSystem = input.fileSystem ?? defaultFileSystem;
    const staleMs = input.staleMs ?? DEFAULT_STALE_MS;
    const dir = join(input.projectDir, ".conversion", "sync", "project.lock");
    await fileSystem.mkdir(dirname(dir), { recursive: true });
    const guard = await acquireGuard(fileSystem, dir, staleMs);
    try {
        const exists = await pathExists(fileSystem, dir);
        const current = exists ? await readBusinessLock(fileSystem, dir) : null;
        if (current && isActive(current, staleMs))
            return null;
        if (exists)
            await fileSystem.rm(dir, { recursive: true, force: true });
        try {
            await fileSystem.mkdir(dir);
            const now = new Date().toISOString();
            const metadata = {
                ownerId: randomUUID(),
                pid: process.pid,
                startedAt: now,
                heartbeatAt: now,
                version: VERSION,
                projectDir: input.projectDir,
                hubRoot: input.hubRoot,
            };
            await writeJson(fileSystem, join(dir, "owner.json"), metadata);
            await writeJson(fileSystem, join(dir, "heartbeat.json"), {
                ownerId: metadata.ownerId,
                heartbeatAt: metadata.heartbeatAt,
            });
            return makeHandle(fileSystem, dir, metadata, staleMs);
        }
        catch (error) {
            await fileSystem.rm(dir, { recursive: true, force: true });
            throw error;
        }
    }
    finally {
        await guard.release();
    }
}
