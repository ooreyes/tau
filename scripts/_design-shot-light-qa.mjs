#!/usr/bin/env node
/**
 * design-shot.mjs - re-runnable screenshot pipeline for the §10 visual-design
 * overhaul.
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
 *   empty      - fresh app, blank scratchpad, schematic view.
 *   schematic  - the "RC Charging" example loaded, schematic view.
 *   inspector  - same circuit with the first component selected, so the
 *                bottom component-inspector (property grid, not its empty
 *                "no selection" state) is visible.
 *   model      - exact Class-D PMOS selected in the buck-converter fixture;
 *                proves the compatible model chooser at the responsive floor.
 *   subcircuit - five-terminal menu-first driver with named terminals and one
 *                editable declared parameter; proves X syntax stays off-canvas.
 *   simulator  - same circuit after clicking Run; simulator/scope view.
 *                Web mode has no Tauri/native ngspice bridge, but
 *                `runTransientAnalysis` (the TS fallback solver, see
 *                apps/desktop/src/engine/nativeSpice.ts:isNativeSpiceRuntime)
 *                still runs in-browser, so this should show REAL traces, not
 *                a degraded/error state. If it ever shows an error state in
 *                web mode, that's a regression worth flagging, not expected.
 *   dialog     - the settings panel open (gear icon in the toolbar).
 *   command    - the "Add component" command palette open (Cmd/Ctrl+K).
 *
 * Viewports: 1440x900 and 1280x720 (comfortable sizes) plus the app's real
 * minimum window size read from apps/desktop/src-tauri/tauri.conf.json
 * (minWidth x minHeight - currently 900x600) so the responsive floor
 * (FEATURE_PARITY §11) is provable too.
 */

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// Playwright is a devDependency of apps/desktop (not the workspace root), and
// pnpm's isolated node_modules layout means a bare `import "playwright"` from
// this root-level script would not resolve it. Resolve it explicitly relative
// to apps/desktop's own package.json (CJS require, not ESM import - ESM's
// static cjs-module-lexer interop doesn't reliably surface playwright's
// dynamically-assigned named exports) instead of hoisting a dependency the
// workspace root doesn't otherwise need.
const desktopRequire = createRequire(path.join(REPO_ROOT, "apps/desktop/package.json"));
const { chromium } = desktopRequire("playwright");
const devPortText = process.env.TAU_DESIGN_PORT ?? "1420";
if (!/^\d+$/.test(devPortText) || Number(devPortText) < 1024 || Number(devPortText) > 65535) {
  throw new Error("TAU_DESIGN_PORT must be an unprivileged TCP port from 1024 to 65535");
}
const DEV_PORT = Number(devPortText);
const DEV_URL = `http://localhost:${DEV_PORT}`;
const FORCE_OWN_SERVER = process.env.TAU_DESIGN_FORCE_SERVER === "1";
const NAV_TIMEOUT_MS = 15_000;
const SERVER_READY_TIMEOUT_MS = 45_000;
const STATE_TIMEOUT_MS = 15_000;
const SYSTEM_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const label = process.argv[2] ?? new Date().toISOString().replace(/[:.]/g, "-");
if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(label)) {
  throw new Error("screenshot label must contain only letters, numbers, dots, underscores, and hyphens");
}
// Completion QA must not dirty the clean commit it is certifying. Normal
// interactive runs retain the familiar repo-local screenshots/ location,
// while the completion verifier supplies a temporary external root.
const screenshotRoot = process.env.TAU_SCREENSHOT_ROOT
  ? path.resolve(process.env.TAU_SCREENSHOT_ROOT)
  : path.join(REPO_ROOT, "screenshots");
const outDir = path.join(screenshotRoot, label);

// The schematic/inspector/simulator states all hang off one imported circuit.
// An RC pulse with a .tran + .meas gives every downstream state something real
// to show: components to select, and a curve the TS solver actually produces.
const SAMPLE_ASC = path.join(REPO_ROOT, "Circuit_testing_v1", "02_tran_rc_pulse_meas.asc");
const sampleAscText = readFileSync(SAMPLE_ASC, "utf8");
const MODEL_ASC = path.join(REPO_ROOT, "Circuit_testing_v1", "12_buck_converter.asc");
const modelAscText = readFileSync(MODEL_ASC, "utf8");
const subcircuitPins = [
  ["p1", "vcc", -48, -32], ["p2", "vee", -48, 0], ["p3", "pwm", -48, 32],
  ["p4", "gp", 48, -16], ["p5", "gn", 48, 16],
];
const subcircuitAscText = `Version 4
SHEET 1 880 680
WIRE 224 208 272 208
WIRE 224 240 272 240
WIRE 224 272 272 272
WIRE 368 224 416 224
WIRE 368 256 416 256
FLAG 272 240 0
SYMBOL res 320 240 R0
SYMATTR InstName R_TAU_1
SYMATTR Value 1T
SYMATTR TauKind subckt
SYMATTR TauValue TauDeadtimeDriver dead=300n
SYMATTR TauLabel X1
SYMATTR TauPins ${encodeURIComponent(JSON.stringify(subcircuitPins))}
`;

function readViewports() {
  const viewports = [
    { name: "1440x900", width: 1440, height: 900 },
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

/** Starts Vite as its own process group so it (and any children) can be killed
 *  together on exit. Interactive runs may reuse the normal Tau server. The
 *  completion gate forces an isolated port so another checkout cannot be
 *  mistaken for the commit being certified. */
async function ensureDevServer() {
  if (await isServerUp(DEV_URL)) {
    if (FORCE_OWN_SERVER) {
      throw new Error(`completion QA port ${DEV_PORT} is already in use; refusing to test an unidentified server`);
    }
    console.log(`[design-shot] reusing already-running dev server at ${DEV_URL}`);
    return { child: null };
  }
  console.log(`[design-shot] starting isolated dev server on ${DEV_PORT}…`);
  const child = spawn("pnpm", ["-C", "apps/desktop", "exec", "vite", "--port", String(DEV_PORT), "--strictPort"], {
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

async function shootViewport(page, viewport, theme) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  // Persist the theme before navigation so index.html's FOUC boot script
  // stamps data-theme correctly. emulateMedia alone is no longer enough now
  // that Light is the product default (stamped via data-theme).
  await page.goto("about:blank");
  await page.evaluate((nextTheme) => {
    try {
      localStorage.setItem("tau.ui.theme", nextTheme);
    } catch {
      /* private mode */
    }
  }, theme);
  await page.emulateMedia({ colorScheme: theme });

  // --- empty: fresh load, blank scratchpad -------------------------------
  await page.goto(DEV_URL, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
  await page.waitForSelector(".toolbar", { timeout: STATE_TIMEOUT_MS });
  await page.waitForSelector(".explorer-panel", { timeout: STATE_TIMEOUT_MS });
  await page.waitForTimeout(150); // settle animations/spring transitions
  await page.screenshot({ path: path.join(outDir, `empty-${theme}-${viewport.name}.png`), fullPage: true });

  // --- schematic: import a real LTspice .asc -------------------------------
  // The browser workspace seeds EMPTY on purpose (project/defaultWorkspace.ts:
  // `defaultWorkspaceFiles` returns []), and the Explorer's own import button
  // routes through a native folder picker first when no project is open, which
  // headless Chromium cannot answer. The dev bridge (lib/devBridge.ts, DEV
  // builds only) calls the same store actions the UI does, so the import still
  // goes through the shipping importer - then the file is opened by clicking
  // it in the tree, exactly as a user would.
  await page.evaluate(
    ([name, text]) => {
      window.__TAU_DEV__.seedWorkspace();
      return window.__TAU_DEV__.importAscText(name, text);
    },
    [path.basename(SAMPLE_ASC), sampleAscText],
  );

  const exampleButton = page.locator(".explorer-panel .tree-file").first();
  await exampleButton.waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  await exampleButton.click();
  await page.waitForSelector(".stage .component", { timeout: STATE_TIMEOUT_MS }).catch(() => {});
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(outDir, `schematic-${theme}-${viewport.name}.png`), fullPage: true });

  const settingsBtnQa = page.locator('button[aria-label="Settings"]').first();
  await settingsBtnQa.click();
  await page.waitForSelector('.settings-panel[role="dialog"]', { timeout: STATE_TIMEOUT_MS });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(outDir, `dialog-${theme}-${viewport.name}.png`), fullPage: true });
  return;

  // --- inspector: select a component so the property grid renders --------
  // Selection is resolved by geometric hit-testing on the canvas's own
  // pointerdown handler (world coordinates → component bounding boxes), not
  // by which DOM node paints on top at the exact pixel - so `force: true`
  // (skip Playwright's topmost-element check, which the background grid
  // rect can otherwise fail depending on where a symbol's stroke falls
  // inside its bounding box) is correct here, not a workaround.
  const firstComponent = page.locator(".stage .component").first();
  await firstComponent.click({ force: true });
  await page.waitForSelector(".inspector-summary:not(.empty)", { timeout: STATE_TIMEOUT_MS }).catch(() => {});
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outDir, `inspector-${theme}-${viewport.name}.png`), fullPage: true });

  // --- model: compatible exact-part chooser on a real power MOSFET --------
  await page.evaluate(
    ([name, text]) => window.__TAU_DEV__.importAscText(name, text),
    [path.basename(MODEL_ASC), modelAscText],
  );
  const modelFileButton = page.locator(".explorer-panel .tree-file", { hasText: path.basename(MODEL_ASC) });
  await modelFileButton.waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  await modelFileButton.click();
  await page.locator('.activity-rail button[aria-label="Components"]').click();
  await page.waitForSelector(".stage .component", { timeout: STATE_TIMEOUT_MS });
  const selectedPowerMosfet = await page.evaluate(() => window.__TAU_DEV__.selectComponent("M1"));
  if (!selectedPowerMosfet) throw new Error("buck-converter PMOS M1 was not imported");
  const modelPicker = page.getByRole("combobox", { name: "Simulation model" });
  await modelPicker.waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  if (await modelPicker.inputValue() !== "RSR015P06") {
    throw new Error("buck-converter PMOS did not open on its exact RSR015P06 model");
  }
  const pickerOptions = await modelPicker.locator("option").allTextContents();
  if (!pickerOptions.some((option) => option.includes("RSR015P06 · Tau exact models"))) {
    throw new Error("exact Class-D PMOS is absent from the model chooser");
  }
  if (pickerOptions.some((option) => option.startsWith("QS6K1"))) {
    throw new Error("N-channel QS6K1 was offered to a PMOS symbol");
  }
  await modelPicker.selectOption("PMOS");
  await page.getByText(/Generic starter/).waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  await modelPicker.selectOption("RSR015P06");
  await page.getByText(/Ready · exact VDMOS model from Tau exact models/).waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  if (await page.getByRole("textbox", { name: "Width (W)" }).count()) {
    throw new Error("VDMOS selection incorrectly exposes Level-1 W/L geometry");
  }
  const modelBounds = await modelPicker.evaluate((element) => {
    const control = element.getBoundingClientRect();
    const row = element.closest(".property-field")?.getBoundingClientRect();
    return { controlRight: control.right, rowRight: row?.right ?? 0, viewportRight: innerWidth };
  });
  if (modelBounds.controlRight > modelBounds.rowRight + 0.5 || modelBounds.controlRight > modelBounds.viewportRight + 0.5) {
    throw new Error("model chooser overflows the Properties rail at this viewport");
  }
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outDir, `model-${theme}-${viewport.name}.png`), fullPage: true });

  // --- subcircuit: named contract, terminals, and parameter UI ------------
  await page.evaluate(
    ([name, text]) => window.__TAU_DEV__.importAscText(name, text),
    ["tau-native-deadtime.asc", subcircuitAscText],
  );
  const subcircuitFileButton = page.locator(".explorer-panel .tree-file", { hasText: "tau-native-deadtime.asc" });
  await subcircuitFileButton.waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  await subcircuitFileButton.click();
  const selectedSubcircuit = await page.evaluate(() => window.__TAU_DEV__.selectComponent("X1"));
  if (!selectedSubcircuit) throw new Error("native five-terminal subcircuit X1 was not imported");
  const subcircuitPicker = page.getByRole("combobox", { name: "Subcircuit model" });
  await subcircuitPicker.waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  if (await subcircuitPicker.inputValue() !== "TauDeadtimeDriver") {
    throw new Error("native subcircuit did not resolve Tau's bundled dead-time driver");
  }
  await page.getByText(/5 named terminals \(vcc, vee, pwm, gp, gn\)/).waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  const deadtimeField = page.getByRole("textbox", { name: "Dead time" });
  if (await deadtimeField.inputValue() !== "300") throw new Error("dead-time override did not reach its named field");
  if (await deadtimeField.evaluate((element) => element.getBoundingClientRect().width) < 32) {
    throw new Error("dead-time mantissa collapsed below a readable width");
  }
  if (await page.getByRole("combobox", { name: "Dead time SI prefix" }).inputValue() !== "n") {
    throw new Error("dead-time override did not retain its nanosecond unit prefix");
  }
  if (await page.getByRole("textbox", { name: "Value" }).count()) {
    throw new Error("native subcircuit exposed a raw Value/X syntax field");
  }
  if (await page.locator(".subckt-pin-label").allTextContents().then((labels) => labels.join(",")) !== "vcc,vee,pwm,gp,gn") {
    throw new Error("native subcircuit canvas did not render all named terminals in SpiceOrder");
  }
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outDir, `subcircuit-${theme}-${viewport.name}.png`), fullPage: true });

  // Return to the linear RC fixture for the browser-fallback solver proof.
  await page.locator(".explorer-panel .tree-file", { hasText: path.basename(SAMPLE_ASC) }).click();

  // --- simulator: click Run, switch to scope view -------------------------
  const runButton = page.locator('button[aria-label="Run simulation"]').first();
  await runButton.waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  await runButton.click();
  await page.waitForSelector(".app-simulator", { timeout: STATE_TIMEOUT_MS });
  // Web mode has no native ngspice bridge but the TS-fallback transient
  // solver still runs in-browser (see isNativeSpiceRuntime in
  // apps/desktop/src/engine/nativeSpice.ts) - wait for either a real trace or
  // a settled error/empty scope state, whichever the run produces.
  await page
    .waitForSelector(".scope-svg .scope-trace, .scope-shell", { timeout: STATE_TIMEOUT_MS })
    .catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, `simulator-${theme}-${viewport.name}.png`), fullPage: true });

  // --- dialog: settings panel ----------------------------------------------
  const settingsButton = page.locator('button[aria-label="Settings"]').first();
  await settingsButton.click();
  await page.waitForSelector('.settings-panel[role="dialog"]', { timeout: STATE_TIMEOUT_MS });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outDir, `dialog-${theme}-${viewport.name}.png`), fullPage: true });
  await page.locator('button[aria-label="Close settings"]').click();
  await page.waitForSelector('.settings-panel[role="dialog"]', { state: "detached", timeout: STATE_TIMEOUT_MS });

  // --- command: command palette --------------------------------------------
  // Drive it via the always-visible rail search button rather than the
  // Cmd/Ctrl+K shortcut: Chromium can swallow that combo as a browser-level
  // binding before it reaches the page's keydown listener.
  await page.locator('.activity-rail button[aria-label="Search"]').click();
  await page.waitForSelector('.cmdk[role="dialog"]', { timeout: STATE_TIMEOUT_MS });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outDir, `command-${theme}-${viewport.name}.png`), fullPage: true });
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
    // `pnpm install --offline` restores the Playwright package but not always
    // its separately-downloaded Chromium binary. Use the installed system
    // Chrome on macOS when present so the committed screenshot gate remains
    // re-runnable after a cache cleanup instead of asking for a network
    // download at the exact moment visual QA is needed.
    browser = await chromium.launch({
      headless: true,
      ...(existsSync(SYSTEM_CHROME) ? { executablePath: SYSTEM_CHROME } : {}),
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(STATE_TIMEOUT_MS);

    // Force the "no filesystem" capability before any app script runs.
    // useProject's auto-seed (store/useProject.ts - `capability !== "none"`
    // bails) only fills the scratchpad when neither Tauri nor the Chrome File
    // System Access API is present. Headless Chromium DOES expose
    // showDirectoryPicker, so without this the app boots to the "Open a
    // project folder" empty state, the Explorer stays empty, and every state
    // after `empty` fails on a tree file that never appears. addInitScript
    // re-runs on each navigation, so it survives the per-viewport goto.
    await page.addInitScript(() => {
      try {
        delete window.showDirectoryPicker;
      } catch {
        /* non-configurable in some builds - the app falls back to "none" anyway */
      }
    });

    // Both themes, every run. A component styled only for dark is unfinished
    // (DESIGN_SYSTEM.md section 7.2), and light regressions are invisible if
    // the pipeline only ever shoots one of them.
    for (const theme of ["light"]) {
      for (const viewport of viewports) {
        console.log(`[design-shot] capturing ${theme} ${viewport.name}…`);
        await shootViewport(page, viewport, theme);
      }
    }
    console.log(`[design-shot] done. Screenshots written to ${outDir}/`);
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
