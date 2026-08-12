#!/usr/bin/env node
/**
 * uiux-followup-shot.mjs - before/after evidence for the review follow-up.
 *
 * The first PDF-directed pass marked several items FIXED against packaged
 * screenshots that, read closely, showed the defect still present: the op-amp
 * and Zener inspectors rendered a clipped grey range hint and no value at all.
 * This script captures exactly the states those claims turn on, so a reader
 * can compare rather than take a tracker's word for it.
 *
 * Usage:
 *   node scripts/uiux-followup-shot.mjs <label>
 *
 * Run it once on the pre-fix tree (`before`) and once after (`after`).
 * Output: screenshots/uiux-followup/<label>/<state>-<theme>-<viewport>.png
 *
 * Sizes and themes match what UI_UX_FIXES.md's "required visual matrix" asks
 * for: light and dark at 900x600, 1280x800 and 1440x900.
 */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const desktopRequire = createRequire(path.join(REPO_ROOT, "apps/desktop/package.json"));
const { chromium } = desktopRequire("playwright");

const DEV_PORT = Number(process.env.TAU_DESIGN_PORT ?? "1420");
const DEV_URL = `http://localhost:${DEV_PORT}`;
const NAV_TIMEOUT_MS = 20_000;
const STATE_TIMEOUT_MS = 15_000;

const label = process.argv[2];
if (!label || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(label)) {
  throw new Error("usage: node scripts/uiux-followup-shot.mjs <label>");
}
const outDir = path.join(REPO_ROOT, "screenshots", "uiux-followup", label);

const VIEWPORTS = [
  { name: "900x600", width: 900, height: 600 },
  { name: "1280x800", width: 1280, height: 800 },
  { name: "1440x900", width: 1440, height: 900 },
];
const THEMES = ["light", "dark"];

const EMPTY_ASC = "Version 4\nSHEET 1 880 680\n";

/**
 * Parts placed the way a user places them: pick it in the palette, click the
 * canvas. Driving the store directly is tempting and wrong here - Vite's HMR
 * can hand a dynamic `import()` a second copy of the module, so the parts land
 * in a store the UI is not rendering and the capture silently shows an empty
 * editor. Palette clicks exercise the shipping path and cannot drift.
 *
 * Positions are canvas-relative, in CSS pixels from its top-left.
 */
const PLACEMENTS = {
  opamp: [["Op Amp", 0.45, 0.45]],
  zener: [["Zener", 0.40, 0.45]],
  led: [["LED", 0.40, 0.45]],
  gate: [["AND", 0.40, 0.45]],
  flops: [["D Flip-Flop", 0.26, 0.26], ["JK Flip-Flop", 0.74, 0.26],
          ["SR Latch", 0.26, 0.74], ["T Flip-Flop", 0.74, 0.74]],
  emitters: [["LED", 0.28, 0.42], ["Photodiode", 0.75, 0.42]],
};

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

/** Refuse to capture a theme that did not take (see design-shot.mjs). */
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
  if ((seen.luminance < 128) !== (theme === "dark")) {
    throw new Error(`theme ${theme} stamped but the page does not look it (${Math.round(seen.luminance)})`);
  }
}

async function dismissRecovery(page) {
  const dialog = page.getByRole("alertdialog", { name: "Restore unsaved work?" });
  const visible = await dialog.waitFor({ state: "visible", timeout: 1_500 }).then(() => true, () => false);
  if (!visible) return;
  await dialog.getByRole("button", { name: "Discard" }).click();
  await dialog.waitFor({ state: "detached", timeout: STATE_TIMEOUT_MS });
}

/** Fresh document with the given parts placed, first one selected. */
async function loadState(page, stateName) {
  await page.goto(DEV_URL, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
  await page.waitForSelector(".toolbar", { timeout: STATE_TIMEOUT_MS });
  await dismissRecovery(page);

  await page.evaluate(
    ([name, text]) => {
      window.__TAU_DEV__.seedWorkspace();
      return window.__TAU_DEV__.importAscText(name, text);
    },
    [`${stateName}.asc`, EMPTY_ASC],
  );
  await page.waitForSelector("button.tree-file", { timeout: STATE_TIMEOUT_MS });
  await page.locator("button.tree-file").last().click();
  await page.waitForSelector("svg.canvas", { timeout: STATE_TIMEOUT_MS });

  const placements = PLACEMENTS[stateName];
  if (!placements) return;

  const canvas = page.locator("svg.canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error(`${stateName}: canvas has no box`);

  // The parts rail floats over the right of the same stage, so the canvas box
  // is wider than the part of it you can actually click. Place inside the
  // uncovered strip or Playwright reports the palette intercepting the click.
  const railBox = await page.locator(".components-rail").boundingBox().catch(() => null);
  const usableWidth = railBox ? Math.max(160, railBox.x - box.x - 16) : box.width;

  for (const [partName, fx, fy] of placements) {
    const tagged = await page.evaluate((name) => {
      const item = [...document.querySelectorAll("button.palette-item")]
        .find((b) => b.querySelector(".palette-name")?.textContent?.trim() === name);
      if (!item) return false;
      item.setAttribute("data-shot-target", "1");
      return true;
    }, partName);
    if (!tagged) throw new Error(`${stateName}: no palette entry named "${partName}"`);
    await page.locator('button.palette-item[data-shot-target="1"]').click();
    await page.evaluate(() => {
      document.querySelector('[data-shot-target="1"]')?.removeAttribute("data-shot-target");
    });
    await canvas.click({ position: { x: usableWidth * fx, y: box.height * fy } });
    await page.waitForTimeout(80);
  }

  // Back to the select tool, then select the first part so its inspector is
  // the thing on screen rather than a placement ghost.
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    const part = document.querySelector(".component");
    part?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  });
  await page.locator(".component").first().click({ force: true });
  await page.waitForTimeout(250);
}

async function capture(page, stateName, theme, viewport) {
  await loadState(page, stateName);
  await page.waitForTimeout(150);
  await page.screenshot({
    path: path.join(outDir, `${stateName}-${theme}-${viewport.name}.png`),
    fullPage: false,
  });
}

/**
 * The numbers behind the pictures. A screenshot shows that a value is there;
 * this records whether the control actually has width and sits inside its row,
 * which is the thing that was wrong.
 */
async function measure(page) {
  return page.evaluate(() => {
    const inspector = document.querySelector(".component-inspector");
    const group = document.querySelector(".property-group");
    const rows = [...document.querySelectorAll(".property-field")].map((field) => {
      const input = field.querySelector("input");
      const eng = field.querySelector(".eng-input");
      const range = field.querySelector(".property-range");
      const fieldBox = field.getBoundingClientRect();
      return {
        label: field.querySelector("span")?.textContent?.trim() ?? null,
        range: range?.textContent ?? null,
        engWidth: eng ? Math.round(eng.getBoundingClientRect().width) : null,
        value: input?.value ?? null,
        valueWidth: input ? Math.round(input.getBoundingClientRect().width) : null,
        valueInsideRow: input ? input.getBoundingClientRect().right <= fieldBox.right + 1 : null,
      };
    });
    const viewControls = document.querySelector(".view-controls");
    const rail = document.querySelector(".components-rail");
    return {
      inspectorWidth: inspector ? Math.round(inspector.getBoundingClientRect().width) : null,
      inspectorTracks: inspector ? getComputedStyle(inspector).gridTemplateColumns : null,
      groupWidth: group ? Math.round(group.getBoundingClientRect().width) : null,
      rows,
      zoomControlsPresent: Boolean(viewControls),
      zoomControlsClearOfRail: viewControls && rail
        ? viewControls.getBoundingClientRect().right <= rail.getBoundingClientRect().left
        : null,
      zoomButtons: viewControls
        ? [...viewControls.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))
        : [],
      statusbarPresent: Boolean(document.querySelector(".statusbar")),
      statusbarText: document.querySelector(".statusbar")?.textContent?.trim() ?? null,
    };
  });
}

async function main() {
  await mkdir(outDir, { recursive: true });

  let server = null;
  if (!(await waitForServer(DEV_URL, 1_500))) {
    server = spawn("pnpm", ["-C", "apps/desktop", "dev"], { cwd: REPO_ROOT, stdio: "ignore" });
    if (!(await waitForServer(DEV_URL, 60_000))) throw new Error("dev server never came up");
  }

  const browser = await chromium.launch({ args: ["--force-color-profile=srgb"] });
  const measurements = {};
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    for (const theme of THEMES) {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(DEV_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      await page.evaluate((next) => {
        try { localStorage.setItem("tau.ui.theme", next); } catch { /* private mode */ }
      }, theme);
      await page.reload({ waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
      await assertTheme(page, theme);

      for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        for (const stateName of Object.keys(PLACEMENTS)) {
          await capture(page, stateName, theme, viewport);
          if (["opamp", "zener", "led"].includes(stateName)) {
            measurements[`${stateName}-${theme}-${viewport.name}`] = await measure(page);
          }
        }
        // Resting editor: no selection, nothing placed. Proves the status bar
        // and the zoom cluster in the state the review complained about.
        await loadState(page, "resting");
        await page.screenshot({
          path: path.join(outDir, `resting-${theme}-${viewport.name}.png`),
          fullPage: false,
        });
        measurements[`resting-${theme}-${viewport.name}`] = await measure(page);
      }
    }
  } finally {
    await browser.close();
    if (server) server.kill();
  }

  await writeFile(
    path.join(outDir, "measurements.json"),
    `${JSON.stringify(measurements, null, 2)}\n`,
    "utf8",
  );
  console.log(`captured ${label} -> ${path.relative(REPO_ROOT, outDir)}`);
}

await main();
