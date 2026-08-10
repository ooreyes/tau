/**
 * Driver for the solver-offload bench page.
 *
 * Loads `/bench/index.html` off the running Vite dev server in Chromium, waits
 * for `window.__benchReport`, and prints it. Headed by default: a headless
 * Chromium can decide a page it is not showing does not need frames, and this
 * bench's headline number is a frame gap. Pass `--headless` to override.
 *
 *   pnpm -C apps/desktop dev            # in another shell, if not already up
 *   node bench/run.mjs [--headless]
 */

import { chromium } from "playwright";

const url = process.env.BENCH_URL ?? "http://localhost:1420/bench/index.html";
const headless = process.argv.includes("--headless");

const browser = await chromium.launch({ headless });
const page = await browser.newPage();
page.on("console", (message) => {
  if (message.type() === "error") console.error("[page error]", message.text());
});
page.on("pageerror", (error) => console.error("[page exception]", error.message));

await page.goto(url, { waitUntil: "load" });
const report = await page.waitForFunction(() => window.__benchReport, null, { timeout: 300_000 });
console.log(JSON.stringify(await report.jsonValue(), null, 2));

await browser.close();
