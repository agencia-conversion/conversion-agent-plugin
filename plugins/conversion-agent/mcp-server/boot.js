#!/usr/bin/env node
/**
 * Legacy MCP server boot shim.
 *
 * Plugin runtime now points directly at dist/index.js with a self-contained
 * bundle. This file remains only for older local invocations that still call
 * boot.js. It never installs packages or reaches a registry.
 *
 * Node stdlib only. Must run on Node 20+.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "dist");
const ENTRY = join(DIST, "index.js");

function logErr(msg) {
  // stdout is reserved for JSON-RPC; diagnostics go to stderr.
  process.stderr.write(`[conversion-skills mcp boot] ${msg}\n`);
}

function main() {
  if (!existsSync(ENTRY)) {
    logErr(`dist/index.js not found at ${ENTRY}. Plugin is broken.`);
    process.exit(1);
  }

  const child = spawn(process.execPath, [ENTRY], {
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code) => process.exit(code ?? 0));
  child.on("error", (err) => {
    logErr(`Failed to spawn MCP server: ${err.message}`);
    process.exit(1);
  });
  const shutdown = (sig) => () => child.kill(sig);
  process.on("SIGINT", shutdown("SIGINT"));
  process.on("SIGTERM", shutdown("SIGTERM"));
}

main();
