#!/usr/bin/env node
/**
 * Executable entrypoint for the published MCP server package.
 *
 * The dist/index.js bundle gates its auto-start on argv[1] matching
 * /dist/index.js or /bin.js. We also import main and call it explicitly in
 * case argv[1] is rewritten by a package-manager wrapper.
 */
import { main } from "./dist/index.js";

main().catch((err) => {
  process.stderr.write(
    `[conversion-mcp bin] fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
