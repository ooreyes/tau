#!/usr/bin/env node
/**
 * Proof shot: EveryCircuit-style current mode after `.op` on a voltage divider.
 * Captures cyan V / green I labels (+ flow dots when animated) on the schematic.
 *
 * Usage: node scripts/shot-current-mode.mjs
 * Output: screenshots/ec-current-mode-visible/
 */
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const desktopRequire = createRequire(path.join(REPO_ROOT, "apps/desktop/package.json"));
const { chromium } = desktopRequire("playwright");

const DEV_PORT = Number(process.env.TAU_DESIGN_PORT ?? "1431");
const DEV_URL = `http://localhost:${DEV_PORT}`;
const OUT_DIR = path.join(REPO_ROOT, "screenshots", "ec-current-mode-visible");
const DIVIDER_ASC = path.join(REPO_ROOT, "Circuit_testing_v1", "01_op_voltage_divider.asc");
const SYSTEM_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const STATE_TIMEOUT_MS = 20_000;

async function waitForServer(url, timeoutMs) {
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

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const ascText = readFileSync(DIVIDER_ASC, "utf8");

  let child = null;
  try {
    const probe = await fetch(DEV_URL).then((r) => r.ok || r.status < 500).catch(() => false);
    if (!probe) {
      console.log(`[shot-current-mode] starting vite on ${DEV_PORT}…`);
      child = spawn(
        "pnpm",
        ["-C", "apps/desktop", "exec", "vite", "--port", String(DEV_PORT), "--strictPort"],
        { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"], detached: true },
      );
      const ready = await waitForServer(DEV_URL, 45_000);
      if (!ready) throw new Error(`dev server did not respond at ${DEV_URL}`);
    } else {
      console.log(`[shot-current-mode] reusing server at ${DEV_URL}`);
    }

    const launchOpts = {
      headless: true,
      args: ["--disable-dev-shm-usage"],
    };
    if (existsSync(SYSTEM_CHROME)) launchOpts.executablePath = SYSTEM_CHROME;

    const browser = await chromium.launch(launchOpts);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(DEV_URL, { waitUntil: "networkidle", timeout: 20_000 });
    await page.waitForSelector(".toolbar", { timeout: STATE_TIMEOUT_MS });

    await page.evaluate(
      ([name, text]) => {
        window.__TAU_DEV__.seedWorkspace();
        return window.__TAU_DEV__.importAscText(name, text);
      },
      [path.basename(DIVIDER_ASC), ascText],
    );

    const fileBtn = page.locator(".explorer-panel .tree-file", {
      hasText: path.basename(DIVIDER_ASC),
    });
    await fileBtn.waitFor({ state: "visible", timeout: STATE_TIMEOUT_MS });
    await fileBtn.click();
    await page.waitForSelector(".stage .component", { timeout: STATE_TIMEOUT_MS });

    // Run follows authored `.op` via runAndShowSimulator → OP on simulator canvas.
    const runButton = page.locator('button[aria-label="Run simulation"]').first();
    await runButton.click();
    await page.waitForSelector(".app-simulator, .sim-schematic-canvas", {
      timeout: STATE_TIMEOUT_MS,
    });

    // Wait for cyan/green OP labels (default-on after successful OP).
    await page.waitForFunction(
      () => document.querySelectorAll(".op-annotation.voltage").length >= 1
        && document.querySelectorAll(".op-annotation.current").length >= 1,
      { timeout: STATE_TIMEOUT_MS },
    );

    // Let flow-dot RAF paint a frame or two.
    await page.waitForTimeout(400);

    const counts = await page.evaluate(() => ({
      voltage: document.querySelectorAll(".op-annotation.voltage").length,
      current: document.querySelectorAll(".op-annotation.current").length,
      dots: document.querySelectorAll(".flow-layer .flow-dot").length,
      badge: Boolean(document.querySelector('[aria-label="Current mode on"]')),
      voltTexts: [...document.querySelectorAll(".op-annotation.voltage")].map((el) => el.textContent),
      ampTexts: [...document.querySelectorAll(".op-annotation.current")].map((el) => el.textContent),
    }));
    console.log("[shot-current-mode] annotations:", JSON.stringify(counts));

    if (counts.voltage < 1 || counts.current < 1) {
      throw new Error("current mode labels missing after OP run");
    }
    if (!counts.badge) {
      throw new Error("Current mode badge missing in simulator header");
    }

    const simPath = path.join(OUT_DIR, "op-divider-simulator-1440x900.png");
    await page.screenshot({ path: simPath, fullPage: true });
    console.log(`[shot-current-mode] wrote ${simPath}`);

    // Also prove editor canvas shows the same overlays (hide simulator → schematic).
    const hideSim = page.locator('button[aria-label="Hide simulator"], button[aria-label="Schematic"]').first();
    if (await hideSim.count()) {
      await hideSim.click().catch(() => {});
    } else {
      // Mode toggle in toolbar
      const schematicMode = page.locator('button[aria-pressed="false"]', { hasText: /Schematic/i }).first();
      if (await schematicMode.count()) await schematicMode.click().catch(() => {});
      else {
        await page.evaluate(() => {
          // Fallback: click any control that returns to schematic editor.
          const btn = [...document.querySelectorAll("button")].find(
            (b) => /schematic/i.test(b.textContent ?? "") || /hide simulator/i.test(b.getAttribute("aria-label") ?? ""),
          );
          btn?.click();
        });
      }
    }
    await page.waitForTimeout(300);
    // Editor may still have annotations if we stayed with opAnalysis; if mode
    // switch cleared the view, re-check stage annotations.
    const editorCounts = await page.evaluate(() => ({
      voltage: document.querySelectorAll(".stage .op-annotation.voltage, .op-annotation.voltage").length,
      current: document.querySelectorAll(".stage .op-annotation.current, .op-annotation.current").length,
      dots: document.querySelectorAll(".flow-layer .flow-dot").length,
    }));
    console.log("[shot-current-mode] editor:", JSON.stringify(editorCounts));
    const editorPath = path.join(OUT_DIR, "op-divider-editor-1440x900.png");
    await page.screenshot({ path: editorPath, fullPage: true });
    console.log(`[shot-current-mode] wrote ${editorPath}`);

    await browser.close();
    console.log("[shot-current-mode] OK");
  } finally {
    killProcessGroup(child);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
