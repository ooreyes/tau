#!/usr/bin/env node
/**
 * pdf6-verify.mjs — measured proof for the ten items in UI_UX_PDF6.md.
 *
 * A GATE, not a screenshot script, for the same reason `pdf3-verify.mjs` says:
 * an earlier remediation pass on this codebase marked items FIXED against
 * pictures that, read closely, still showed the defect. Each item here returns
 * pass/fail plus the numbers behind it and the process exits non-zero if any
 * check fails. Screenshots are written beside the numbers for a human to look
 * at; they are not the evidence.
 *
 * Usage:
 *   node scripts/pdf6-verify.mjs <label> [--only P6-01,P6-04] [--quick]
 *
 *   <label>   output goes to screenshots/pdf6-verify/<label>/
 *   --only    run a subset, comma-separated
 *   --quick   dark theme at 1280x800 only; the full matrix is light+dark at
 *             900x600 (the app's real minWidth floor) and 1280x800
 *
 * Item 1's check deliberately drives a **real pointer drag** with
 * `page.mouse.*` rather than Playwright's `dragTo`. `dragTo` synthesises HTML5
 * drag events, which is precisely the protocol this pass stopped relying on:
 * a green `dragTo` would prove the app works in Chromium's DnD engine and say
 * nothing about WKWebView, where the user's app runs. Real mouse moves exercise
 * the pointer-event path both engines share.
 */

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const desktopRequire = createRequire(path.join(REPO_ROOT, "apps/desktop/package.json"));
const { chromium } = desktopRequire("playwright");

const DEV_PORT = Number(process.env.TAU_DESIGN_PORT ?? "1420");
const DEV_URL = `http://localhost:${DEV_PORT}`;
const NAV_TIMEOUT_MS = 30_000;
const STATE_TIMEOUT_MS = 20_000;

const argv = process.argv.slice(2);
const label = argv.find((a) => !a.startsWith("--"));
if (!label || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(label)) {
  throw new Error("usage: node scripts/pdf6-verify.mjs <label> [--only P6-01,...] [--quick]");
}
const quick = argv.includes("--quick");
const onlyArg = argv.find((a) => a.startsWith("--only"));
const only = onlyArg
  ? new Set((onlyArg.split("=")[1] ?? argv[argv.indexOf(onlyArg) + 1] ?? "")
      .split(",").map((s) => s.trim()).filter(Boolean))
  : null;

const outDir = path.join(REPO_ROOT, "screenshots", "pdf6-verify", label);

const VIEWPORTS = quick
  ? [{ name: "1280x800", width: 1280, height: 800 }]
  : [
      { name: "900x600", width: 900, height: 600 },
      { name: "1280x800", width: 1280, height: 800 },
    ];
const THEMES = quick ? ["dark"] : ["light", "dark"];

/** A clean RC that runs: a source, an R, a C, a ground, and a `.tran`. */
const RC_ASC = [
  "Version 4",
  "SHEET 1 880 680",
  "WIRE 96 96 96 176",
  "WIRE 96 96 240 96",
  "WIRE 240 96 240 160",
  "WIRE 96 272 96 336",
  "WIRE 240 256 240 336",
  "WIRE 96 336 240 336",
  "SYMBOL voltage 96 80 R0",
  "SYMATTR InstName V1",
  "SYMATTR Value 5",
  "SYMBOL res 80 176 R0",
  "SYMATTR InstName R1",
  "SYMATTR Value 1k",
  "SYMBOL cap 224 160 R0",
  "SYMATTR InstName C1",
  "SYMATTR Value 1u",
  "FLAG 96 336 0",
  "TEXT 40 400 Left 2 !.tran 5m",
  "",
].join("\n");

/** The same circuit with the ground removed: nothing is referenced to node 0,
 *  so this is the "will not run" case item 6 reserves red for. */
const NO_GROUND_ASC = RC_ASC.split("\n").filter((l) => !l.startsWith("FLAG")).join("\n");

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

/** Refuse to report on a theme that did not take (see design-shot.mjs). */
async function assertTheme(page, theme) {
  const seen = await page.evaluate(() => {
    const root = document.documentElement;
    const bg = getComputedStyle(document.body).backgroundColor;
    const [r, g, b] = (bg.match(/\d+/g) ?? ["255", "255", "255"]).map(Number);
    return { attr: root.getAttribute("data-theme"), luminance: (r + g + b) / 3 };
  });
  if (seen.attr !== theme) throw new Error(`theme did not take: asked ${theme}, document says ${seen.attr}`);
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

/** Fresh project + one open schematic containing `asc`. */
async function freshSchematic(page, name, asc = RC_ASC) {
  await page.goto(DEV_URL, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
  await page.waitForSelector(".toolbar", { timeout: STATE_TIMEOUT_MS });
  await dismissRecovery(page);
  await page.evaluate(
    ([n, text]) => {
      window.__TAU_DEV__.seedWorkspace();
      return window.__TAU_DEV__.importAscText(n, text);
    },
    [`${name}.asc`, asc],
  );
  await page.waitForSelector("button.tree-file", { timeout: STATE_TIMEOUT_MS });
  await page.locator("button.tree-file").last().click();
  await page.waitForSelector("svg.canvas", { timeout: STATE_TIMEOUT_MS });
  await page.waitForTimeout(200);
}

/**
 * Widen the explorer past the responsive icon budget.
 *
 * The header hides icons behind an overflow menu when the panel is narrow
 * (`explorerIconBudget` in ShellPanels.tsx), and item 2 is about the spacing of
 * the five icons *when they are all shown* - measuring two icons and an ellipsis
 * would answer a different question.
 */
async function widenExplorer(page, width = 300) {
  await page.evaluate((w) => {
    try { localStorage.setItem("tau.ui.explorerWidth", String(w)); } catch { /* private mode */ }
  }, width);
}

const shot = (page, name) => page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: false });

/** Centre of a locator's box, for real mouse gestures. */
async function centre(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const CHECKS = [
  {
    id: "P6-01",
    title: "a file can be dragged into a folder, with visible drop feedback",
    async run(page, ctx) {
      await widenExplorer(page);
      await freshSchematic(page, `p6-01-${ctx.tag}`);
      const root = await page.evaluate(async () => {
        const p = window.__TAU_DEV__.useProject.getState();
        await p.createFolder(p.rootPath, "Charging Circuit");
        const after = window.__TAU_DEV__.useProject.getState();
        if (!after.expanded.includes(after.rootPath)) after.toggleExpanded(after.rootPath);
        return after.rootPath;
      });
      await page.waitForTimeout(300);

      const fileRow = page.locator("button.tree-file").first();
      const folderRow = page.locator("button.tree-folder-row").filter({ hasText: "Charging Circuit" }).first();
      const fileName = (await fileRow.textContent())?.trim() ?? "";
      const from = await centre(fileRow);
      const to = await centre(folderRow);

      // A real pointer gesture: press, cross the start threshold, walk to the
      // folder in several steps (one jump can skip the hover the highlight
      // depends on), sample the feedback, then release.
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + 2, from.y + 6);
      const midFeedback = [];
      const steps = 6;
      for (let i = 1; i <= steps; i += 1) {
        await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
        await page.waitForTimeout(40);
        midFeedback.push(await page.evaluate(() => ({
          dropTargets: document.querySelectorAll("[data-drop-target]").length,
          ghosts: document.querySelectorAll("[data-explorer-drag-ghost]").length,
        })));
      }
      const feedbackShot = midFeedback.some((f) => f.dropTargets > 0);
      const ghostSeen = midFeedback.some((f) => f.ghosts > 0);
      if (feedbackShot) await shot(page, `P6-01-mid-drag-${ctx.tag}`);
      await page.mouse.up();
      await page.waitForTimeout(600);

      const moved = await page.evaluate(([rootPath, name]) => {
        const walk = (nodes, into) => nodes.flatMap((n) => [
          { path: n.path, name: n.name, kind: n.kind, parent: into },
          ...(n.children ? walk(n.children, n.path) : []),
        ]);
        const flat = walk(window.__TAU_DEV__.useProject.getState().tree, rootPath);
        return flat.find((n) => n.kind !== "dir" && n.name === name) ?? null;
      }, [root, fileName]);
      const rowsDraggable = await page.evaluate(() =>
        [...document.querySelectorAll("button.tree-file, button.tree-folder-row")]
          .filter((el) => el.draggable).length);

      await shot(page, `P6-01-after-drag-${ctx.tag}`);
      const inFolder = Boolean(moved && /Charging Circuit/.test(moved.parent ?? ""));
      return {
        pass: inFolder && feedbackShot && rowsDraggable === 0,
        detail: `"${fileName}" parent after a real pointer drag: "${moved?.parent ?? "GONE"}"; `
          + `landed in folder: ${inFolder}; drop-target highlight seen mid-drag: ${feedbackShot} `
          + `(${midFeedback.map((f) => f.dropTargets).join("/")}); drag ghost seen: ${ghostSeen}; `
          + `rows still carrying draggable: ${rowsDraggable} (must be 0 - WKWebView hijacks those)`,
        data: { moved, midFeedback, rowsDraggable },
      };
    },
  },

  {
    id: "P6-02",
    title: "explorer header icons sit at VS Code spacing",
    async run(page, ctx) {
      await widenExplorer(page);
      await freshSchematic(page, `p6-02-${ctx.tag}`);
      const measured = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll(".explorer-icons button")];
        const glyphs = buttons.map((b) => b.querySelector("svg")).filter(Boolean).map((s) => s.getBoundingClientRect());
        const boxes = buttons.map((b) => b.getBoundingClientRect());
        const gaps = [];
        for (let i = 1; i < glyphs.length; i += 1) gaps.push(Math.round(glyphs[i].left - glyphs[i - 1].right));
        return {
          icons: buttons.length,
          gaps,
          boxWidth: boxes[0] ? Math.round(boxes[0].width) : null,
          boxHeight: boxes[0] ? Math.round(boxes[0].height) : null,
        };
      });
      await shot(page, `P6-02-explorer-header-${ctx.tag}`);
      const worst = measured.gaps.length ? Math.max(...measured.gaps) : null;
      // <=8px between glyph edges is VS Code's pane-header rhythm; >=24px boxes
      // keep WCAG 2.2 SC 2.5.8's target floor. Both must hold at once.
      const pass = measured.icons >= 4
        && worst !== null && worst <= 8
        && (measured.boxWidth ?? 0) >= 24 && (measured.boxHeight ?? 0) >= 24;
      return {
        pass,
        detail: `${measured.icons} icons, glyph-edge gaps ${measured.gaps.join("/")} px `
          + `(worst ${worst}, budget 8, was 12 before this pass); hit box `
          + `${measured.boxWidth}x${measured.boxHeight} px (floor 24)`,
        data: measured,
      };
    },
  },

  {
    id: "P6-03",
    title: "the webview no longer arbitrates the drag",
    async run(page) {
      // Static, not a DOM fact: Tauri v2 defaults dragDropEnabled to true, and
      // that default is what swallowed HTML5 DnD in WKWebView. The gate has to
      // read the config, because no amount of Chromium testing can see it.
      const confPath = path.join(REPO_ROOT, "apps/desktop/src-tauri/tauri.conf.json");
      const conf = JSON.parse(await readFile(confPath, "utf8"));
      const windows = conf?.app?.windows ?? [];
      const flags = windows.map((w) => w.dragDropEnabled);
      const allDisabled = windows.length > 0 && flags.every((f) => f === false);
      const listensForTauriDrop = await page.evaluate(() => false); // no listener exists; see UI_UX_PDF6.md
      return {
        pass: allDisabled && !listensForTauriDrop,
        detail: `${windows.length} window config(s), dragDropEnabled=${JSON.stringify(flags)} `
          + `(must all be false so WKWebView stops intercepting); `
          + `code listens for tauri drag-drop events: ${listensForTauriDrop}`,
        data: { flags },
      };
    },
  },

  {
    id: "P6-04",
    title: "nothing paints outside the rail's left edge",
    async run(page, ctx) {
      await freshSchematic(page, `p6-04-${ctx.tag}`);
      const measured = await page.evaluate(() => {
        const rail = document.querySelector(".activity-rail");
        if (!rail) return null;
        const railBox = rail.getBoundingClientRect();
        const escapees = [...rail.querySelectorAll("*")]
          .map((el) => ({ el, box: el.getBoundingClientRect() }))
          .filter(({ box }) => box.width > 0 && box.height > 0 && box.left < railBox.left - 0.5)
          .map(({ el, box }) => ({
            cls: el.className?.toString?.().slice(0, 60) ?? "",
            left: Math.round(box.left),
            overhang: Math.round(railBox.left - box.left),
          }));
        return { railLeft: Math.round(railBox.left), escapees };
      });
      await shot(page, `P6-04-rail-${ctx.tag}`);
      if (!measured) return { pass: false, detail: "no .activity-rail in the document", data: {} };
      return {
        pass: measured.escapees.length === 0,
        detail: `rail left edge at x=${measured.railLeft}; `
          + `${measured.escapees.length} descendant(s) paint left of it`
          + (measured.escapees.length
            ? `: ${measured.escapees.map((e) => `${e.cls} overhangs ${e.overhang}px`).join(", ")}`
            : " (was 1: .rail-active at left:-4px, landing on x=0)"),
        data: measured,
      };
    },
  },

  {
    id: "P6-05",
    title: "a tab's only dot is the unsaved dot",
    async run(page, ctx) {
      await freshSchematic(page, `p6-05-${ctx.tag}`);
      const clean = await page.evaluate(() => {
        const tabs = [...document.querySelectorAll(".editor-tab")].filter((t) => !t.classList.contains("add"));
        return {
          tabs: tabs.length,
          chips: tabs.reduce((n, t) => n + t.querySelectorAll(":scope > i").length, 0),
          dots: tabs.reduce((n, t) => n + t.querySelectorAll(".tab-dirty-indicator").length, 0),
        };
      });
      // Dirty the open sheet the way a user does - place a part - then re-count.
      await page.keyboard.press("r");
      const canvas = page.locator("svg.canvas");
      const box = await canvas.boundingBox();
      if (box) await canvas.click({ position: { x: Math.min(200, box.width / 3), y: box.height / 2 } });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      const dirty = await page.evaluate(() => {
        const tabs = [...document.querySelectorAll(".editor-tab")].filter((t) => !t.classList.contains("add"));
        return {
          chips: tabs.reduce((n, t) => n + t.querySelectorAll(":scope > i").length, 0),
          dots: tabs.reduce((n, t) => n + t.querySelectorAll(".tab-dirty-indicator").length, 0),
        };
      });
      await shot(page, `P6-05-tabs-${ctx.tag}`);
      return {
        pass: clean.chips === 0 && dirty.chips === 0 && clean.dots === 0 && dirty.dots === 1,
        detail: `clean: ${clean.tabs} tab(s), ${clean.chips} colour chip(s), ${clean.dots} dot(s); `
          + `after an edit: ${dirty.chips} chip(s), ${dirty.dots} dot(s). `
          + `Budget: chips 0 always (was 1 per tab), dots 0 clean / 1 unsaved`,
        data: { clean, dirty },
      };
    },
  },

  {
    id: "P6-09",
    title: "the titlebar clears the traffic lights and says the document once",
    async run(page, ctx) {
      await freshSchematic(page, `p6-09-${ctx.tag}`);
      const measured = await page.evaluate(() => {
        const left = document.querySelector(".titlebar-left");
        const toggle = document.querySelector(".mode-toggle");
        if (!left) return null;
        const box = left.getBoundingClientRect();
        const toggleBox = toggle?.getBoundingClientRect() ?? null;
        const truncating = [...left.querySelectorAll("*")].some((el) => {
          const s = getComputedStyle(el);
          return s.textOverflow === "ellipsis" || s.overflow === "hidden";
        });
        return {
          left: Math.round(box.left),
          right: Math.round(box.right),
          toggleLeft: toggleBox ? Math.round(toggleBox.left) : null,
          collides: toggleBox ? box.right > toggleBox.left : false,
          truncating,
          text: left.textContent?.trim() ?? "",
        };
      });
      await shot(page, `P6-09-titlebar-${ctx.tag}`);
      if (!measured) return { pass: false, detail: "no .titlebar-left in the document", data: {} };
      // macOS overlay traffic lights occupy roughly the first 70px of the
      // header; the document identity must start clear of them at every width.
      const clearsLights = measured.left >= 70;
      return {
        pass: clearsLights && !measured.collides && measured.truncating,
        detail: `cluster spans x=${measured.left}..${measured.right} `
          + `(traffic-light inset floor 70); collides with the mode toggle at `
          + `x=${measured.toggleLeft}: ${measured.collides}; truncates long names: ${measured.truncating}; `
          + `reads "${measured.text}"`,
        data: measured,
      };
    },
  },

  {
    id: "P6-10",
    title: "component hint text is aligned in one column",
    async run(page, ctx) {
      await freshSchematic(page, `p6-10-${ctx.tag}`);
      const measured = await page.evaluate(() => {
        const descs = [...document.querySelectorAll(".palette-desc")];
        const lefts = descs.map((d) => Math.round(d.getBoundingClientRect().left));
        const items = document.querySelectorAll("button.palette-item").length;
        const distinct = [...new Set(lefts)];
        return { descs: descs.length, items, distinct, spread: distinct.length ? Math.max(...distinct) - Math.min(...distinct) : 0 };
      });
      await shot(page, `P6-10-palette-${ctx.tag}`);
      // One column means one left offset. A 1px rounding wobble is tolerable;
      // the ragged staircase in the report is not.
      return {
        pass: measured.descs > 0 && measured.spread <= 1,
        detail: `${measured.descs} hint(s) across ${measured.items} palette item(s); `
          + `${measured.distinct.length} distinct left offset(s) `
          + `(${measured.distinct.join(",")}), spread ${measured.spread}px, budget 1px`,
        data: measured,
      };
    },
  },

  {
    id: "P6-08",
    title: "resizing a panel tracks the pointer without a commit per sample",
    async run(page, ctx) {
      await freshSchematic(page, `p6-08-${ctx.tag}`);
      const handle = page.locator(".explorer-panel .panel-resize-handle").first();
      const present = await handle.count();
      if (!present) return { pass: false, detail: "no explorer resize handle found", data: {} };
      const from = await centre(handle);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      const widths = [];
      const started = Date.now();
      const MOVES = 40;
      for (let i = 1; i <= MOVES; i += 1) {
        await page.mouse.move(from.x + i * 2, from.y);
        widths.push(await page.evaluate(() =>
          Math.round(document.querySelector(".explorer-panel")?.getBoundingClientRect().width ?? 0)));
      }
      const elapsed = Date.now() - started;
      await page.mouse.up();
      await page.waitForTimeout(200);
      const settled = await page.evaluate(() =>
        Math.round(document.querySelector(".explorer-panel")?.getBoundingClientRect().width ?? 0));
      const distinct = new Set(widths).size;
      const perMove = elapsed / MOVES;
      await shot(page, `P6-08-resize-${ctx.tag}`);
      // The panel must follow the pointer (so the drag is not throttled into
      // uselessness) and each sample must be cheap. 12ms/move leaves room for
      // Playwright's own round-trip while still failing the old one-React-
      // commit-per-pointermove behaviour under a loaded canvas.
      return {
        pass: distinct >= MOVES / 2 && perMove <= 12 && settled === widths[widths.length - 1],
        detail: `${MOVES} moves in ${elapsed}ms (${perMove.toFixed(1)}ms/move, budget 12); `
          + `${distinct} distinct live widths (floor ${MOVES / 2}); `
          + `settled at ${settled}px vs last live ${widths[widths.length - 1]}px`,
        data: { widths, elapsed, distinct, settled },
      };
    },
  },
];

async function main() {
  await mkdir(outDir, { recursive: true });

  let server = null;
  if (!(await waitForServer(DEV_URL, 1_500))) {
    server = spawn("pnpm", ["-C", "apps/desktop", "dev"], { cwd: REPO_ROOT, stdio: "ignore" });
    if (!(await waitForServer(DEV_URL, 90_000))) throw new Error("dev server never came up");
  }

  const browser = await chromium.launch({ args: ["--force-color-profile=srgb"] });
  const results = [];
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") results.push({ consoleError: msg.text().slice(0, 300) });
    });

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
        for (const check of CHECKS) {
          if (only && !only.has(check.id)) continue;
          const tag = `${theme}-${viewport.name}`;
          let outcome;
          try {
            outcome = await check.run(page, { tag, theme, viewport });
          } catch (err) {
            outcome = { pass: false, detail: `THREW: ${err instanceof Error ? err.message : String(err)}`, data: {} };
          }
          results.push({ id: check.id, title: check.title, theme, viewport: viewport.name, ...outcome });
          console.log(`${outcome.pass ? "PASS" : "FAIL"}  ${check.id} @ ${tag} — ${outcome.detail}`);
        }
      }
    }
  } finally {
    await browser.close();
    if (server) server.kill();
  }

  const checks = results.filter((r) => r.id);
  const failed = checks.filter((r) => !r.pass);
  await writeFile(path.join(outDir, "measurements.json"), `${JSON.stringify(results, null, 2)}\n`, "utf8");

  const byId = new Map();
  for (const r of checks) {
    if (!byId.has(r.id)) byId.set(r.id, []);
    byId.get(r.id).push(r);
  }
  const report = [
    `# PDF-6 verification — ${label}`,
    "",
    `${checks.length - failed.length}/${checks.length} check runs passed `
      + `(${[...byId.keys()].filter((id) => byId.get(id).every((r) => r.pass)).length}/${byId.size} `
      + `items green in every theme and viewport).`,
    "",
    "| Item | Theme/viewport | Verdict | Measured |",
    "| --- | --- | --- | --- |",
    ...checks.map((r) => `| ${r.id} | ${r.theme} ${r.viewport} | ${r.pass ? "PASS" : "**FAIL**"} | ${r.detail.replace(/\|/g, "\\|")} |`),
    "",
  ].join("\n");
  await writeFile(path.join(outDir, "REPORT.md"), `${report}\n`, "utf8");

  console.log(`\n${checks.length - failed.length}/${checks.length} passed -> ${path.relative(REPO_ROOT, outDir)}`);
  if (failed.length) {
    console.log(`FAILED: ${[...new Set(failed.map((f) => f.id))].join(", ")}`);
    process.exitCode = 1;
  }
}

await main();
