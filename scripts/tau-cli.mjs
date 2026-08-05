#!/usr/bin/env node
/**
 * Tau CLI entry (`tau.cli.v1`). Loads TypeScript via a minimal Vite SSR server
 * (no React/Tailwind/HMR) so scripts share modules with Vitest.
 *
 * Usage: node scripts/tau-cli.mjs diagnose [--json] <file.asc>
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(here, "..", "apps", "desktop");
const require = createRequire(join(desktopRoot, "package.json"));
const { createServer } = require("vite");

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch (error) {
    throw new Error(`Failed to read stdin: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const server = await createServer({
  configFile: false,
  root: desktopRoot,
  resolve: {
    alias: { "@": join(desktopRoot, "src") },
  },
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: "custom",
  plugins: [],
  optimizeDeps: { noDiscovery: true, include: [] },
});

let exitCode = 1;
try {
  const mod = await server.ssrLoadModule("/src/cli/runTauCli.ts");
  const runTauCli = mod.runTauCli;
  if (typeof runTauCli !== "function") {
    throw new Error("runTauCli export missing from src/cli/runTauCli.ts");
  }
  const outcome = runTauCli(process.argv.slice(2), {
    readFile: (path) => readFileSync(path, "utf8"),
    readStdin,
    writeOut: (text) => {
      process.stdout.write(text);
    },
    writeErr: (text) => {
      process.stderr.write(text);
    },
  });
  exitCode = outcome.exitCode;
} finally {
  await server.close();
}
// Vite SSR can leave handles; force exit so the CLI is script-friendly.
process.exit(exitCode);
