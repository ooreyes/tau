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
 *   TAU_DESIGN_SIMULATOR_ONLY=1 node scripts/design-shot.mjs [label]
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
 *   simulator-cursor - focused-mode proof that C1 reveals exact coordinate
 *                entry only after the engineer arms a cursor.
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
const SIMULATOR_ONLY = process.env.TAU_DESIGN_SIMULATOR_ONLY === "1";
const NAV_TIMEOUT_MS = 15_000;
const SERVER_READY_TIMEOUT_MS = 45_000;
const STATE_TIMEOUT_MS = 15_000;
const SYSTEM_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Mirrors apps/desktop/src/components/shellContract.ts. That file is the
// single source of truth for shell accessible names/roles; this script is
// plain Node ESM and shellContract.ts is TypeScript, so the pairs are
// hand-copied here rather than imported (no build step for this script).
// UPDATE THIS MAP WHENEVER shellContract.ts CHANGES - a drift here means this
// script silently stops proving the surface it claims to.
const SHELL = {
  canvas: { role: "main", name: "Schematic canvas" },
  navRail: { role: "navigation", name: "Workspace sections" },
  explorer: { role: "complementary", name: "Project explorer" },
  componentsRail: { role: "complementary", name: "Components" },
  selectionInspector: { role: "dialog", name: "properties" },
  settings: { role: "dialog", name: "Settings" },
  circuitOverview: { role: "region", name: "Circuit overview" },
  commandPalette: { role: "dialog", name: "Add component" },
};
// shellContract.ts's SHELL.commandPalette. It was briefly filed as a planned
// surface until this script's rewrite showed CommandPalette.tsx already
// implements it (title="Add component" passed through ui/command's
// CommandDialog to a ui/Dialog, so the live role="dialog" element already
// carries exactly this accessible name).
const PARTS_PALETTE = SHELL.commandPalette;
const SHELL_CONTROLS = {
  railSearch: "Search",
  railComponents: "Components",
  transportRun: "Run simulation",
  transportSettings: "Settings",
  closeSettings: "Close settings",
};
// Mirrors shellContract.ts's inspectorName(designator) => `${designator}
// properties`. Which designator renders first depends on document order of
// the imported .asc's components, so match the shape of the name rather than
// a literal string.
const INSPECTOR_NAME_PATTERN = /\sproperties$/;

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

/**
 * Refuse to capture a theme that did not take.
 *
 * The previous theme mechanism failed silently for the entire life of the
 * archive. A capture pipeline whose only failure mode is "the pictures are
 * quietly wrong" is worse than one that stops, so this asserts the two things
 * that have to be true: the boot script stamped the attribute we asked for,
 * and the resulting background is actually dark or light.
 */
async function assertTheme(page, theme) {
  const seen = await page.evaluate(() => {
    const root = document.documentElement;
    const bg = getComputedStyle(document.body).backgroundColor;
    const [r, g, b] = (bg.match(/\d+/g) ?? ["255", "255", "255"]).map(Number);
    return { attr: root.getAttribute("data-theme"), luminance: (r + g + b) / 3 };
  });
  if (seen.attr !== theme) {
    throw new Error(`theme did not take: asked for ${theme}, document says ${seen.attr}`);
  }
  const looksDark = seen.luminance < 128;
  if (looksDark !== (theme === "dark")) {
    throw new Error(
      `theme ${theme} stamped but the page does not look it (mean background ${Math.round(seen.luminance)})`,
    );
  }
}

async function shootViewport(page, viewport, theme) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  // Persist the theme so index.html's FOUC boot script stamps data-theme
  // correctly. emulateMedia alone is not enough, because Light is the product
  // default and the boot script stamps it explicitly whenever no preference is
  // stored, which overrides the media query in both directions.
  //
  // This used to write the preference while sitting on about:blank. That is an
  // opaque origin, so the write threw, the catch swallowed it, and the value
  // never reached the app's origin: EVERY "dark" capture in the archive was
  // actually light, silently, including the redesign baseline. Caught by
  // noticing a dark screenshot rendering light and then finding that the dark
  // and light captures of the same state were visually identical.
  //
  // The write now happens on the app's own origin and the page is reloaded so
  // the boot script reads it. `assertTheme` below refuses to capture if it did
  // not take, because a theme gate that cannot fail is not a gate.
  await page.emulateMedia({ colorScheme: theme });
  await page.goto(DEV_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  await page.evaluate((nextTheme) => {
    try {
      localStorage.setItem("tau.ui.theme", nextTheme);
    } catch {
      /* private mode */
    }
  }, theme);
  await page.reload({ waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
  await assertTheme(page, theme);

  // --- empty: fresh load, blank scratchpad -------------------------------
  await page.goto(DEV_URL, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
  // `.toolbar` stays a classname wait: it's the app's header chrome, not one
  // of the named landmarks in shellContract.ts, so there is no contract
  // string to point this at. Revisit if the redesign gives it an accessible
  // name of its own.
  await page.waitForSelector(".toolbar", { timeout: STATE_TIMEOUT_MS });
  // Tolerant and incidental to all 8 named states: `pendingRecovery`
  // (App.tsx) reads its autosave snapshot synchronously on mount, so an
  // earlier viewport iteration's dev-bridge import (which autosaves like any
  // real edit) can make this alertdialog appear on the NEXT viewport's fresh
  // reload. It's a real modal - it removes sibling landmarks, including the
  // explorer, from the accessibility tree exactly like Settings does (see
  // App.shellContract.test.tsx) - so it must be dismissed before any
  // role-based wait below, or every one of them fails for a reason that has
  // nothing to do with the state being captured.
  const recoveryDialog = page.getByRole("alertdialog", { name: "Restore unsaved work?" });
  if (await recoveryDialog.waitFor({ state: "visible", timeout: 2_000 }).then(() => true, () => false)) {
    await recoveryDialog.getByRole("button", { name: "Discard" }).click();
    await recoveryDialog.waitFor({ state: "detached", timeout: STATE_TIMEOUT_MS });
    // The recovery dialog is incidental setup state, and its confirmation
    // toast otherwise masks the exact controls these screenshots are meant to
    // prove at 900x600. Wait for the real toast lifetime rather than hiding it
    // with test-only CSS so the captured app remains production-faithful.
    await page.getByRole("region", { name: "Notifications alt+T" })
      .getByText("Discarded unsaved recovery copy.", { exact: true })
      .waitFor({ state: "hidden", timeout: 8_000 });
  }
  const explorer = page.getByRole(SHELL.explorer.role, { name: SHELL.explorer.name });
  await explorer.waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
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

  // `.tree-file` stays a classname: it's one row inside the explorer, not a
  // shell surface in its own right, and rows carry no role/name pair in
  // shellContract.ts. Scoping the locator inside the role-based explorer
  // still proves the explorer itself is the real one, not a stray match.
  const exampleButton = explorer.locator(".tree-file").first();
  await exampleButton.waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  await exampleButton.click();
  // Opening a tree file is async (readSim -> onOpenAscText), so a bare
  // "did a .component show up yet" check right after the click is a race:
  // pre-existing content from a still-active previous tab can satisfy it
  // before the new file finishes loading. Waiting for the tab bar to report
  // the intended file as active closes that race - found while re-pointing
  // this exact click, and confirmed present on HEAD before this change too
  // (both scripts, run repeatedly, occasionally opened the wrong file).
  await page.locator(".editor-tab.active", { hasText: path.basename(SAMPLE_ASC) })
    .waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  const canvas = page.getByRole(SHELL.canvas.role, { name: SHELL.canvas.name });
  // Hard wait: "schematic" is named for an imported circuit actually showing
  // on the canvas, so a component that never renders must fail the run
  // instead of silently screenshotting an empty canvas.
  await canvas.locator(".component").first().waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(outDir, `schematic-${theme}-${viewport.name}.png`), fullPage: true });

  // --- inspector: select a component so the property grid renders --------
  // Selection is resolved by geometric hit-testing on the canvas's own
  // pointerdown handler (world coordinates → component bounding boxes), not
  // by which DOM node paints on top at the exact pixel - so `force: true`
  // (skip Playwright's topmost-element check, which the background grid
  // rect can otherwise fail depending on where a symbol's stroke falls
  // inside its bounding box) is correct here, not a workaround.
  const firstComponent = canvas.locator(".component").first();
  await firstComponent.click({ force: true });
  // Hard wait: "inspector" means a selected component's properties are
  // visible, not merely that something got selected, so the run fails rather
  // than screenshotting an empty canvas.
  //
  // The state is the same concept it always was and keeps its filename, which
  // is the join key with every capture taken before this. What changed is
  // where it lives: the properties used to be a `region` inside the
  // componentsRail dock, and are now a floating `dialog` at the part itself
  // (shellContract.ts's `selectionInspector` / `inspectorName()`).
  await page.getByRole(SHELL.selectionInspector.role, { name: INSPECTOR_NAME_PATTERN }).first()
    .waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outDir, `inspector-${theme}-${viewport.name}.png`), fullPage: true });

  // Focused visual work should not be blocked by an unrelated story later in
  // this all-state pipeline. This mode still uses the exact imported RC
  // circuit and public Run control above; it simply captures the simulator at
  // every official viewport before returning. The second frame scrolls the
  // real plotter so below-plot measurement redesigns are visible evidence.
  if (SIMULATOR_ONLY) {
    const focusedRunButton = page.getByRole("button", { name: SHELL_CONTROLS.transportRun }).first();
    await focusedRunButton.waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
    await focusedRunButton.click();
    await page.getByRole(SHELL.circuitOverview.role, { name: SHELL.circuitOverview.name })
      .waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
    await page.waitForSelector(".scope-svg .scope-trace, .scope-shell", { timeout: STATE_TIMEOUT_MS }).catch(() => {});
    await page.waitForTimeout(300);
    const channelRows = page.locator(".trace-interaction");
    if (await channelRows.count() < 2) {
      throw new Error("focused simulator did not render the stacked V(in)/V(out) scope channels");
    }
    if (await page.locator(".engineering-trace-readout__name").count()) {
      throw new Error("single-channel cards repeated signal identity inside their measurement readouts");
    }
    const channelChrome = await channelRows.filter({ has: page.locator("[aria-pressed='true'].trace-interaction__select") })
      .first()
      .evaluate((element) => {
        const row = getComputedStyle(element);
        const select = element.querySelector(".trace-interaction__select");
        const swatch = element.querySelector(".trace-interaction__swatch");
        const mode = element.querySelector(".trace-interaction__cursors button");
        if (!(select instanceof HTMLElement) || !(swatch instanceof HTMLElement) || !(mode instanceof HTMLElement)) return null;
        const selectStyle = getComputedStyle(select);
        const swatchRect = swatch.getBoundingClientRect();
        const modeRect = mode.getBoundingClientRect();
        return {
          rowBackground: row.backgroundColor,
          selectBorder: Math.max(
            Number.parseFloat(selectStyle.borderTopWidth),
            Number.parseFloat(selectStyle.borderRightWidth),
            Number.parseFloat(selectStyle.borderBottomWidth),
            Number.parseFloat(selectStyle.borderLeftWidth),
          ),
          swatchWidth: swatchRect.width,
          swatchHeight: swatchRect.height,
          modeWidth: modeRect.width,
          modeHeight: modeRect.height,
        };
      });
    if (!channelChrome) throw new Error("focused simulator active-channel chrome was incomplete");
    if (channelChrome.rowBackground !== "rgba(0, 0, 0, 0)" || channelChrome.selectBorder !== 0) {
      throw new Error(`scope channel regressed to form chrome (${JSON.stringify(channelChrome)})`);
    }
    if (
      channelChrome.swatchWidth < 24 || channelChrome.swatchHeight < 24 ||
      channelChrome.modeWidth < 24 || channelChrome.modeHeight < 24
    ) {
      throw new Error(`scope channel control fell below the 24 px target floor (${JSON.stringify(channelChrome)})`);
    }
    if (await page.getByText("At time", { exact: true }).count()) {
      throw new Error("Pan mode exposed exact cursor seek fields before a cursor was armed");
    }
    await page.screenshot({ path: path.join(outDir, `simulator-${theme}-${viewport.name}.png`), fullPage: true });
    const cursorOneButton = page.getByRole("button", { name: /^Glide cursor 1 on / }).first();
    await cursorOneButton.click();
    await page.getByText("At time", { exact: true }).waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
    await page.getByText("At value", { exact: true }).waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(outDir, `simulator-cursor-${theme}-${viewport.name}.png`), fullPage: true });
    await page.locator(".plotter").evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(outDir, `simulator-readout-${theme}-${viewport.name}.png`), fullPage: true });
    return;
  }

  // --- model: compatible exact-part chooser on a real power MOSFET --------
  await page.evaluate(
    ([name, text]) => window.__TAU_DEV__.importAscText(name, text),
    [path.basename(MODEL_ASC), modelAscText],
  );
  const modelFileButton = explorer.locator(".tree-file", { hasText: path.basename(MODEL_ASC) });
  await modelFileButton.waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  await modelFileButton.click();
  // See the schematic-state comment above: wait for the tab switch to land
  // before touching canvas content.
  await page.locator(".editor-tab.active", { hasText: path.basename(MODEL_ASC) })
    .waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  await page
    .getByRole(SHELL.navRail.role, { name: SHELL.navRail.name })
    .getByRole("button", { name: SHELL_CONTROLS.railComponents })
    .click();
  await canvas.locator(".component").first().waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  const selectedPowerMosfet = await page.evaluate(() => window.__TAU_DEV__.selectComponent("M1"));
  if (!selectedPowerMosfet) throw new Error("buck-converter PMOS M1 was not imported");
  // Simulation model is shadcn ui/Select (Radix), not a native <select>.
  const modelPicker = page.getByRole("combobox", { name: "Simulation model" });
  await modelPicker.waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  if ((await modelPicker.getAttribute("data-slot")) !== "select-trigger") {
    throw new Error("Simulation model chooser is not ui/Select (expected data-slot=select-trigger)");
  }
  if (await page.locator("select[aria-label='Simulation model']").count()) {
    throw new Error("native Simulation model <select> leaked back into the inspector");
  }
  const modelTriggerText = (await modelPicker.innerText()).replace(/\s+/g, " ").trim();
  if (!modelTriggerText.includes("RSR015P06")) {
    throw new Error(`buck-converter PMOS did not open on its exact RSR015P06 model (got "${modelTriggerText}")`);
  }
  await modelPicker.click();
  await page.getByRole("option", { name: /RSR015P06 · Tau exact models/ }).waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  if (await page.getByRole("option", { name: /^QS6K1/ }).count()) {
    throw new Error("N-channel QS6K1 was offered to a PMOS symbol");
  }
  await page.getByRole("option", { name: /^PMOS\b/ }).click();
  await page.getByText(/Generic starter/).waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  await modelPicker.click();
  await page.getByRole("option", { name: /RSR015P06 · Tau exact models/ }).click();
  await page.getByText(/Ready · exact VDMOS model from Tau exact models/).waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  await page.keyboard.press("Escape");
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
  const subcircuitFileButton = explorer.locator(".tree-file", { hasText: "tau-native-deadtime.asc" });
  await subcircuitFileButton.waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  await subcircuitFileButton.click();
  // See the schematic-state comment above: wait for the tab switch to land
  // before touching canvas content.
  await page.locator(".editor-tab.active", { hasText: "tau-native-deadtime.asc" })
    .waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  await canvas.locator(".component").first().waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  const selectedSubcircuit = await page.evaluate(() => window.__TAU_DEV__.selectComponent("X1"));
  if (!selectedSubcircuit) throw new Error("native five-terminal subcircuit X1 was not imported");
  // Subcircuit model is shadcn ui/Select (Radix), not a native <select>.
  const subcircuitPicker = page.getByRole("combobox", { name: "Subcircuit model" });
  await subcircuitPicker.waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  if ((await subcircuitPicker.getAttribute("data-slot")) !== "select-trigger") {
    throw new Error("Subcircuit model chooser is not ui/Select (expected data-slot=select-trigger)");
  }
  if (await page.locator("select[aria-label='Subcircuit model']").count()) {
    throw new Error("native Subcircuit model <select> leaked back into the inspector");
  }
  const subTriggerText = (await subcircuitPicker.innerText()).replace(/\s+/g, " ").trim();
  if (!subTriggerText.includes("TauDeadtimeDriver")) {
    throw new Error(`native subcircuit did not resolve Tau's bundled dead-time driver (got "${subTriggerText}")`);
  }
  await page.getByText(/5 named terminals \(vcc, vee, pwm, gp, gn\)/).waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  const deadtimeField = page.getByRole("textbox", { name: "Dead time" });
  if (await deadtimeField.inputValue() !== "300") throw new Error("dead-time override did not reach its named field");
  if (await deadtimeField.evaluate((element) => element.getBoundingClientRect().width) < 32) {
    throw new Error("dead-time mantissa collapsed below a readable width");
  }
  const deadPrefix = page.getByRole("combobox", { name: "Dead time SI prefix" });
  if ((await deadPrefix.getAttribute("data-slot")) !== "select-trigger") {
    throw new Error("Dead time SI prefix is not ui/Select (expected data-slot=select-trigger)");
  }
  if (await page.locator(".eng-input select").count()) {
    throw new Error("native eng-input <select> leaked back into the inspector");
  }
  const deadPrefixText = (await deadPrefix.innerText()).replace(/\s+/g, " ").trim();
  if (!deadPrefixText.includes("ns")) {
    throw new Error(`dead-time override did not retain its nanosecond unit prefix (got "${deadPrefixText}")`);
  }
  if (await page.getByRole("textbox", { name: "Value" }).count()) {
    throw new Error("native subcircuit exposed a raw Value/X syntax field");
  }
  // Scoped to the canvas, which is what "subcircuit canvas" always meant. The
  // bare selector used to be unambiguous only by accident: the right-hand rail
  // showed Properties whenever a part was selected, so the parts library - and
  // the pin labels on its symbol previews - was not on screen at the same
  // time. The library is always up now, and it renders 70-odd of them.
  const pinLabels = await page.locator("svg.canvas .subckt-pin-label").allTextContents();
  if (pinLabels.join(",") !== "vcc,vee,pwm,gp,gn") {
    throw new Error(`native subcircuit canvas did not render all named terminals in SpiceOrder (got "${pinLabels.join(",")}")`);
  }
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outDir, `subcircuit-${theme}-${viewport.name}.png`), fullPage: true });

  // Return to the linear RC fixture for the browser-fallback solver proof.
  await explorer.locator(".tree-file", { hasText: path.basename(SAMPLE_ASC) }).click();
  await page.locator(".editor-tab.active", { hasText: path.basename(SAMPLE_ASC) })
    .waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });

  // --- simulator: click Run, switch to scope view -------------------------
  // Two buttons share this accessible name at once: the always-visible
  // Toolbar transport button and EditorToolbar's transport-play button.
  // `.first()` picks the Toolbar one (today's DOM order), which is the one
  // this pipeline has always driven.
  const runButton = page.getByRole("button", { name: SHELL_CONTROLS.transportRun }).first();
  await runButton.waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  await runButton.click();
  // Hard wait: `circuitOverview` is the one surface the "simulator" state is
  // actually named after, so a run that never reaches it must fail loudly.
  // (Previously this waited on `.app-simulator`, which matches - it is a
  // literal class token on the root `<div className="app app-${mode}">` -
  // but that only proves `mode` flipped, not that the simulator surface
  // itself rendered.)
  await page.getByRole(SHELL.circuitOverview.role, { name: SHELL.circuitOverview.name })
    .waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  // Tolerant: web mode has no native ngspice bridge but the TS-fallback
  // transient solver still runs in-browser (see isNativeSpiceRuntime in
  // apps/desktop/src/engine/nativeSpice.ts) - a real trace and a settled
  // error/empty scope state are both legitimate outcomes for this fixture
  // (module doc comment above), so neither is required.
  await page
    .waitForSelector(".scope-svg .scope-trace, .scope-shell", { timeout: STATE_TIMEOUT_MS })
    .catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, `simulator-${theme}-${viewport.name}.png`), fullPage: true });

  // --- dialog: settings panel ----------------------------------------------
  // Same "Settings" name collision as the Run button above (Toolbar + the
  // ActivityRail rail button both use it) - `.first()` picks the Toolbar
  // gear icon, matching today's DOM order and this state's own description.
  const settingsButton = page.getByRole("button", { name: SHELL_CONTROLS.transportSettings }).first();
  await settingsButton.click();
  // Hard wait: this state is named for the settings surface itself, which is
  // now a real ui/Dialog (Radix) rather than the old hand-rolled
  // `.settings-panel` - that class no longer exists in the DOM at all, so
  // this wait would previously have hung for its own state's screenshot.
  const settingsDialog = page.getByRole(SHELL.settings.role, { name: SHELL.settings.name });
  await settingsDialog.waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outDir, `dialog-${theme}-${viewport.name}.png`), fullPage: true });
  await page.getByRole("button", { name: SHELL_CONTROLS.closeSettings }).click();
  await settingsDialog.waitFor({ state: "detached", timeout: STATE_TIMEOUT_MS });

  // --- command: command palette --------------------------------------------
  // Drive it via the always-visible rail search button rather than the
  // Cmd/Ctrl+K shortcut: Chromium can swallow that combo as a browser-level
  // binding before it reaches the page's keydown listener.
  await page
    .getByRole(SHELL.navRail.role, { name: SHELL.navRail.name })
    .getByRole("button", { name: SHELL_CONTROLS.railSearch })
    .click();
  // Hard wait: this state is named for the palette itself being open. Same
  // situation as Settings above - the old `.cmdk[role="dialog"]` selector
  // never matched (the live role="dialog" element carries class
  // "cmdk-dialog", not "cmdk"), so this would already have hung on its own
  // state.
  await page.getByRole(PARTS_PALETTE.role, { name: PARTS_PALETTE.name })
    .waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
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
    for (const theme of ["dark", "light"]) {
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
    if (browser) {
      // System Chrome has occasionally finished every capture but stalled its
      // DevTools close handshake, leaving this otherwise-complete verifier and
      // its Vite child alive. Bound cleanup so a written, asserted screenshot
      // set cannot turn into a hung CI/local QA run.
      let closeTimer;
      await Promise.race([
        browser.close(),
        new Promise((resolve) => { closeTimer = setTimeout(resolve, 5_000); }),
      ]);
      clearTimeout(closeTimer);
    }
    killProcessGroup(child);
  }
  process.exit(exitCode);
}

main();
