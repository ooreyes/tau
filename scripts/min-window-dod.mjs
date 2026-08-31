#!/usr/bin/env node
/**
 * Min-window DoD proof (AGENTS.md — "UI is usable down to the app's own
 * stated minimum window size").
 *
 * Captures STEP 3.5-style screenshots at the tauri.conf.json minimum
 * (currently 900×600) for both themes and asserts:
 *   - document has no horizontal page overflow
 *   - toolbar / statusbar / Settings / Run stay in view
 *   - Settings sheet fits inside the viewport (scrolls internally)
 *   - editor-shell does not widen past its budget (toolbar scrolls instead)
 *   - no interactive control is clipped without a scroll ancestor
 *   - the simulator's below-plot engineering readout remains reachable and
 *     gets its own visual proof instead of sitting below the first screenshot
 *
 * Does NOT claim §10 design-system full adoption.
 *
 * Usage:
 *   TAU_DESIGN_PORT=1460 TAU_DESIGN_FORCE_SERVER=1 node scripts/min-window-dod.mjs
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const desktopRequire = createRequire(path.join(REPO_ROOT, "apps/desktop/package.json"));
const { chromium } = desktopRequire("playwright");
const DEV_PORT = Number(process.env.TAU_DESIGN_PORT ?? "1460");
const DEV_URL = `http://localhost:${DEV_PORT}`;
const FORCE_OWN_SERVER = process.env.TAU_DESIGN_FORCE_SERVER === "1";
const SYSTEM_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SAMPLE_ASC = path.join(REPO_ROOT, "Circuit_testing_v1", "02_tran_rc_pulse_meas.asc");
const sampleAscText = readFileSync(SAMPLE_ASC, "utf8");
const outDir = path.join(REPO_ROOT, "screenshots", "min-window-dod");
const conf = JSON.parse(readFileSync(path.join(REPO_ROOT, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"));
const minW = conf.app.windows[0].minWidth;
const minH = conf.app.windows[0].minHeight;

/** Only these captures intentionally show a resting schematic with no tool
 * feedback. Simulator, dialog, command, and future tool-feedback captures must
 * keep the status bar visible and in the viewport. */
export function isRestingSchematicScenario(label) {
  return /^(?:empty|schematic|hierarchy-guide)-/.test(label);
}

async function waitForServer(url, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok || res.status < 500) return true;
    } catch {
      /* not up */
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

function killProcessGroup(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      /* gone */
    }
  }
}

async function ensureDevServer() {
  if (await isServerUp(DEV_URL)) {
    if (FORCE_OWN_SERVER) {
      throw new Error(`port ${DEV_PORT} already in use; refuse unidentified server`);
    }
    console.log(`[min-window] reusing ${DEV_URL}`);
    return { child: null };
  }
  console.log(`[min-window] starting vite on ${DEV_PORT}…`);
  const child = spawn("pnpm", ["-C", "apps/desktop", "exec", "vite", "--port", String(DEV_PORT), "--strictPort"], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  if (!(await waitForServer(DEV_URL))) {
    killProcessGroup(child);
    throw new Error(`dev server did not respond at ${DEV_URL}`);
  }
  return { child };
}

async function audit(page, label) {
  return page.evaluate(([label, allowMissingStatusbar]) => {
    const vw = innerWidth;
    const vh = innerHeight;
    const docEl = document.documentElement;
    const body = document.body;
    const scrollW = Math.max(docEl.scrollWidth, body.scrollWidth);
    const clientW = Math.max(docEl.clientWidth, body.clientWidth);

    function isScrollable(el, axis) {
      const s = getComputedStyle(el);
      if (axis === "y") {
        return (s.overflowY === "auto" || s.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1;
      }
      return (s.overflowX === "auto" || s.overflowX === "scroll") && el.scrollWidth > el.clientWidth + 1;
    }

    function scrollAncestor(el, axis) {
      let n = el.parentElement;
      while (n && n !== document.body) {
        if (isScrollable(n, axis)) return n;
        n = n.parentElement;
      }
      return null;
    }

    function clipParent(el) {
      let n = el.parentElement;
      while (n && n !== document.body) {
        const s = getComputedStyle(n);
        if (
          ["hidden", "clip", "auto", "scroll"].includes(s.overflow)
          || ["hidden", "clip", "auto", "scroll"].includes(s.overflowY)
          || ["hidden", "clip", "auto", "scroll"].includes(s.overflowX)
        ) {
          return n;
        }
        n = n.parentElement;
      }
      return null;
    }

    const unreachable = [];
    for (const el of document.querySelectorAll(
      'button, a, input, select, textarea, [role="button"], [role="combobox"], [role="tab"]',
    )) {
      if (!(el instanceof HTMLElement)) continue;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
      if (el.getAttribute("aria-hidden") === "true") continue;
      if (el.closest(".notice, .toast, [data-sonner-toast]")) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;

      const fullyOffY = r.bottom <= 0 || r.top >= vh;
      const fullyOffX = r.right <= 0 || r.left >= vw;
      const clip = clipParent(el);
      let clippedByParent = false;
      let parentRect = null;
      if (clip) {
        parentRect = clip.getBoundingClientRect();
        const eps = 0.75;
        clippedByParent =
          r.bottom > parentRect.bottom + eps
          || r.top < parentRect.top - eps
          || r.right > parentRect.right + eps
          || r.left < parentRect.left - eps;
      }

      if (!fullyOffY && !fullyOffX && !clippedByParent) continue;
      const aria =
        el.getAttribute("aria-label")
        || el.getAttribute("title")
        || el.textContent?.trim().slice(0, 48)
        || el.className;

      if (fullyOffY || (clippedByParent && parentRect && (r.bottom > parentRect.bottom || r.top < parentRect.top))) {
        if (scrollAncestor(el, "y")) continue;
        unreachable.push({
          why: "y-no-scroll",
          aria: String(aria).slice(0, 60),
          slot: el.getAttribute("data-slot"),
          rect: [r.left, r.top, r.right, r.bottom].map((value) => Math.round(value * 10) / 10),
          clip: parentRect
            ? [parentRect.left, parentRect.top, parentRect.right, parentRect.bottom].map((value) => Math.round(value * 10) / 10)
            : null,
        });
      }
      if (fullyOffX || (clippedByParent && parentRect && (r.right > parentRect.right || r.left < parentRect.left))) {
        if (scrollAncestor(el, "x")) continue;
        unreachable.push({
          why: "x-no-scroll",
          aria: String(aria).slice(0, 60),
          slot: el.getAttribute("data-slot"),
          rect: [r.left, r.top, r.right, r.bottom].map((value) => Math.round(value * 10) / 10),
          clip: parentRect
            ? [parentRect.left, parentRect.top, parentRect.right, parentRect.bottom].map((value) => Math.round(value * 10) / 10)
            : null,
        });
      }
    }

    const inView = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.top >= -1 && r.bottom <= vh + 1 && r.left >= -1 && r.right <= vw + 1 && r.width > 0 && r.height > 0;
    };

    const editor = document.querySelector(".editor-shell");
    const toolbar = document.querySelector(".editor-toolbar");
    const sheet = document.querySelector('[data-slot="sheet-content"].tau-settings-route');

    let dialogGeom = null;
    if (sheet) {
      const r = sheet.getBoundingClientRect();
      dialogGeom = {
        t: r.top,
        b: r.bottom,
        h: r.height,
        fits: r.top >= -0.5 && r.left >= -0.5 && r.bottom <= vh + 0.5 && r.right <= vw + 0.5,
        canScroll: (() => {
          const s = getComputedStyle(sheet);
          return s.overflowY === "auto" || s.overflowY === "scroll";
        })(),
        scrollH: sheet.scrollHeight,
        clientH: sheet.clientHeight,
      };
    }

    return {
      label,
      pageOverflowX: scrollW > clientW + 1,
      unreachable: unreachable.slice(0, 20),
      essentials: {
        toolbar: inView(document.querySelector(".toolbar")),
        // StatusBar intentionally returns null only in known resting
        // schematic captures; every expected-feedback state requires it.
        statusbar: allowMissingStatusbar || inView(document.querySelector(".statusbar")),
        run: inView(document.querySelector('button[aria-label="Run simulation"]')),
        settings: inView(document.querySelector('button[aria-label="Settings"]')),
      },
      editorShell: editor
        ? {
            clientW: editor.clientWidth,
            scrollW: editor.scrollWidth,
            overflowX: editor.scrollWidth > editor.clientWidth + 1,
          }
        : null,
      editorToolbarScrollable: toolbar
        ? (() => {
            const s = getComputedStyle(toolbar);
            return s.overflowX === "auto" || s.overflowX === "scroll";
          })()
        : null,
      componentsRailOpen: Boolean(document.querySelector(".components-rail")),
      dialogGeom,
    };
  }, [label, isRestingSchematicScenario(label)]);
}

/**
 * The imported fixture may select a part, which intentionally opens the
 * Components rail. Make the two schematic captures stateful rather than
 * blindly toggling: the plain schematic proves an unobscured canvas, while
 * schematic-panels proves the palette is usable at the size floor.
 */
async function setComponentsRailOpen(page, open) {
  const rail = page.locator(".components-rail");
  const isOpen = (await rail.count()) > 0;
  if (isOpen !== open) {
    await page.locator('.activity-rail button[aria-label="Components"]').click();
  }
  await rail.waitFor({ state: open ? "visible" : "detached", timeout: 10_000 });
}

async function main() {
  await mkdir(outDir, { recursive: true });
  console.log(`[min-window] viewport=${minW}x${minH} out=${outDir}`);
  const { child } = await ensureDevServer();
  const browser = await chromium.launch({
    headless: true,
    ...(existsSync(SYSTEM_CHROME) ? { executablePath: SYSTEM_CHROME } : {}),
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: minW, height: minH });
  await page.addInitScript(() => {
    try {
      delete window.showDirectoryPicker;
      localStorage.setItem("tau.local-ai.setup.v1", JSON.stringify({ dismissed: true }));
      localStorage.removeItem("tau.unsaved.recovery.v1");
      localStorage.removeItem("tau.schematic.v1");
      localStorage.removeItem("tau.hierarchy.guidance.v1");
    } catch {
      /* ignore */
    }
  });

  const reports = [];
  let fail = 0;
  try {
    for (const theme of ["light", "dark"]) {
      // Clear the prior theme's imported-circuit recovery snapshot before the
      // next app boot. Loading first would briefly mount the recovery alert;
      // Escape is intentionally not a legal substitute for explicit Discard.
      if (!page.url().startsWith(DEV_URL)) {
        await page.goto(DEV_URL, { waitUntil: "domcontentloaded" });
      }
      await page.evaluate((t) => {
        localStorage.setItem("tau.ui.theme", t);
        localStorage.setItem("tau.local-ai.setup.v1", JSON.stringify({ dismissed: true }));
        localStorage.removeItem("tau.unsaved.recovery.v1");
        localStorage.removeItem("tau.schematic.v1");
        localStorage.removeItem("tau.hierarchy.guidance.v1");
      }, theme);
      // Freeze JS-driven current-flow motion as well as CSS animation. This is
      // both a reduced-motion product check and a deterministic visual proof:
      // otherwise the simulator PNG changes solely with the rAF phase at which
      // Playwright happens to capture it.
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.goto(DEV_URL, { waitUntil: "networkidle" });
      await page.waitForSelector(".toolbar", { timeout: 15_000 });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(outDir, `empty-${theme}-${minW}x${minH}.png`) });
      reports.push(await audit(page, `empty-${theme}`));

      await page.evaluate(
        ([name, text]) => {
          window.__TAU_DEV__.seedWorkspace();
          return window.__TAU_DEV__.importAscText(name, text);
        },
        [path.basename(SAMPLE_ASC), sampleAscText],
      );
      await page.locator(".explorer-panel .tree-file").first().click();
      await page.waitForSelector(".stage .component", { timeout: 15_000 });
      await setComponentsRailOpen(page, false);
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(outDir, `schematic-${theme}-${minW}x${minH}.png`) });
      reports.push(await audit(page, `schematic-${theme}`));

      await setComponentsRailOpen(page, true);
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(outDir, `schematic-panels-${theme}-${minW}x${minH}.png`) });
      reports.push(await audit(page, `schematic-panels-${theme}`));

      // The first hierarchy affordance is a short guide, not a second editor
      // form. Keep this proof on the same project-backed sheet used by the
      // rest of the minimum-window scenarios so the project prerequisite and
      // the 900×600 reachability claim are exercised together.
      await page.locator('.editor-toolbar button[aria-label="Sheet interface"]').click();
      const guide = page.getByRole("dialog", { name: /Build a truthful boundary between schematics/ });
      await guide.waitFor({ state: "visible", timeout: 10_000 });
      await page.waitForTimeout(180);
      const guidePaint = await guide.evaluate((el) => {
        const style = getComputedStyle(el);
        return { backgroundColor: style.backgroundColor, opacity: style.opacity };
      });
      if (guidePaint.opacity !== "1" || guidePaint.backgroundColor === "rgba(0, 0, 0, 0)") {
        throw new Error(`hierarchy guide did not settle to an opaque surface: ${JSON.stringify(guidePaint)}`);
      }
      if (await page.getByRole("dialog", { name: "Sheet interface" }).count() !== 0) {
        throw new Error("hierarchy guide opened on top of a Sheet interface dialog");
      }
      await page.screenshot({ path: path.join(outDir, `hierarchy-guide-${theme}-${minW}x${minH}.png`) });
      reports.push(await audit(page, `hierarchy-guide-${theme}`));
      for (let step = 0; step < 4; step += 1) {
        await guide.getByRole("button", { name: "Next" }).click();
      }
      await guide.getByRole("button", { name: "Start with Sheet interface" }).click();
      const sheetInterface = page.getByRole("dialog", { name: "Sheet interface" });
      await sheetInterface.waitFor({ state: "visible", timeout: 10_000 });
      const completion = await page.evaluate(() => {
        try {
          return JSON.parse(localStorage.getItem("tau.hierarchy.guidance.v1") ?? "null");
        } catch {
          return null;
        }
      });
      if (completion?.kind !== "tau.hierarchy.guidance.v1" || completion?.completed !== true) {
        throw new Error("hierarchy guide did not persist its versioned completion envelope");
      }

      // Replay closes the editor before opening the guide; there must never be
      // two Radix modal focus scopes competing at the window floor.
      await sheetInterface.getByRole("button", { name: "Replay sheet interface guide" }).click();
      await sheetInterface.waitFor({ state: "detached", timeout: 10_000 });
      await guide.waitFor({ state: "visible", timeout: 10_000 });
      await page.waitForTimeout(150);
      const modalState = await page.evaluate(() => {
        const contents = [...document.querySelectorAll('[data-slot="dialog-content"]')];
        const guideContent = contents.find((content) => content.textContent?.includes("Sheet interface guide"));
        return {
          dialogs: contents.length,
          sheetDialogs: contents.filter((content) => content.textContent?.includes("Mark the nets this sheet exposes")).length,
          focusInsideGuide: Boolean(guideContent && guideContent.contains(document.activeElement)),
        };
      });
      if (modalState.dialogs !== 1 || modalState.sheetDialogs !== 0 || !modalState.focusInsideGuide) {
        throw new Error(`hierarchy replay modal/focus contract failed: ${JSON.stringify(modalState)}`);
      }
      await guide.getByRole("button", { name: "Close" }).click();
      await page.locator('.editor-toolbar button[aria-label="Sheet interface"]').click();
      await page.getByRole("dialog", { name: "Sheet interface" }).waitFor({ state: "visible", timeout: 10_000 });
      await page.getByRole("dialog", { name: "Sheet interface" }).getByRole("button", { name: "Done" }).click();

      await page.locator('button[aria-label="Run simulation"]').first().click();
      await page.waitForSelector(".app-simulator", { timeout: 15_000 });
      await page.waitForSelector(".scope-svg .scope-trace, .scope-shell", { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(outDir, `simulator-${theme}-${minW}x${minH}.png`) });
      reports.push(await audit(page, `simulator-${theme}`));

      // The minimum-height simulator intentionally gives the waveform most of
      // the first viewport; its Apple Watch-style numeric readout sits just
      // below it in the same real scroll container. Capture that reachable
      // state too, or the visual gate can stay green while never looking at
      // the measurement surface a redesign actually changed.
      const plotter = page.locator(".plotter");
      await plotter.evaluate((element) => { element.scrollTop = element.scrollHeight; });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(outDir, `simulator-readout-${theme}-${minW}x${minH}.png`) });
      reports.push(await audit(page, `simulator-readout-${theme}`));

      await page.locator('.activity-rail button[aria-label="Settings"]:visible').click();
      await page.getByRole("dialog", { name: "Settings" }).waitFor({ state: "visible", timeout: 10_000 });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(outDir, `dialog-${theme}-${minW}x${minH}.png`) });
      reports.push(await audit(page, `dialog-${theme}`));
      await page.locator('button[aria-label="Close settings"]').click();
      await page.waitForSelector('.settings-panel[role="dialog"]', { state: "detached", timeout: 10_000 }).catch(() => {});

      await page.locator('.activity-rail button[aria-label="Search"]').click();
      await page.waitForSelector('[data-slot="command"]', { timeout: 10_000 });
      await page.getByRole("dialog", { name: "Add component" }).waitFor({ state: "visible", timeout: 10_000 });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(outDir, `command-${theme}-${minW}x${minH}.png`) });
      reports.push(await audit(page, `command-${theme}`));
      await page.keyboard.press("Escape");
    }
  } finally {
    await browser.close();
    killProcessGroup(child);
  }

  await writeFile(path.join(outDir, "AUDIT.json"), JSON.stringify(reports, null, 2));

  for (const r of reports) {
    const issues = [];
    if (r.pageOverflowX) issues.push("pageOverflowX");
    if (r.unreachable.length) issues.push(`unreachable=${r.unreachable.length}`);
    if (r.label.startsWith("schematic-panels-") && !r.componentsRailOpen) issues.push("componentsRailNotOpen");
    if (r.label.startsWith("schematic-") && !r.label.startsWith("schematic-panels-") && r.componentsRailOpen) {
      issues.push("componentsRailLeaked");
    }
    if (!r.essentials.toolbar) issues.push("toolbarOut");
    if (!r.essentials.statusbar) issues.push("statusbarOut");
    if (!r.essentials.settings) issues.push("settingsOut");
    if (r.editorShell?.overflowX && r.label.startsWith("schematic") && r.editorToolbarScrollable !== true) {
      issues.push("editorShellOverflowWithoutToolbarScroll");
    }
    if (r.label.startsWith("dialog-") && !r.dialogGeom) {
      issues.push("settingsDialogNotMeasured");
    } else if (r.dialogGeom) {
      if (!r.dialogGeom.fits) issues.push("dialogOverflowViewport");
      if (!r.dialogGeom.canScroll && r.dialogGeom.scrollH > r.dialogGeom.clientH + 1) {
        issues.push("dialogCannotScroll");
      }
    }
    const status = issues.length ? "FAIL" : "PASS";
    if (issues.length) fail += 1;
    console.log(`[${status}] ${r.label}  ${issues.join("; ") || "ok"}`);
    if (r.unreachable.length) console.log("  ", JSON.stringify(r.unreachable.slice(0, 5)));
    if (r.dialogGeom) console.log("   dialog", JSON.stringify(r.dialogGeom));
  }

  const summary = `MIN-WINDOW: ${minW}x${minH} fail=${fail}/${reports.length} shots=${outDir}`;
  console.log(`\n${summary}`);
  if (fail) process.exit(1);
  console.log("MIN-WINDOW-DOD: ok");
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
