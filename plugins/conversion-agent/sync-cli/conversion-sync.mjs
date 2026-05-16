#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_NAME = "conversion-agent";
const DEFAULT_BACKEND_URL = "https://agent.conversion.com.br";

const command = process.argv[2] && !process.argv[2].startsWith("-") ? process.argv[2] : "status";
const rawArgs = process.argv.slice(command === "status" && process.argv[2]?.startsWith("-") ? 2 : 3);
const flags = new Set(rawArgs.filter((arg) => arg.startsWith("--")));

function pluginRoot() {
  return resolve(
    process.env.CLAUDE_PLUGIN_ROOT ?? dirname(dirname(fileURLToPath(import.meta.url))),
  );
}

function conversionHome() {
  return join(homedir(), ".conversion");
}

function logFilePath() {
  return join(conversionHome(), "logs", "sync-monitor.log");
}

function flagValue(name, fallback = null) {
  const prefix = `${name}=`;
  const inline = rawArgs.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = rawArgs.indexOf(name);
  if (index >= 0) return rawArgs[index + 1] ?? fallback;
  return fallback;
}

function numberFlag(name, fallback) {
  const raw = flagValue(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function findHubRoot(startDir) {
  let current = resolve(startDir);
  for (;;) {
    if (await exists(join(current, ".conversion-hub.json"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function projectAbsolutePath(hubRoot, projectPath) {
  return join(hubRoot, ...projectPath.split("/"));
}

function isWithinPath(candidate, parent) {
  const rel = relative(parent, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function activeKey(active) {
  if (!active || typeof active !== "object") return null;
  if (typeof active.ws_slug !== "string" || typeof active.proj_slug !== "string") {
    return null;
  }
  return `${active.ws_slug}/${active.proj_slug}`;
}

function isMaterializedProject(project) {
  return (
    project &&
    typeof project === "object" &&
    typeof project.ws_slug === "string" &&
    typeof project.proj_slug === "string" &&
    typeof project.ws_id === "string" &&
    typeof project.proj_id === "string" &&
    typeof project.path === "string"
  );
}

function selectProjects(hubRoot, projects, active, projectDir) {
  const normalizedHub = resolve(hubRoot);
  const selected = [];
  for (const project of projects) {
    if (!isMaterializedProject(project)) continue;
    const absolutePath = resolve(projectAbsolutePath(hubRoot, project.path));
    const openedHub = projectDir === normalizedHub;
    const openedProject = isWithinPath(projectDir, absolutePath);
    if (!openedHub && !openedProject) continue;
    const key = `${project.ws_slug}/${project.proj_slug}`;
    selected.push({ ...project, key, absolutePath });
  }
  selected.sort((a, b) => {
    const activeA = a.key === active ? 0 : 1;
    const activeB = b.key === active ? 0 : 1;
    return activeA - activeB || a.key.localeCompare(b.key);
  });
  return selected;
}

async function inspectAuth() {
  const candidates = [
    process.env.CLAUDE_PLUGIN_DATA ? join(process.env.CLAUDE_PLUGIN_DATA, "auth.json") : null,
    join(process.env.CONVERSION_PLUGIN_DATA_DIR ?? join(conversionHome(), "plugin-data"), "auth.json"),
  ].filter(Boolean);

  for (const path of [...new Set(candidates)]) {
    const parsed = await readJson(path);
    if (
      parsed &&
      typeof parsed.email === "string" &&
      typeof parsed.access_token === "string"
    ) {
      return {
        authenticated: true,
        source: path,
        email: parsed.email,
        expiresAt: typeof parsed.expires_at === "string" ? parsed.expires_at : null,
        token: parsed.access_token,
      };
    }
  }
  return { authenticated: false, source: null, email: null, expiresAt: null, token: null };
}

async function readPluginVersion(path) {
  const parsed = await readJson(path);
  return typeof parsed?.version === "string" ? parsed.version : null;
}

async function readMarketplaceVersion(path) {
  const parsed = await readJson(path);
  const entry = parsed?.plugins?.find?.((plugin) => plugin.name === PLUGIN_NAME);
  return typeof entry?.version === "string" ? entry.version : null;
}

async function findMarketplaceVersion() {
  const explicitPath = process.env.CONVERSION_PLUGIN_MARKETPLACE_PATH;
  if (explicitPath) return readMarketplaceVersion(explicitPath);

  const root = join(homedir(), ".claude", "plugins", "marketplaces");
  let entries = [];
  try {
    entries = await readdir(root);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const version = await readMarketplaceVersion(
      join(root, entry, ".claude-plugin", "marketplace.json"),
    );
    if (version) return version;
  }
  return null;
}

function parseSemver(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value ?? "");
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function semverGreater(a, b) {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] > right[index]) return true;
    if (left[index] < right[index]) return false;
  }
  return false;
}

async function inspectPlugin() {
  const root = pluginRoot();
  const installedVersion = await readPluginVersion(join(root, ".claude-plugin", "plugin.json"));
  const expectedVersion = await findMarketplaceVersion();
  return {
    root,
    installedVersion,
    expectedVersion,
    stale: semverGreater(expectedVersion, installedVersion),
  };
}

async function inspectProject(project) {
  const [statusJson, lockJson, manifestExists] = await Promise.all([
    readJson(join(project.absolutePath, ".conversion", "sync", "status.json")),
    readJson(join(project.absolutePath, ".conversion", "sync", "project.lock", "owner.json")),
    exists(join(project.absolutePath, ".conversion", "manifest.json")),
  ]);
  return {
    key: project.key,
    path: project.absolutePath,
    manifestExists,
    lock: lockJson
      ? {
          pid: lockJson.pid ?? null,
          version: lockJson.version ?? null,
          heartbeatAt: lockJson.heartbeatAt ?? null,
        }
      : null,
    status: statusJson,
  };
}

async function fetchRemoteConfig(auth) {
  if (!auth.authenticated || !auth.token) return null;
  const backendUrl = (process.env.CONVERSION_BACKEND_URL ?? DEFAULT_BACKEND_URL).replace(/\/+$/, "");
  try {
    const res = await fetch(`${backendUrl}/api/v1/sync/config`, {
      headers: { authorization: `Bearer ${auth.token}`, accept: "application/json" },
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: null, error: err instanceof Error ? err.message : String(err) };
  }
}

async function readLogLines(lines) {
  try {
    const raw = await readFile(logFilePath(), "utf8");
    return raw.trimEnd().split("\n").slice(-lines);
  } catch {
    return [];
  }
}

async function inspect({ includeRemoteConfig = false, includeLogs = false, lines = 30 } = {}) {
  const cwd = resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const [plugin, auth] = await Promise.all([inspectPlugin(), inspectAuth()]);
  const hubRoot = await findHubRoot(cwd);
  const hubConfig = hubRoot ? await readJson(join(hubRoot, ".conversion-hub.json")) : null;
  const projects = Array.isArray(hubConfig?.projects) ? hubConfig.projects : [];
  const active = activeKey(hubConfig?.active);
  const selected = hubRoot ? selectProjects(hubRoot, projects, active, cwd) : [];
  const projectDetails = await Promise.all(selected.map((project) => inspectProject(project)));
  const legacyHubLock =
    hubRoot && (await exists(join(hubRoot, ".conversion", "sync", "project.lock", "owner.json")))
      ? await readJson(join(hubRoot, ".conversion", "sync", "project.lock", "owner.json"))
      : null;
  const remoteConfig = includeRemoteConfig ? await fetchRemoteConfig(auth) : null;
  const warnings = [];

  if (!hubRoot) warnings.push("not_in_conversion_hub");
  if (hubRoot && projects.length > 0 && selected.length === 0) warnings.push("no_selected_project");
  if (plugin.stale) warnings.push("stale_plugin");
  if (legacyHubLock) warnings.push("legacy_hub_lock_present");
  if (remoteConfig?.body?.mode === "observe") warnings.push("remote_mode_observe");
  for (const project of projectDetails) {
    if (!project.manifestExists) warnings.push(`missing_manifest:${project.key}`);
    if (project.status?.paused) warnings.push(`paused:${project.key}`);
    if (project.status?.lastError) warnings.push(`last_error:${project.key}:${project.status.lastError}`);
  }

  return {
    ok: true,
    cwd,
    plugin,
    auth: {
      authenticated: auth.authenticated,
      source: auth.source,
      email: auth.email,
      expiresAt: auth.expiresAt,
    },
    hub: hubRoot
      ? {
          root: hubRoot,
          projectCount: projects.length,
          activeProject: active,
          selectedCount: selected.length,
          selectedProjects: selected.map((project) => project.key),
        }
      : null,
    remoteConfig,
    projects: projectDetails,
    legacyHubLock,
    warnings,
    ...(includeLogs ? { logs: await readLogLines(lines) } : {}),
  };
}

function printHumanStatus(state) {
  console.log("Conversion sync status");
  console.log(`cwd: ${state.cwd}`);
  console.log(
    `plugin: installed=${state.plugin.installedVersion ?? "unknown"} expected=${state.plugin.expectedVersion ?? "unknown"} stale=${state.plugin.stale}`,
  );
  console.log(
    `auth: ${state.auth.authenticated ? `ok ${state.auth.email} (${state.auth.source})` : "missing"}`,
  );
  if (!state.hub) {
    console.log("hub: missing");
  } else {
    console.log(
      `hub: ${state.hub.root} projects=${state.hub.projectCount} selected=${state.hub.selectedCount} active=${state.hub.activeProject ?? "none"}`,
    );
  }
  if (state.remoteConfig) {
    const mode = state.remoteConfig.body?.mode ?? "unknown";
    const killSwitch = state.remoteConfig.body?.kill_switch ?? "unknown";
    console.log(`remote: mode=${mode} kill_switch=${killSwitch}`);
  }
  for (const project of state.projects) {
    const status = project.status;
    console.log(`project: ${project.key}`);
    console.log(`  path: ${project.path}`);
    console.log(`  manifest: ${project.manifestExists ? "present" : "missing"}`);
    console.log(
      `  status: mode=${status?.mode ?? "unknown"} paused=${status?.paused ?? "unknown"} pendingUpload=${status?.pendingUpload?.length ?? 0} pendingDownload=${status?.pendingDownload?.length ?? 0} lastRunAt=${status?.lastRunAt ?? "never"}`,
    );
  }
  if (state.warnings.length > 0) {
    console.log(`warnings: ${state.warnings.join(", ")}`);
  }
}

async function runOnce({ dryRun }) {
  if (dryRun) {
    const state = await inspect({ includeRemoteConfig: true, includeLogs: true });
    if (flags.has("--json")) console.log(JSON.stringify(state, null, 2));
    else printHumanStatus(state);
    return 0;
  }

  const boot = join(pluginRoot(), "sync-monitor", "boot.mjs");
  return new Promise((resolveExit) => {
    const child = spawn(process.execPath, [boot, "--once"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    child.on("exit", (code) => resolveExit(code ?? 1));
    child.on("error", () => resolveExit(1));
  });
}

async function main() {
  if (flags.has("--help") || command === "help") {
    console.log("Usage: conversion-sync.mjs status|doctor|tail|once [--json] [--dry-run] [--lines=N]");
    return 0;
  }

  if (command === "tail") {
    const lines = await readLogLines(numberFlag("--lines", 50));
    if (flags.has("--json")) console.log(JSON.stringify({ ok: true, lines }, null, 2));
    else console.log(lines.join("\n"));
    return 0;
  }

  if (command === "once") {
    return runOnce({ dryRun: flags.has("--dry-run") });
  }

  if (command !== "status" && command !== "doctor") {
    console.error(`Unknown command: ${command}`);
    return 2;
  }

  const state = await inspect({
    includeRemoteConfig: command === "doctor",
    includeLogs: command === "doctor" || flags.has("--logs"),
    lines: numberFlag("--lines", 30),
  });
  if (flags.has("--json")) console.log(JSON.stringify(state, null, 2));
  else printHumanStatus(state);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
