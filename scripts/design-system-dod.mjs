#!/usr/bin/env node
/**
 * §10 design-system DoD screenshot proof — both themes, key chrome surfaces.
 *
 * Captures empty / schematic / dialog / command at 1440×900 for light + dark
 * into screenshots/design-system-dod/. Asserts command palette mounts
 * ui/command (data-slot=command) and Settings sheet mounts ui/sheet.
 *
 * Usage:
 *   TAU_DESIGN_PORT=1470 TAU_DESIGN_FORCE_SERVER=1 node scripts/design-system-dod.mjs
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
const DEV_PORT = Number(process.env.TAU_DESIGN_PORT ?? "1470");
const DEV_URL = `http://localhost:${DEV_PORT}`;
const FORCE_OWN_SERVER = process.env.TAU_DESIGN_FORCE_SERVER === "1";
const SYSTEM_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SAMPLE_ASC = path.join(REPO_ROOT, "Circuit_testing_v1", "02_tran_rc_pulse_meas.asc");
const sampleAscText = readFileSync(SAMPLE_ASC, "utf8");
const outDir = path.join(REPO_ROOT, "screenshots", "design-system-dod");
const VIEWPORT = { width: 1440, height: 900 };
const NAV_TIMEOUT_MS = 15_000;
const STATE_TIMEOUT_MS = 15_000;

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
    console.log(`[design-system-dod] reusing ${DEV_URL}`);
    return { child: null };
  }
  console.log(`[design-system-dod] starting vite on ${DEV_PORT}…`);
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

async function shootTheme(page, theme) {
  // Theme must be stamped on the app origin (not about:blank). Reuse the
  // current origin between themes so the next app boot cannot see the dirty
  // recovery snapshot created by the preceding screenshot before we clear it.
  if (!page.url().startsWith(DEV_URL)) {
    await page.goto(DEV_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  }
  await page.evaluate((nextTheme) => {
    try {
      localStorage.setItem("tau.ui.theme", nextTheme);
      localStorage.setItem("tau.local-ai.setup.v1", JSON.stringify({ dismissed: true }));
      localStorage.removeItem("tau.unsaved.recovery.v1");
      localStorage.removeItem("tau.schematic.v1");
    } catch {
      /* private mode */
    }
  }, theme);
  await page.emulateMedia({ colorScheme: theme });
  await page.goto(DEV_URL, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
  await page.waitForSelector(".toolbar", { timeout: STATE_TIMEOUT_MS });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outDir, `empty-${theme}-1440x900.png`) });

  await page.evaluate(
    ([name, text]) => {
      window.__TAU_DEV__.seedWorkspace();
      return window.__TAU_DEV__.importAscText(name, text);
    },
    [path.basename(SAMPLE_ASC), sampleAscText],
  );
  const exampleButton = page.locator(".explorer-panel .tree-file").first();
  await exampleButton.waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  await exampleButton.click({ force: true });
  await page.waitForSelector(".stage .component", { timeout: STATE_TIMEOUT_MS }).catch(() => {});
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(outDir, `schematic-${theme}-1440x900.png`) });

  // Settings lives in the activity rail's foot. It used to also sit in the
  // toolbar, and this proof pinned itself to that copy - so once the toolbar
  // control was retired (PDF-4/5 moved it to the rail; see NavRail's `.rail-foot`
  // comment), the whole §10 gate spent fifteen seconds waiting for a button that
  // no longer exists and then threw, before it inspected a single colour. Found
  // during PDF-6, which is not this script's pass, but a gate that cannot run is
  // worse than one that fails: nobody reads the output of either, and only one of
  // them looks like it is still working.
  const settingsButton = page.locator('.activity-rail button[aria-label="Settings"]:visible');
  await settingsButton.waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  await settingsButton.click();
  await page.getByRole("dialog", { name: "Settings" }).waitFor({
    state: "visible",
    timeout: STATE_TIMEOUT_MS,
  });
  const sheetSlot = await page.locator('[data-slot="sheet-content"]').count();
  if (!sheetSlot) throw new Error(`${theme}: Settings is not ui/sheet (missing data-slot=sheet-content)`);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outDir, `dialog-${theme}-1440x900.png`) });
  await page.locator('button[aria-label="Close settings"]').click();
  await page.waitForSelector('.settings-panel[role="dialog"]', { state: "detached", timeout: STATE_TIMEOUT_MS }).catch(() => {});

  // Rail Search — same path as design-shot (Cmd+K can be swallowed by Chromium).
  await page.locator('.activity-rail button[aria-label="Search"]').click();
  await page.waitForSelector('[data-slot="command"]', { timeout: STATE_TIMEOUT_MS });
  if (await page.locator(".cmdk-backdrop").count()) {
    throw new Error(`${theme}: legacy cmdk-backdrop leaked into command palette`);
  }
  const dialog = page.getByRole("dialog", { name: "Add component" });
  await dialog.waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outDir, `command-${theme}-1440x900.png`) });
  await page.keyboard.press("Escape");
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const { child } = await ensureDevServer();
  const browser = await chromium.launch({
    headless: true,
    ...(existsSync(SYSTEM_CHROME) ? { executablePath: SYSTEM_CHROME } : {}),
  });
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.error(`[design-system-dod] page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") console.error(`[design-system-dod] browser error: ${message.text()}`);
  });
  await page.setViewportSize(VIEWPORT);
  await page.addInitScript(() => {
    try {
      delete window.showDirectoryPicker;
      // Run before Tau's module graph so the recovery offer cannot mount and
      // block the visual proof. Clearing after boot races the autosave effect,
      // which can recreate the same snapshot before a reload.
      localStorage.setItem("tau.local-ai.setup.v1", JSON.stringify({ dismissed: true }));
      localStorage.removeItem("tau.unsaved.recovery.v1");
      localStorage.removeItem("tau.schematic.v1");
    } catch {
      /* ignore */
    }
  });

  const notes = [];
  try {
    for (const theme of ["light", "dark"]) {
      console.log(`[design-system-dod] capturing ${theme}…`);
      await shootTheme(page, theme);
      notes.push(`${theme}: empty/schematic/dialog/command @ 1440x900 — ui/sheet + ui/command asserted`);
    }
  } finally {
    await browser.close();
    killProcessGroup(child);
  }

  const qa = [
    "# Design-system DoD QA notes",
    "",
    `**Captured:** ${new Date().toISOString()}`,
    "**Viewport:** 1440×900",
    "**Themes:** light + dark",
    "**States:** empty, schematic, dialog (Settings sheet), command (⌘K)",
    "",
    "## Assertions",
    "- Settings mounts `data-slot=sheet-content` (ui/sheet)",
    "- Command palette mounts `data-slot=command` (ui/command); no `.cmdk-backdrop`",
    "- Companion grep: `scripts/design-system-dod-grep.mjs` (hex/select/primitive wiring)",
    "",
    "## Shots",
    ...notes.map((n) => `- ${n}`),
    "",
    "**AGENTS.md §10:** may be checked only when this script + grep both exit 0.",
    "**SHIPPABLE?** NO until all other DoD boxes are proven.",
    "",
  ].join("\n");
  await writeFile(path.join(outDir, "DESIGN-QA-NOTES.md"), qa);
  console.log(`DESIGN-SYSTEM-DOD: shots=${outDir}`);
  console.log("DESIGN-SYSTEM-DOD: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
