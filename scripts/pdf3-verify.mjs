#!/usr/bin/env node
/**
 * pdf3-verify.mjs — measured proof for the fourteen items in UI_UX_PDF3.md.
 *
 * This is a GATE, not a screenshot script. Every item gets a check that returns
 * a pass/fail plus the numbers behind it, and the process exits non-zero if any
 * check fails. Pictures are captured alongside so a human can look, but the
 * pictures are not the evidence — the previous remediation pass on this
 * codebase marked items FIXED against screenshots that, read closely, still
 * showed the defect. A number cannot be read charitably.
 *
 * Usage:
 *   node scripts/pdf3-verify.mjs <label> [--only P3-07,P3-10] [--quick]
 *
 *   <label>   output goes to screenshots/pdf3-verify/<label>/
 *   --only    run a subset of checks, comma-separated
 *   --quick   one theme (dark) at one viewport (1280x800); the full matrix is
 *             light+dark at 900x600 / 1280x800 / 1440x900
 *
 * Reads store facts through `window.__TAU_DEV__` (dev-only bridge, folded out
 * of production builds) wherever the DOM cannot show the truth: a dropped
 * ground's real rotation, whether Backspace removed a net label from the
 * document or only its glyph, whether a waveform change rewrote `kind` as well
 * as `value`.
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
const NAV_TIMEOUT_MS = 30_000;
const STATE_TIMEOUT_MS = 20_000;

const argv = process.argv.slice(2);
const label = argv.find((a) => !a.startsWith("--"));
if (!label || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(label)) {
  throw new Error("usage: node scripts/pdf3-verify.mjs <label> [--only P3-07,...] [--quick]");
}
const quick = argv.includes("--quick");
const onlyArg = argv.find((a) => a.startsWith("--only"));
const only = onlyArg
  ? new Set((onlyArg.split("=")[1] ?? argv[argv.indexOf(onlyArg) + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean))
  : null;

const outDir = path.join(REPO_ROOT, "screenshots", "pdf3-verify", label);

const VIEWPORTS = quick
  ? [{ name: "1280x800", width: 1280, height: 800 }]
  : [
      { name: "900x600", width: 900, height: 600 },
      { name: "1280x800", width: 1280, height: 800 },
      { name: "1440x900", width: 1440, height: 900 },
    ];
const THEMES = quick ? ["dark"] : ["light", "dark"];

const EMPTY_ASC = "Version 4\nSHEET 1 880 680\n";

/**
 * A cramped sheet, parameterised by pitch and rotation.
 *
 * The report's overlap screenshot is a capacitor and a resistor a few grid
 * units apart whose value labels print on top of each other ("1µ" over "1k Ω"),
 * so the generator alternates exactly that pair and sweeps the separation:
 * "no overlap EVER" is a claim about the whole range, and a single hand-picked
 * pitch is the one layout a fix is most likely to have been tuned against.
 * Written as `.asc` text rather than placed part-by-part so each sheet is
 * byte-identical run to run.
 */
function densAsc({ pitch = 64, rotate = false, rows = 3, cols = 4 } = {}) {
  const lines = ["Version 4", "SHEET 1 1200 900"];
  const kinds = [
    ["cap", "C", "1µ"],
    ["res", "R", "1k"],
    ["ind", "L", "10m"],
    ["res", "R", "4.7Meg"],
  ];
  let n = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const [sym, prefix, value] = kinds[col % kinds.length];
      n += 1;
      const orient = rotate && (n % 2 === 0) ? "R90" : "R0";
      lines.push(`SYMBOL ${sym} ${160 + col * pitch} ${160 + row * pitch} ${orient}`);
      lines.push(`SYMATTR InstName ${prefix}${n}`);
      lines.push(`SYMATTR Value ${value}`);
    }
  }
  // Net labels share the sheet with part labels, and the Canvas comment says
  // net names deliberately sit *under* ref/value labels - z-order is not a
  // licence to overlap, so they are in the measured set too.
  for (let i = 0; i < 3; i += 1) {
    lines.push(`FLAG ${160 + i * pitch} ${160 + rows * pitch} node_${i}`);
  }
  return `${lines.join("\n")}\n`;
}

/** The sheets P3-07 must hold on. */
const OVERLAP_SHEETS = [
  { name: "pitch32", asc: densAsc({ pitch: 32 }) },
  { name: "pitch48", asc: densAsc({ pitch: 48 }) },
  { name: "pitch64", asc: densAsc({ pitch: 64 }) },
  { name: "pitch96", asc: densAsc({ pitch: 96 }) },
  { name: "pitch48rot", asc: densAsc({ pitch: 48, rotate: true }) },
  { name: "pitch64rot", asc: densAsc({ pitch: 64, rotate: true }) },
  { name: "tight2x6", asc: densAsc({ pitch: 40, rows: 2, cols: 6 }) },
];
const densyAsc = () => densAsc({ pitch: 64 });

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
async function freshSchematic(page, name, asc = EMPTY_ASC) {
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

/** The strip of the canvas a click can actually reach — the parts rail floats
 *  over the same stage, so the canvas box is wider than its usable area. */
async function usableCanvas(page) {
  const canvas = page.locator("svg.canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas has no box");
  const rail = await page.locator(".components-rail").boundingBox().catch(() => null);
  return { canvas, box, usableWidth: rail ? Math.max(160, rail.x - box.x - 16) : box.width };
}

/** Place a part the way a user does: pick it in the palette, click the canvas. */
async function place(page, partName, fx, fy) {
  const { canvas, box, usableWidth } = await usableCanvas(page);
  const tagged = await page.evaluate((name) => {
    const item = [...document.querySelectorAll("button.palette-item")]
      .find((b) => b.querySelector(".palette-name")?.textContent?.trim() === name);
    if (!item) return false;
    item.setAttribute("data-shot-target", "1");
    return true;
  }, partName);
  if (!tagged) throw new Error(`no palette entry named "${partName}"`);
  await page.locator('button.palette-item[data-shot-target="1"]').click();
  await page.evaluate(() => document.querySelector('[data-shot-target="1"]')?.removeAttribute("data-shot-target"));
  await canvas.click({ position: { x: usableWidth * fx, y: box.height * fy } });
  await page.waitForTimeout(120);
  await page.keyboard.press("Escape");
}

const shot = (page, name) => page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: false });

/* ── checks ──────────────────────────────────────────────────────────────── */

/**
 * Each check returns { pass, detail, data }. `detail` is the sentence that goes
 * in the report; it must contain the number the verdict rests on, so a reader
 * never has to take the boolean on faith.
 */
const CHECKS = [
  {
    id: "P3-01",
    title: "a source's waveform changes its identity, not just its value",
    async run(page, ctx) {
      await freshSchematic(page, `p3-01-${ctx.tag}`);
      await place(page, "Voltage source", 0.4, 0.45);
      await page.evaluate(() => window.__TAU_DEV__.selectComponent("V1"));
      await page.waitForTimeout(200);

      const read = () => page.evaluate(() => {
        const s = window.__TAU_DEV__.useSchematic.getState();
        const v = s.components.find((c) => c.label === "V1") ?? null;
        const title = document.querySelector(".property-group-title, .inspector-title, .component-inspector h2, .component-inspector .group-name");
        const fields = [...document.querySelectorAll(".property-field")]
          .map((f) => f.querySelector("span")?.textContent?.trim())
          .filter(Boolean);
        const caption = [...document.querySelectorAll(".label-layer text.val, .label-layer text.ref")]
          .map((t) => t.textContent?.trim()).filter(Boolean);
        return {
          kind: v?.kind ?? null,
          value: v?.value ?? null,
          titleText: title?.textContent?.trim() ?? null,
          inspectorText: document.querySelector(".component-inspector")?.textContent ?? "",
          fields,
          caption,
        };
      });

      const before = await read();
      await shot(page, `P3-01-dc-${ctx.tag}`);

      // Switch the waveform through the real control. It is a Radix Select
      // (a button labelled "Waveform type"), not a native <select>, so it has
      // to be clicked open and the option clicked - setting a value would not
      // exercise the code path a user does.
      const trigger = page.getByRole("combobox", { name: "Waveform type" });
      if ((await trigger.count()) === 0) {
        return { pass: false, detail: "no control labelled 'Waveform type' in the inspector", data: { before } };
      }
      await trigger.click();
      await page.waitForTimeout(150);
      const sine = page.getByRole("option", { name: /sine/i }).first();
      if ((await sine.count()) === 0) {
        await page.keyboard.press("Escape");
        return { pass: false, detail: "the Waveform control offers no Sine option", data: { before } };
      }
      await sine.click();
      await page.waitForTimeout(400);
      const after = await read();
      await shot(page, `P3-01-sine-${ctx.tag}`);

      /*
       * The identity that has to change is the DISPLAYED one, not `kind`.
       *
       * This check used to require `before.kind !== after.kind`, which enforced
       * the contract's FIRST decision - convert the component on a waveform
       * switch. Recon then proved that unsafe with a measurement:
       * `decodeParams("vac", "PULSE(0 5 0 1n 1n 5u 10u)")` yields
       * `{offset:"PULSE(0", amplitude:"5", frequency:"0"}`, and that garbage
       * reaches ascExport and the canvas caption. So the decision changed and
       * `kind` deliberately stays `vsource`. A gate still asserting the
       * superseded design fails correct code - which is what it did here, while
       * its own detail line read "Sine voltage source", no DC row, sine fields.
       */
      const titleChanged = (before.titleText ?? "") !== (after.titleText ?? "");
      const titleClean = !/dc source/i.test(after.titleText ?? "") && !/DC source/.test(after.inspectorText);
      const titleNamesSine = /sine/i.test(after.titleText ?? "");
      const noDoubleBias = !(/dc operating point/i.test(after.inspectorText) && /(^|\s)offset/i.test(after.inspectorText));
      // The field set must be the sine's, with no bias row left behind it.
      const fieldsAreSine = after.fields.some((f) => /^offset$/i.test(f ?? ""))
        && after.fields.some((f) => /amplitude/i.test(f ?? ""))
        && !after.fields.some((f) => /dc operating point|dc level/i.test(f ?? ""));
      const captionSine = after.caption.some((t) => /sine|sin/i.test(t)) || /SINE/i.test(after.value ?? "");
      const pass = titleChanged && titleClean && titleNamesSine && noDoubleBias && fieldsAreSine && captionSine;
      return {
        pass,
        detail: `title "${before.titleText}" -> "${after.titleText}" (names sine: ${titleNamesSine}); `
          + `"DC source" anywhere in inspector: ${!titleClean}; `
          + `DC-operating-point and Offset both shown: ${!noDoubleBias}; `
          + `field set is the sine's with no bias row: ${fieldsAreSine}; `
          + `kind stays "${after.kind}" by design (converting it corrupts the value codec); `
          + `value "${after.value}"; fields [${after.fields.join(", ")}]`,
        data: { before, after },
      };
    },
  },

  {
    id: "P3-02",
    title: "a file can be dragged into a folder",
    async run(page, ctx) {
      await freshSchematic(page, `p3-02-${ctx.tag}`);
      const root = await page.evaluate(async () => {
        const p = window.__TAU_DEV__.useProject.getState();
        const rootPath = p.rootPath;
        await p.createFolder(rootPath, "Project Storage");
        if (!p.expanded.includes(rootPath)) p.toggleExpanded(rootPath);
        return rootPath;
      });
      await page.waitForTimeout(300);

      const draggableSet = await page.evaluate(() => {
        const row = document.querySelector("button.tree-file");
        return row ? { draggable: row.draggable, attr: row.getAttribute("draggable") } : null;
      });

      const fileRow = page.locator("button.tree-file").first();
      const folderRow = page.locator("button.tree-folder-row").filter({ hasText: "Project Storage" }).first();
      const fileName = (await fileRow.textContent())?.trim() ?? "";

      let dragError = null;
      try {
        await fileRow.dragTo(folderRow);
      } catch (err) {
        dragError = err instanceof Error ? err.message : String(err);
      }
      await page.waitForTimeout(600);

      const moved = await page.evaluate(([rootPath, name]) => {
        const walk = (nodes, into) => nodes.flatMap((n) => [
          { path: n.path, name: n.name, kind: n.kind, parent: into },
          ...(n.children ? walk(n.children, n.path) : []),
        ]);
        const flat = walk(window.__TAU_DEV__.useProject.getState().tree, rootPath);
        const hit = flat.find((n) => n.kind !== "dir" && n.name === name);
        return { tree: flat, file: hit ?? null };
      }, [root, fileName]);

      await shot(page, `P3-02-after-drag-${ctx.tag}`);
      const inFolder = Boolean(moved.file && /Project Storage/.test(moved.file.parent ?? ""));
      return {
        pass: Boolean(draggableSet?.draggable) && inFolder,
        detail: `file row draggable=${draggableSet?.draggable} (attr ${draggableSet?.attr}); `
          + `after dragTo, "${fileName}" parent is "${moved.file?.parent ?? "GONE"}"; `
          + `landed in Project Storage: ${inFolder}${dragError ? `; dragTo threw: ${dragError}` : ""}`,
        data: { draggableSet, moved: moved.file, dragError },
      };
    },
  },

  {
    id: "P3-03",
    title: "the palette LED is not coloured",
    async run(page, ctx) {
      await freshSchematic(page, `p3-03-${ctx.tag}`);
      const strokes = await page.evaluate(() => {
        const glyphStroke = (name) => {
          const item = [...document.querySelectorAll("button.palette-item")]
            .find((b) => b.querySelector(".palette-name")?.textContent?.trim() === name);
          if (!item) return null;
          const strokes = [...item.querySelectorAll("svg *")]
            .map((el) => getComputedStyle(el).stroke)
            .filter((s) => s && s !== "none");
          return { name, strokes: [...new Set(strokes)] };
        };
        return { led: glyphStroke("LED"), diode: glyphStroke("Diode"), resistor: glyphStroke("Resistor") };
      });
      await shot(page, `P3-03-palette-${ctx.tag}`);

      const chroma = (rgb) => {
        const [r, g, b] = (rgb.match(/[\d.]+/g) ?? [0, 0, 0]).map(Number);
        return Math.max(r, g, b) - Math.min(r, g, b);
      };
      const ledChroma = Math.max(0, ...(strokes.led?.strokes ?? []).map(chroma));
      const refChroma = Math.max(0, ...(strokes.diode?.strokes ?? []).map(chroma), ...(strokes.resistor?.strokes ?? []).map(chroma));
      return {
        pass: strokes.led !== null && ledChroma <= Math.max(refChroma, 8),
        detail: `palette LED stroke chroma ${ledChroma.toFixed(1)} vs neighbours ${refChroma.toFixed(1)} `
          + `(LED strokes: ${(strokes.led?.strokes ?? []).join(" | ") || "NONE FOUND"})`,
        data: strokes,
      };
    },
  },

  {
    id: "P3-04A",
    title: "the explorer overflow trigger survives a narrow window",
    async run(page, ctx) {
      /*
       * Swept across the explorer's own width, not just the window's. The panel
       * is its own CSS query container (App.css:5192), so the breakpoint that
       * decides this is the PANEL width - 168px is EXPLORER_PANEL_WIDTH.minWidth,
       * 226px the default, 420px the max. A check that only ever looked at the
       * default width would sit on one side of a binary swap and never see it.
       */
      const WIDTHS = [168, 226, 420];
      const perWidth = [];
      for (const w of WIDTHS) {
        await page.evaluate((width) => {
          try { localStorage.setItem("tau.ui.explorerWidth", String(width)); } catch { /* private mode */ }
        }, w);
        await freshSchematic(page, `p3-04a-${w}-${ctx.tag}`);
        const m = await page.evaluate(() => {
          const head = document.querySelector(".explorer-head");
          const name = document.querySelector(".explorer-root-name");
          if (!head || !name) return { missing: { head: !head, name: !name } };
          const trigger = document.querySelector(".explorer-overflow-trigger");
          const vis = (el) => {
            if (!el) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== "none";
          };
          const icons = [...head.querySelectorAll(".explorer-primary-actions button")].filter(vis);
          const h = head.getBoundingClientRect();
          const n = name.getBoundingClientRect();
          const t = trigger?.getBoundingClientRect();
          return {
            panelWidth: Math.round(document.querySelector(".explorer-panel")?.getBoundingClientRect().width ?? 0),
            triggerVisible: vis(trigger),
            triggerWidth: t ? Math.round(t.width) : 0,
            insideHead: t ? t.right <= h.right + 1 && t.left >= h.left - 1 : false,
            gapToName: t ? Math.round(t.left - n.right) : null,
            primaryIconsVisible: icons.length,
            // The root name must not be clipped to make room for icons. The
            // EXPLORER verify pass found exactly that: a 56px floor against a
            // caption whose ink measures 71px, so the shipped default truncated
            // "SCHEMATICS" to fit a fifth icon - the inverse of the reported
            // complaint, and invisible to a check that only measured the ⋯.
            nameTruncated: name.scrollWidth > name.clientWidth + 1,
            nameText: name.textContent?.trim() ?? null,
            nameWidth: Math.round(n.width),
            headOverflowing: head.scrollWidth > head.clientWidth + 1,
          };
        });
        perWidth.push({ asked: w, ...m });
        await shot(page, `P3-04A-header-${w}-${ctx.tag}`);
      }
      await page.evaluate(() => { try { localStorage.removeItem("tau.ui.explorerWidth"); } catch { /* ok */ } });

      const bad = perWidth.filter((m) => m.missing
        || !m.triggerVisible || !m.insideHead || (m.gapToName ?? -1) < 8 || m.headOverflowing
        || m.nameTruncated);
      return {
        pass: bad.length === 0,
        detail: perWidth.map((m) => `@${m.asked}px(actual ${m.panelWidth}): ⋯ visible ${m.triggerVisible}`
          + `, inside header ${m.insideHead}, gap to name ${m.gapToName}px, ${m.primaryIconsVisible} primary icon(s)`
          + `, name "${m.nameText}" ${m.nameWidth}px truncated ${m.nameTruncated}`
          + `, header overflowing ${m.headOverflowing}`).join(" | ")
          + `; failing widths: ${bad.map((m) => m.asked).join(", ") || "none"} `
          + `(⋯ must survive every width with >= 8px clear, and the root name must never be clipped to make room for it)`,
        data: perWidth,
      };
    },
  },

  {
    id: "P3-04B",
    title: "the empty-editor card tells you to place a part",
    async run(page, ctx) {
      await freshSchematic(page, `p3-04b-${ctx.tag}`);
      const copy = await page.evaluate(() => {
        const card = document.querySelector(".empty-state, .empty-card, [data-empty-state]")
          ?? [...document.querySelectorAll("div")].find((d) => /Create or open a schematic|place/i.test(d.textContent ?? "") && d.querySelector("h1"));
        return {
          found: Boolean(card),
          heading: card?.querySelector("h1, h2")?.textContent?.trim() ?? null,
          body: card?.textContent?.replace(/\s+/g, " ").trim() ?? null,
          buttons: card ? [...card.querySelectorAll("button")].map((b) => b.textContent?.trim()) : [],
        };
      });
      await shot(page, `P3-04B-empty-${ctx.tag}`);
      const stale = /create or open a schematic/i.test(copy.heading ?? "");
      const guides = /place|drop|drag/i.test(copy.body ?? "") && /component|part/i.test(copy.body ?? "");
      const keepsBode = (copy.buttons ?? []).some((b) => /bode/i.test(b ?? ""));
      return {
        pass: copy.found && !stale && guides && keepsBode,
        detail: `heading "${copy.heading}"; still the stale copy: ${stale}; `
          + `names placing a component: ${guides}; keeps an Ask Bode action: ${keepsBode}; buttons [${copy.buttons.join(", ")}]`,
        data: copy,
      };
    },
  },

  {
    id: "P3-06",
    title: "tree rows are indented under their parent",
    async run(page, ctx) {
      await freshSchematic(page, `p3-06-${ctx.tag}`);
      await page.evaluate(async () => {
        const p = window.__TAU_DEV__.useProject.getState();
        const root = p.rootPath;
        const folder = await p.createFolder(root, "Project Storage");
        await p.createSchematicFile(folder, "nested.asc");
        const state = window.__TAU_DEV__.useProject.getState();
        for (const dir of [root, folder]) if (!state.expanded.includes(dir)) state.toggleExpanded(dir);
      });
      await page.waitForTimeout(400);
      const rows = await page.evaluate(() => {
        const rootRow = document.querySelector(".tree-project-root-row");
        const all = [...document.querySelectorAll(".tree-folder-row, button.tree-file")];
        return all.map((el) => ({
          text: el.textContent?.replace(/\s+/g, " ").trim().slice(0, 40),
          isRoot: el === rootRow,
          isFile: el.matches("button.tree-file"),
          left: Math.round(el.getBoundingClientRect().left),
          paddingLeft: Math.round(parseFloat(getComputedStyle(el).paddingLeft) || 0),
          contentLeft: Math.round(el.getBoundingClientRect().left + (parseFloat(getComputedStyle(el).paddingLeft) || 0)),
        }));
      });
      await shot(page, `P3-06-tree-${ctx.tag}`);
      const rootRow = rows.find((r) => r.isRoot);
      const rootIndent = rootRow?.contentLeft ?? 0;
      const nested = rows.find((r) => /nested\.asc/.test(r.text ?? ""));
      const folder = rows.find((r) => /Project Storage/.test(r.text ?? ""));
      // The bar is a step a reader can SEE. The pre-fix tree stepped by 2px per
      // level, which satisfies "greater than" and satisfies nobody looking at
      // it; 10px is roughly the width of the caret it should clear.
      const STEP = 10;
      const rootToFolder = folder ? folder.contentLeft - rootIndent : null;
      const folderToFile = nested && folder ? nested.contentLeft - folder.contentLeft : null;
      const shallow = [
        rootToFolder !== null && rootToFolder < STEP ? `root->folder ${rootToFolder}px` : null,
        folderToFile !== null && folderToFile < STEP ? `folder->file ${folderToFile}px` : null,
      ].filter(Boolean);
      return {
        pass: shallow.length === 0 && rootToFolder !== null && folderToFile !== null,
        detail: `indent steps: root(${rootIndent}px) -> folder(+${rootToFolder}px) -> nested file(+${folderToFile}px); `
          + `need >= ${STEP}px per level; too shallow: ${shallow.join(", ") || "none"}`,
        data: { rows, rootIndent, rootToFolder, folderToFile },
      };
    },
  },

  {
    id: "P3-07",
    title: "no two labels overlap, ever",
    async run(page, ctx) {
      const perSheet = [];
      for (const sheet of OVERLAP_SHEETS) {
        await freshSchematic(page, `p3-07-${sheet.name}-${ctx.tag}`, sheet.asc);
        await page.waitForTimeout(400);
        const measured = await page.evaluate(() => {
          const texts = [...document.querySelectorAll(
            ".label-layer text.ref, .label-layer text.val, .net-label-layer text.net-label-text",
          )];
          const boxes = texts.map((t) => {
            const r = t.getBoundingClientRect();
            return { text: t.textContent?.trim(), x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom };
          }).filter((b) => b.w > 0 && b.h > 0);
          const hits = [];
          for (let i = 0; i < boxes.length; i += 1) {
            for (let j = i + 1; j < boxes.length; j += 1) {
              const a = boxes[i], c = boxes[j];
              const ox = Math.min(a.r, c.r) - Math.max(a.x, c.x);
              const oy = Math.min(a.b, c.b) - Math.max(a.y, c.y);
              // Half a pixel of antialiasing touch is not an overlap; a whole
              // pixel of shared ink in BOTH axes is.
              if (ox > 1 && oy > 1) hits.push({ a: a.text, b: c.text, overlapPx: `${ox.toFixed(1)}x${oy.toFixed(1)}` });
            }
          }
          // Artwork collisions matter too: a value printed across another
          // part's body is the same defect wearing a different hat.
          const art = [...document.querySelectorAll("svg.canvas .component")].map((el) => el.getBoundingClientRect());
          const onArt = [];
          for (const b of boxes) {
            for (const a of art) {
              const ox = Math.min(b.r, a.right) - Math.max(b.x, a.left);
              const oy = Math.min(b.b, a.bottom) - Math.max(b.y, a.top);
              if (ox > 2 && oy > 2) onArt.push({ text: b.text, overlapPx: `${ox.toFixed(1)}x${oy.toFixed(1)}` });
            }
          }
          return { count: boxes.length, hits, onArt: onArt.slice(0, 8), onArtCount: onArt.length };
        });
        perSheet.push({ sheet: sheet.name, ...measured });
        if (measured.hits.length > 0) await shot(page, `P3-07-overlap-${sheet.name}-${ctx.tag}`);
      }
      await shot(page, `P3-07-dense-${ctx.tag}`);
      const worst = perSheet.reduce((a, b) => (b.hits.length > a.hits.length ? b : a), perSheet[0]);
      const totalHits = perSheet.reduce((n, s) => n + s.hits.length, 0);
      return {
        pass: totalHits === 0,
        detail: `${OVERLAP_SHEETS.length} sheets swept (pitch 32-96, straight and rotated, net labels included), `
          + `${perSheet.reduce((n, s) => n + s.count, 0)} label boxes measured; ${totalHits} overlapping pair(s)`
          + (totalHits ? `; worst sheet "${worst.sheet}" with ${worst.hits.length}: `
              + worst.hits.slice(0, 5).map((h) => `"${h.a}"x"${h.b}" ${h.overlapPx}px`).join("; ") : "")
          + `; label-over-artwork collisions: ${perSheet.reduce((n, s) => n + s.onArtCount, 0)}`,
        data: perSheet,
      };
    },
  },

  {
    id: "P3-08",
    title: "ground lands pin-up on every placement path",
    async run(page, ctx) {
      await freshSchematic(page, `p3-08-${ctx.tag}`);
      const groundsNow = () => page.evaluate(() => window.__TAU_DEV__.useSchematic.getState().components
        .filter((c) => c.kind === "ground")
        .map((c) => ({ rot: c.rotation, mir: Boolean(c.mirrored) })));

      /*
       * The GHOST is the thing the report actually photographed.
       *
       * An earlier version of this check only read the placed component and
       * passed, because the placed ground genuinely is upright
       * (useSchematic.ts:1153 forces rotation 0 for ground). The reported
       * screenshot is the placement preview: its strokes are broken because
       * `.ghost .symbol` is `stroke-dasharray: 4 3; opacity: 0.65`, and it draws
       * `symbolTransform(placeRotation, placeMirror)` for every kind - so with a
       * sticky tool rotation the preview shows a sideways ground that the drop
       * will not honour. Reading only the drop measures the one thing that was
       * never broken, so read the ghost's own transform and the tool state
       * behind it.
       */
      const ghostNow = () => page.evaluate(() => {
        const ghost = document.querySelector("svg.canvas g.ghost");
        const inner = ghost?.querySelector("g.symbol");
        const s = window.__TAU_DEV__.useSchematic.getState();
        return {
          present: Boolean(ghost),
          transform: inner?.getAttribute("transform") ?? null,
          placeRotation: s.placeRotation ?? null,
          placeMirror: Boolean(s.placeMirror ?? s.placeMirrored),
          toolKind: s.tool?.kind ?? s.tool?.mode ?? null,
        };
      });

      // Path 1: palette click, with a sticky tool rotation provoked first -
      // a rotation left over from a previous part is the likeliest way a ground
      // ends up sideways.
      /*
       * Arming the sticky rotation is fiddly and the fiddliness is the point.
       * `rotate` only bumps `placeRotation` while `tool.mode === "place"`
       * (useSchematic.ts:1188), and App.tsx's window keydown guard returns early
       * when focus sits on a `button` - which is exactly where a palette click
       * leaves it. So: arm the tool, blur the palette button, THEN press r. A
       * first version of this check skipped the blur, measured placeRotation 0,
       * and passed the pre-fix code by never arming the defect.
       */
      const arm = async (partName) => {
        const tagged = await page.evaluate((name) => {
          const item = [...document.querySelectorAll("button.palette-item")]
            .find((b) => b.querySelector(".palette-name")?.textContent?.trim() === name);
          if (!item) return false;
          item.setAttribute("data-shot-target", "1");
          return true;
        }, partName);
        if (!tagged) throw new Error(`no palette entry named "${partName}"`);
        await page.locator('button.palette-item[data-shot-target="1"]').click();
        await page.evaluate(() => {
          document.querySelector('[data-shot-target="1"]')?.removeAttribute("data-shot-target");
          (document.activeElement instanceof HTMLElement) && document.activeElement.blur();
        });
      };

      await arm("Resistor");
      // Rotate is Space (or Cmd/Ctrl+R) - shortcuts.ts:141. An earlier version
      // pressed "r", which is bound to nothing, and so armed nothing.
      await page.keyboard.press("Space");
      await page.waitForTimeout(120);
      const armedRotation = await page.evaluate(() => window.__TAU_DEV__.useSchematic.getState().placeRotation);
      const { canvas: c0, box: b0, usableWidth: uw0 } = await usableCanvas(page);
      await c0.click({ position: { x: uw0 * 0.25, y: b0.height * 0.28 } });
      await page.waitForTimeout(150);

      // Now arm Ground while that rotation is still armed, and hover WITHOUT
      // dropping, so the ghost is on screen in the state the report shows.
      await arm("Ground");
      await page.mouse.move(b0.x + uw0 * 0.5, b0.y + b0.height * 0.4);
      await page.waitForTimeout(300);
      const ghost = await ghostNow();
      await shot(page, `P3-08-ghost-${ctx.tag}`);
      await page.keyboard.press("Escape");

      await place(page, "Ground", 0.4, 0.5);
      await page.waitForTimeout(200);
      const afterClick = await groundsNow();

      // Path 2: mirror the tool as well, then place again. Mirror is
      // Cmd/Ctrl+E (shortcuts.ts:112); arm first so tool.mode === "place",
      // and blur so App.tsx's keydown guard does not skip a focused button.
      await arm("Ground");
      await page.keyboard.press("Space");
      await page.keyboard.press(process.platform === "darwin" ? "Meta+e" : "Control+e");
      const armedMirror = await page.evaluate(() => {
        const s = window.__TAU_DEV__.useSchematic.getState();
        return { rot: s.placeRotation, mir: Boolean(s.placeMirror) };
      });
      await place(page, "Ground", 0.6, 0.5);
      await page.waitForTimeout(200);
      const afterMirror = await groundsNow();

      // Path 3: drag the palette entry onto the canvas, which is a different
      // code path from a palette click and the one most likely to skip the rule.
      let dragNote = "not attempted";
      try {
        const tagged = await page.evaluate(() => {
          const item = [...document.querySelectorAll("button.palette-item")]
            .find((b) => b.querySelector(".palette-name")?.textContent?.trim() === "Ground");
          if (!item) return false;
          item.setAttribute("data-shot-target", "1");
          return true;
        });
        if (tagged) {
          const { canvas, box, usableWidth } = await usableCanvas(page);
          await page.locator('button.palette-item[data-shot-target="1"]').hover();
          await page.mouse.down();
          await page.mouse.move(box.x + usableWidth * 0.35, box.y + box.height * 0.72, { steps: 12 });
          await page.mouse.up();
          await page.waitForTimeout(250);
          await canvas.click({ position: { x: usableWidth * 0.35, y: box.height * 0.72 } }).catch(() => {});
          await page.keyboard.press("Escape");
          await page.evaluate(() => document.querySelector('[data-shot-target="1"]')?.removeAttribute("data-shot-target"));
          dragNote = "attempted";
        }
      } catch (err) {
        dragNote = `threw: ${err instanceof Error ? err.message : String(err)}`;
      }
      await page.waitForTimeout(200);
      const afterDrag = await groundsNow();
      await shot(page, `P3-08-ground-${ctx.tag}`);

      const all = afterDrag.length ? afterDrag : afterMirror;
      const bad = all.filter((g) => g.rot !== 0 || g.mir);
      // A ghost that is upright either carries no rotate() at all or rotate(0).
      const ghostUpright = ghost.present
        ? (ghost.placeRotation === 0 || ghost.placeRotation === null)
          && !ghost.placeMirror
          && !/rotate\(\s*(?!0[\s)])-?\d/.test(ghost.transform ?? "")
        : null;
      return {
        pass: all.length > 0 && bad.length === 0 && ghostUpright === true && armedRotation !== 0,
        detail: `armed placeRotation on the previous part: ${armedRotation}`
          + `${armedRotation === 0 ? " -- CHECK IS TOOTHLESS, the sticky rotation never armed" : ""}; `
          + `GHOST for ground while that rotation is armed: present ${ghost.present}, `
          + `transform "${ghost.transform}", placeRotation ${ghost.placeRotation}, `
          + `placeMirror ${ghost.placeMirror} -> upright: ${ghostUpright} `
          + `(this is what the report photographed - dashed strokes are .ghost .symbol); `
          + `tool state before the mirrored drop: ${JSON.stringify(armedMirror)}; `
          + `DROPPED grounds: click ${JSON.stringify(afterClick)}, mirrored-tool ${JSON.stringify(afterMirror)}, `
          + `drag (${dragNote}) ${JSON.stringify(afterDrag)}; ${bad.length} of ${all.length} not pin-up`,
        data: { ghost, ghostUpright, afterClick, afterMirror, afterDrag, dragNote },
      };
    },
  },

  {
    id: "P3-10",
    title: "fit-to-view centres the circuit in the visible canvas",
    async run(page, ctx) {
      await freshSchematic(page, `p3-10-${ctx.tag}`, densyAsc());
      await page.waitForTimeout(400);
      // Pan hard away so a no-op fit is unmistakable.
      const { canvas, box } = await usableCanvas(page);
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await page.mouse.down({ button: "middle" }).catch(() => {});
      await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.15, { steps: 8 });
      await page.mouse.up({ button: "middle" }).catch(() => {});
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
      await shot(page, `P3-10-panned-${ctx.tag}`);

      const fitBtn = page.getByRole("button", { name: "Fit circuit to view" });
      const present = await fitBtn.count();
      if (present === 0) return { pass: false, detail: "no button named 'Fit circuit to view' in the DOM", data: {} };
      await fitBtn.click({ force: true });
      await page.waitForTimeout(450);
      const centred = await page.evaluate(() => {
        const svg = document.querySelector("svg.canvas");
        const rail = document.querySelector(".components-rail");
        const drawer = document.querySelector(".results-drawer, .bottom-drawer");
        const parts = [...document.querySelectorAll("svg.canvas .component, svg.canvas .label-layer text")];
        if (!svg || parts.length === 0) return null;
        const c = svg.getBoundingClientRect();
        const railBox = rail?.getBoundingClientRect();
        const drawerBox = drawer?.getBoundingClientRect();
        const visible = {
          left: c.left,
          right: railBox && railBox.left < c.right ? railBox.left : c.right,
          top: c.top,
          bottom: drawerBox && drawerBox.top < c.bottom ? drawerBox.top : c.bottom,
        };
        const unionOf = (els) => {
          let l = Infinity, r = -Infinity, t = Infinity, b = -Infinity;
          for (const p of els) {
            const pr = p.getBoundingClientRect();
            if (pr.width === 0 && pr.height === 0) continue;
            l = Math.min(l, pr.left); r = Math.max(r, pr.right);
            t = Math.min(t, pr.top); b = Math.max(b, pr.bottom);
          }
          return Number.isFinite(l) ? { l, r, t, b } : null;
        };
        // Split the union so a miss can be attributed. If the symbols-only box
        // is centred but the labels-included box is not, the fit is right and
        // the labels simply hang further one way than the other; if BOTH are
        // off by the same amount, the fit is off.
        const symbolsBox = unionOf([...document.querySelectorAll("svg.canvas .component")]);
        const labelsBox = unionOf([...document.querySelectorAll("svg.canvas .label-layer text")]);
        const cx = (visible.left + visible.right) / 2;
        const cy = (visible.top + visible.bottom) / 2;
        const offsetOf = (bx) => bx && ({
          dx: Math.round(((bx.l + bx.r) / 2) - cx),
          dy: Math.round(((bx.t + bx.b) / 2) - cy),
        });
        const symbolsOffset = offsetOf(symbolsBox);
        const labelsOffset = offsetOf(labelsBox);
        const drawerRect = drawerBox && {
          top: Math.round(drawerBox.top), height: Math.round(drawerBox.height),
          cls: drawer?.className ?? null,
        };
        let { l, r, t, b } = unionOf(parts) ?? { l: Infinity, r: -Infinity, t: Infinity, b: -Infinity };
        return {
          visible: { w: Math.round(visible.right - visible.left), h: Math.round(visible.bottom - visible.top) },
          dxCentre: Math.round(((l + r) / 2) - ((visible.left + visible.right) / 2)),
          dyCentre: Math.round(((t + b) / 2) - ((visible.top + visible.bottom) / 2)),
          artWidth: Math.round(r - l), artHeight: Math.round(b - t),
          insideVisible: l >= visible.left - 1 && r <= visible.right + 1 && t >= visible.top - 1 && b <= visible.bottom + 1,
          railOpen: Boolean(railBox && railBox.width > 0),
          symbolsOffset,
          labelsOffset,
          drawerRect,
          canvasBottom: Math.round(c.bottom),
          visibleBottom: Math.round(visible.bottom),
        };
      });
      await shot(page, `P3-10-fitted-${ctx.tag}`);
      if (!centred) return { pass: false, detail: "nothing measurable on the canvas after fit", data: {} };
      /*
       * TWO clauses, and the split is deliberate - an earlier single clause
       * demanded that the union of symbols AND labels be centred, which is the
       * wrong thing to ask for.
       *
       * Ref/value labels hang below and to the right of their parts, so the
       * union's centre sits down-right of the circuit's. Centring the union
       * would therefore push the CIRCUIT up-left to compensate, and a reader
       * would see an off-centre schematic. What "autocentre" means is that the
       * circuit is centred and nothing is cut off.
       *
       * This is not the gate being relaxed to pass: measured on the pre-fix
       * tree, symbols-only was off by dx=134px - half the 264px parts rail,
       * which is the whole defect - and insideVisible was false. Both clauses
       * below still fail that tree.
       */
      const tol = 2;
      const sym = centred.symbolsOffset;
      const circuitCentred = Boolean(sym) && Math.abs(sym.dx) <= tol && Math.abs(sym.dy) <= tol;
      const pass = circuitCentred && centred.insideVisible;
      return {
        pass,
        detail: `after a hard pan then fit, in a ${centred.visible.w}x${centred.visible.h} visible box `
          + `(rail open: ${centred.railOpen}): CIRCUIT centred to dx=${sym?.dx}px dy=${sym?.dy}px `
          + `(tolerance ${tol}px) -> ${circuitCentred}; everything incl. labels fully inside: ${centred.insideVisible}; `
          + `informational - labels hang ${JSON.stringify(centred.labelsOffset)} off centre, which is why the `
          + `symbols+labels union reads dx=${centred.dxCentre} dy=${centred.dyCentre}; `
          + `artwork ${centred.artWidth}x${centred.artHeight}`,
        data: centred,
      };
    },
  },

  {
    id: "P3-11",
    title: "Backspace deletes a selected net label",
    async run(page, ctx) {
      await freshSchematic(page, `p3-11-${ctx.tag}`);
      await place(page, "Resistor", 0.35, 0.4);
      // Net-label tool, click a spot, name it.
      await page.getByRole("button", { name: /Net label/i }).first().click();
      const { canvas, box, usableWidth } = await usableCanvas(page);
      await canvas.click({ position: { x: usableWidth * 0.5, y: box.height * 0.55 } });
      await page.waitForTimeout(200);
      const typed = await page.locator("input.net-label-input").count();
      if (typed > 0) {
        await page.locator("input.net-label-input").fill("endn");
        await page.keyboard.press("Enter");
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);

      const created = await page.evaluate(() => window.__TAU_DEV__.useSchematic.getState().netLabels.length);
      await shot(page, `P3-11-labelled-${ctx.tag}`);
      if (created === 0) {
        return { pass: false, detail: "could not create a net label at all (0 in the store after the label tool + click + Enter)", data: {} };
      }

      // Select it by clicking its glyph, then Backspace.
      const glyph = page.locator("text.net-label-text").first();
      await glyph.click({ force: true });
      await page.waitForTimeout(150);
      const selected = await page.evaluate(() => window.__TAU_DEV__.useSchematic.getState().selectedLabelIds.length);
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(250);
      const afterBackspace = await page.evaluate(() => window.__TAU_DEV__.useSchematic.getState().netLabels.length);

      // Undo must bring it back, and Delete must work too.
      await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
      await page.waitForTimeout(250);
      const afterUndo = await page.evaluate(() => window.__TAU_DEV__.useSchematic.getState().netLabels.length);
      let afterDelete = afterUndo;
      if (afterUndo > 0) {
        await page.locator("text.net-label-text").first().click({ force: true });
        await page.waitForTimeout(150);
        await page.keyboard.press("Delete");
        await page.waitForTimeout(250);
        afterDelete = await page.evaluate(() => window.__TAU_DEV__.useSchematic.getState().netLabels.length);
      }
      await shot(page, `P3-11-deleted-${ctx.tag}`);
      return {
        pass: selected > 0 && afterBackspace === created - 1 && afterUndo === created && afterDelete === created - 1,
        detail: `created ${created}; click selected ${selected} label id(s); after Backspace ${afterBackspace}; `
          + `after undo ${afterUndo}; after Delete ${afterDelete}`,
        data: { created, selected, afterBackspace, afterUndo, afterDelete },
      };
    },
  },

  {
    id: "P3-12/13",
    title: "the tool strip reads as real objects, in colour",
    async run(page, ctx) {
      await freshSchematic(page, `p3-13-${ctx.tag}`);
      await place(page, "Resistor", 0.35, 0.4);
      await page.waitForTimeout(200);
      /*
       * Judged in HSL, not by raw channel spread.
       *
       * A first version of this check used max-minus-min channel and passed the
       * LIGHT theme with zero colour applied: the strip's neutral ink there is
       * rgb(78, 92, 110), a blue-grey whose channel spread is 32. Saturation
       * tells the truth about it (0.17 - neutral), and hue tells the truth about
       * whether two tools really differ rather than being two shades of one
       * accent. So: an accent needs saturation, and "distinct" needs hue
       * separation.
       */
      const strip = await page.evaluate(() => {
        const hsl = (rgb) => {
          const [r, g, b] = (rgb.match(/[\d.]+/g) ?? [0, 0, 0]).map((n) => Number(n) / 255);
          const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
          if (max === min) return { h: 0, s: 0, l };
          const d = max - min;
          const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
          let h;
          if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
          else if (max === g) h = (b - r) / d + 2;
          else h = (r - g) / d + 4;
          return { h: h * 60, s, l };
        };
        const btns = [...document.querySelectorAll(".editor-toolbar .editor-icon-btn")];
        return btns.map((b) => {
          const raw = [...b.querySelectorAll("svg, svg *")].flatMap((el) => {
            const cs = getComputedStyle(el);
            return [cs.stroke, cs.fill, cs.color].filter((c) => c && c !== "none" && !/rgba\([^)]*,\s*0\)/.test(c));
          });
          const parsed = [...new Set(raw)].map((c) => ({ c, ...hsl(c) }));
          const dominant = parsed.slice().sort((x, y) => y.s - x.s)[0] ?? null;
          return {
            label: b.getAttribute("aria-label"),
            disabled: b.disabled,
            colours: parsed.map((p) => `${p.c} h${Math.round(p.h)} s${p.s.toFixed(2)}`).slice(0, 3),
            hue: dominant ? Math.round(dominant.h) : null,
            sat: dominant ? Number(dominant.s.toFixed(2)) : null,
          };
        });
      });
      await page.locator(".editor-toolbar").screenshot({ path: path.join(outDir, `P3-13-strip-${ctx.tag}.png`) }).catch(() => {});
      await shot(page, `P3-13-editor-${ctx.tag}`);

      const SAT = 0.3;      // below this a colour reads as ink, not as an accent
      const HUE_SEP = 25;   // two accents closer than this read as one colour
      const enabled = strip.filter((b) => !b.disabled);
      const accented = enabled.filter((b) => (b.sat ?? 0) >= SAT);
      const hues = accented.map((b) => b.hue).sort((a, b) => a - b);
      const distinct = hues.filter((h, i) => i === 0 || Math.abs(h - hues[i - 1]) > HUE_SEP).length;
      const probe = strip.find((b) => /probe/i.test(b.label ?? ""));
      /*
       * The probe BUTTON is now the meter (orange bezel and dial), not a red
       * lead - the red lives on the canvas cursor, which this DOM probe cannot
       * see because it is an inline `style="cursor:url(…)"`. So the button is
       * checked for the meter's amber-orange, and the cursor's red is pinned by
       * the unit test that parses probeCursor()'s emitted SVG and requires the
       * declared hotspot to equal the needle's own first coordinate.
       *
       * An earlier version of this check asserted hue <= 25 or >= 335 on the
       * button. It would now fail correct code, for the same reason the P3-01
       * and P3-14 checks did: it encoded a design the product had moved past.
       */
      const probeIsMeter = Boolean(probe && (probe.sat ?? 0) >= SAT
        && probe.hue >= 18 && probe.hue <= 50);
      /*
       * A COUNT, not a percentage, and deliberately.
       *
       * The brief names a "gray trascan" and a "pink/grey metal erase" - so a
       * neutral trash can and a partly-neutral eraser are the brief being
       * followed, and a rule like "60% of icons must be saturated" would mark
       * that as a failure. Five accents (wire, tag, probe, undo, redo is the
       * natural set) plus three distinct hues is enough to prove the strip is no
       * longer nine identical greys, without dictating a rainbow the instrument
       * aesthetic would reject.
       */
      const need = 5;
      return {
        pass: enabled.length > 0 && accented.length >= need && probeIsMeter && distinct >= 3,
        detail: `${strip.length} tool buttons (${enabled.length} enabled); ${accented.length}/${need} carry a real `
          + `accent (saturation >= ${SAT}); ${distinct} hues distinct by > ${HUE_SEP}deg `
          + `[${accented.map((b) => `${b.label}:h${b.hue}/s${b.sat}`).join(", ") || "none"}]; `
          + `probe button reads as the meter's amber-orange: ${probeIsMeter} `
          + `(${probe ? `h${probe.hue} s${probe.sat}` : "no probe button found"}); `
          + `the red lead is on the cursor, pinned by probeCursor()'s unit test`,
        data: strip,
      };
    },
  },

  {
    id: "P3-14",
    title: "the schematic dock is Errors only and flags problems before Run",
    async run(page, ctx) {
      await freshSchematic(page, `p3-14-${ctx.tag}`);

      /*
       * Two questions, and the order matters.
       *
       * First: does the dock flag a broken schematic BEFORE any run? A lone
       * resistor has no ground, no source and two floating pins - three error
       * classes the report expects to see without pressing Run.
       *
       * Second: is the Measurements tab really gone from schematic mode? Asking
       * that on an empty sheet proves nothing, because App.tsx already drops the
       * tab when there are no measurement rows to show. It has to be asked in
       * the state where measurements EXIST - after a real run - which is why
       * this check runs the built-in RC example and comes back.
       */
      await place(page, "Resistor", 0.4, 0.45);
      await page.waitForTimeout(600);
      const preRun = await page.evaluate(() => {
        const drawer = document.querySelector(".results-drawer") ?? document.querySelector("[class*='results-drawer']");
        const rows = [...document.querySelectorAll(".bottom-errors *")]
          .filter((el) => el.children.length === 0 && (el.textContent ?? "").trim().length > 0)
          .map((el) => el.textContent.trim());
        return {
          rows: [...new Set(rows)].slice(0, 12),
          text: drawer?.textContent?.replace(/\s+/g, " ").trim().slice(0, 500) ?? null,
        };
      });
      await shot(page, `P3-14-prerun-${ctx.tag}`);

      // Now a circuit that really simulates, so measurements exist.
      let ranNote = "not attempted";
      try {
        const rc = page.getByRole("button", { name: /Try RC Charging/i });
        if (await rc.count()) {
          await rc.first().click();
          await page.waitForTimeout(900);
        }
        const run = page.getByRole("button", { name: /^Run simulation$/i });
        if (await run.count()) {
          await run.first().click({ force: true });
          await page.waitForTimeout(3_500);
          ranNote = "ran";
        } else {
          ranNote = "no Run button found";
        }
        /*
         * Back to the schematic editor - the Measurements tab must be absent
         * HERE, and only here is the claim worth anything. This is the exact
         * leak: leaving the simulator does not invalidate the analysis, so a
         * populated Measurements tab used to follow the reader back into the
         * editor.
         *
         * Two routes because one is not enough: the editor tab row's "Return to
         * schematic editor" arrow only exists while the simulator tab strip is
         * mounted, and an earlier version of this check relied on it alone,
         * silently stayed in Simulator, and measured the wrong mode. The
         * toolbar's mode toggle (Toolbar.tsx:213, aria-label "Schematic") is
         * always present, so it is the fallback - and the mode is asserted
         * afterwards rather than assumed.
         */
        const back = page.getByRole("button", { name: /Return to schematic editor/i });
        if (await back.count()) {
          await back.first().click();
          await page.waitForTimeout(500);
        }
        const toggle = page.locator('.mode-toggle button[aria-label="Schematic"]');
        if (await toggle.count()) {
          await toggle.first().click({ force: true });
          await page.waitForTimeout(600);
        }
      } catch (err) {
        ranNote = `threw: ${err instanceof Error ? err.message : String(err)}`;
      }
      await page.waitForTimeout(500);
      const dock = await page.evaluate(() => {
        // Scope to the drawer: the editor's file tabs also carry role="tab",
        // and counting them made an earlier version of this check report the
        // open filename as a dock tab.
        const drawer = document.querySelector(".results-drawer") ?? document.querySelector("[class*='results-drawer']");
        const tabs = [...(drawer?.querySelectorAll('[role="tab"]') ?? [])]
          .map((t) => t.textContent?.replace(/\s+/g, " ").trim());
        const rows = [...document.querySelectorAll(".bottom-errors *")]
          .filter((el) => el.children.length === 0 && (el.textContent ?? "").trim().length > 0)
          .map((el) => el.textContent.trim());
        const badge = drawer?.querySelector("[class*=badge]");
        return {
          tabs,
          hasMeasurementsTab: tabs.some((t) => /measurement/i.test(t ?? "")),
          /*
           * A heading counts, not just a tab - and this check used to get that
           * backwards. The contract's own clause is "no tab strip if there is
           * one item", so a correctly-fixed schematic dock withholds both
           * Measurements and Waveforms and renders a bare
           * <h2 class="results-drawer-section">Errors</h2> with no [role=tab]
           * anywhere. Demanding a tab therefore scored the fix as a failure.
           * `hasMeasurementsTab` stays as it is: its ABSENCE is the thing under
           * test, and absence is measured the same either way.
           */
          hasErrorsTab: tabs.some((t) => /error/i.test(t ?? ""))
            || /error/i.test(drawer?.querySelector(".results-drawer-section")?.textContent ?? ""),
          errorsSurface: tabs.some((t) => /error/i.test(t ?? "")) ? "tab" : "heading",
          drawerFound: Boolean(drawer),
          drawerText: drawer?.textContent?.replace(/\s+/g, " ").trim().slice(0, 400) ?? null,
          rows: [...new Set(rows)].slice(0, 12),
          badgeText: badge?.textContent?.trim() ?? null,
        };
      });
      await shot(page, `P3-14-dock-${ctx.tag}`);
      const flagsPreRun = preRun.rows.length > 0
        || /no ground|ground reference|no source|floating|unconnected|not connected/i.test(preRun.text ?? "");
      const mode = await page.evaluate(() => {
        const pressed = document.querySelector('.mode-toggle [aria-pressed="true"]');
        return pressed?.getAttribute("aria-label") ?? pressed?.textContent?.trim()
          ?? document.querySelector("[data-mode]")?.getAttribute("data-mode") ?? "unknown";
      });
      // Asserting the mode is the point: "Measurements is absent" proves nothing
      // if it was measured in the simulator, where its absence means something
      // else entirely.
      const inSchematic = /schematic/i.test(mode);
      return {
        pass: inSchematic && !dock.hasMeasurementsTab && dock.hasErrorsTab && flagsPreRun,
        detail: `pre-run, a lone ungrounded resistor produced ${preRun.rows.length} diagnostic row(s) `
          + `-> flagged: ${flagsPreRun}; then after ${ranNote}, back in mode "${mode}" (schematic: ${inSchematic}), `
          + `dock tabs are [${dock.tabs.join(", ")}] - Measurements present: ${dock.hasMeasurementsTab}, `
          + `Errors present: ${dock.hasErrorsTab} (as a ${dock.errorsSurface}), badge "${dock.badgeText}"`,
        data: { preRun, dock, ranNote, mode },
      };
    },
  },
];

/* ── driver ──────────────────────────────────────────────────────────────── */

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
          const mark = outcome.pass ? "PASS" : "FAIL";
          console.log(`${mark}  ${check.id} @ ${tag} — ${outcome.detail}`);
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
    `# PDF-3 verification — ${label}`,
    "",
    `${checks.length - failed.length}/${checks.length} check runs passed `
      + `(${[...byId.keys()].filter((id) => byId.get(id).every((r) => r.pass)).length}/${byId.size} items green in every theme and viewport).`,
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
