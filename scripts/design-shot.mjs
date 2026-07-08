#!/usr/bin/env node
/**
 * design-shot.mjs — re-runnable screenshot pipeline for the §10 visual-design
 * overhaul (STEP 3.5 in AGENTS.md / CLAUDE.md).
 *
 * Every design commit must produce a screenshot that VISIBLY DIFFERS from the
 * one before it. This script captures a fixed set of named app states at a
 * fixed set of viewports so BEFORE/AFTER pairs are directly comparable and the
 * whole record is committed to git as proof.
 *
 * Usage:
 *   node scripts/design-shot.mjs [label]
 *   pnpm design:shot [label]        # from repo root
 *
 * `label` defaults to an ISO timestamp. Output goes to
 * `screenshots/<label>/<state>-<width>x<height>.png`.
 *
 * States captured:
 *   empty      — fresh app, blank scratchpad, schematic view.
 *   schematic  — the "RC Charging" example loaded, schematic view.
 *   inspector  — same circuit with the first component selected, so the
 *                bottom component-inspector (property grid, not its empty
 *                "no selection" state) is visible.
 *   simulator  — same circuit after clicking Run; simulator/scope view.
 *                Web mode has no Tauri/native ngspice bridge, but
 *                `runTransientAnalysis` (the TS fallback solver, see
 *                apps/desktop/src/engine/nativeSpice.ts:isNativeSpiceRuntime)
 *                still runs in-browser, so this should show REAL traces, not
 *                a degraded/error state. If it ever shows an error state in
 *                web mode, that's a regression worth flagging, not expected.
 *   dialog     — the settings panel open (gear icon in the toolbar).
 *   command    — the "Add component" command palette open (Cmd/Ctrl+K).
 *
 * Viewports: 1440x900 and 1280x720 (comfortable sizes) plus the app's real
 * minimum window size read from apps/desktop/src-tauri/tauri.conf.json
 * (minWidth x minHeight — currently 900x600) so the responsive floor
 * (FEATURE_PARITY §11) is provable too.
 */

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// Playwright is a devDependency of apps/desktop (not the workspace root), and
// pnpm's isolated node_modules layout means a bare `import "playwright"` from
// this root-level script would not resolve it. Resolve it explicitly relative
// to apps/desktop's own package.json (CJS require, not ESM import — ESM's
// static cjs-module-lexer interop doesn't reliably surface playwright's
// dynamically-assigned named exports) instead of hoisting a dependency the
// workspace root doesn't otherwise need.
const desktopRequire = createRequire(path.join(REPO_ROOT, "apps/desktop/package.json"));
const { chromium } = desktopRequire("playwright");
const DEV_URL = "http://localhost:1420";
const NAV_TIMEOUT_MS = 15_000;
const SERVER_READY_TIMEOUT_MS = 45_000;
const STATE_TIMEOUT_MS = 15_000;

const label = process.argv[2] ?? new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.join(REPO_ROOT, "screenshots", label);

function readViewports() {
  const viewports = [
    { name: "1440x900", width: 1440, height: 900 },
    { name: "1280x720", width: 1280, height: 720 },
  ];
  const confPath = path.join(REPO_ROOT, "apps/desktop/src-tauri/tauri.conf.json");
  let minWidth = 1100;
  let minHeight = 700;
  try {
    const conf = JSON.parse(readFileSync(confPath, "utf8"));
    const win = conf?.app?.windows?.[0];
    if (typeof win?.minWidth === "number") minWidth = win.minWidth;
    if (typeof win?.minHeight === "number") minHeight = win.minHeight;
  } catch {
    console.warn(`[design-shot] could not read minWidth/minHeight from ${confPath}, using ${minWidth}x${minHeight} fallback`);
  }
  viewports.push({ name: `${minWidth}x${minHeight}`, width: minWidth, height: minHeight });
  return viewports;
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok || res.status < 500) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function isServerUp(url) {
  try {
    const res = await fetch(url, { method: "GET" });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

/** Starts `pnpm dev:web` as its own process group so it (and any vite
 *  children) can be killed together on exit. No-ops if something is already
 *  listening on the dev port — that server is reused and left running. */
async function ensureDevServer() {
  if (await isServerUp(DEV_URL)) {
    console.log(`[design-shot] reusing already-running dev server at ${DEV_URL}`);
    return { child: null };
  }
  console.log(`[design-shot] starting dev server (pnpm dev:web)…`);
  const child = spawn("pnpm", ["dev:web"], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true, // own process group so we can kill vite's children too
  });
  let startupLog = "";
  child.stdout?.on("data", (d) => { startupLog += d.toString(); });
  child.stderr?.on("data", (d) => { startupLog += d.toString(); });
  child.on("error", (err) => {
    console.error(`[design-shot] failed to start dev server: ${err.message}`);
  });

  const ready = await waitForServer(DEV_URL, SERVER_READY_TIMEOUT_MS);
  if (!ready) {
    killProcessGroup(child);
    console.error(startupLog);
    throw new Error(`dev server did not respond at ${DEV_URL} within ${SERVER_READY_TIMEOUT_MS}ms`);
  }
  return { child };
}

function killProcessGroup(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  try {
    // Negative pid targets the whole process group created by `detached: true`.
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try { child.kill("SIGTERM"); } catch { /* already gone */ }
  }
}

async function shootViewport(page, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });

  // --- empty: fresh load, blank scratchpad -------------------------------
  await page.goto(DEV_URL, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
  await page.waitForSelector(".toolbar", { timeout: STATE_TIMEOUT_MS });
  await page.waitForSelector(".explorer-panel", { timeout: STATE_TIMEOUT_MS });
  await page.waitForTimeout(150); // settle animations/spring transitions
  await page.screenshot({ path: path.join(outDir, `empty-${viewport.name}.png`), fullPage: true });

  // --- schematic: load the RC Charging example ----------------------------
  const exampleButton = page.locator(".explorer-panel .tree-file").first();
  await exampleButton.waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  await exampleButton.click();
  await page.waitForSelector(".stage .component", { timeout: STATE_TIMEOUT_MS }).catch(() => {});
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(outDir, `schematic-${viewport.name}.png`), fullPage: true });

  // --- inspector: select a component so the property grid renders --------
  // Selection is resolved by geometric hit-testing on the canvas's own
  // pointerdown handler (world coordinates → component bounding boxes), not
  // by which DOM node paints on top at the exact pixel — so `force: true`
  // (skip Playwright's topmost-element check, which the background grid
  // rect can otherwise fail depending on where a symbol's stroke falls
  // inside its bounding box) is correct here, not a workaround.
  const firstComponent = page.locator(".stage .component").first();
  await firstComponent.click({ force: true });
  await page.waitForSelector(".inspector-summary:not(.empty)", { timeout: STATE_TIMEOUT_MS }).catch(() => {});
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outDir, `inspector-${viewport.name}.png`), fullPage: true });

  // --- simulator: click Run, switch to scope view -------------------------
  const runButton = page.locator('button[aria-label="Run simulation"]').first();
  await runButton.waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  await runButton.click();
  await page.waitForSelector(".app-simulator", { timeout: STATE_TIMEOUT_MS });
  // Web mode has no native ngspice bridge but the TS-fallback transient
  // solver still runs in-browser (see isNativeSpiceRuntime in
  // apps/desktop/src/engine/nativeSpice.ts) — wait for either a real trace or
  // a settled error/empty scope state, whichever the run produces.
  await page
    .waitForSelector(".scope-svg .scope-trace, .scope-shell", { timeout: STATE_TIMEOUT_MS })
    .catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, `simulator-${viewport.name}.png`), fullPage: true });

  // --- dialog: settings panel ----------------------------------------------
  const settingsButton = page.locator('button[aria-label="Settings"]').first();
  await settingsButton.click();
  await page.waitForSelector('.settings-panel[role="dialog"]', { timeout: STATE_TIMEOUT_MS });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outDir, `dialog-${viewport.name}.png`), fullPage: true });
  await page.locator('button[aria-label="Close settings"]').click();
  await page.waitForSelector('.settings-panel[role="dialog"]', { state: "detached", timeout: STATE_TIMEOUT_MS });

  // --- command: command palette --------------------------------------------
  // Drive it via the always-visible rail search button rather than the
  // Cmd/Ctrl+K shortcut: Chromium can swallow that combo as a browser-level
  // binding before it reaches the page's keydown listener.
  await page.locator('.activity-rail button[title="Search"]').click();
  await page.waitForSelector('.cmdk[role="dialog"]', { timeout: STATE_TIMEOUT_MS });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outDir, `command-${viewport.name}.png`), fullPage: true });
  await page.keyboard.press("Escape");
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const viewports = readViewports();
  console.log(`[design-shot] label=${label} viewports=${viewports.map((v) => v.name).join(", ")}`);

  const { child } = await ensureDevServer();
  let browser;
  let exitCode = 0;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(STATE_TIMEOUT_MS);

    for (const viewport of viewports) {
      console.log(`[design-shot] capturing viewport ${viewport.name}…`);
      await shootViewport(page, viewport);
    }
    console.log(`[design-shot] done. Screenshots written to ${path.relative(REPO_ROOT, outDir)}/`);
  } catch (error) {
    exitCode = 1;
    console.error(`[design-shot] FAILED: ${error instanceof Error ? error.message : error}`);
  } finally {
    if (browser) await browser.close();
    killProcessGroup(child);
  }
  process.exit(exitCode);
}

main();
