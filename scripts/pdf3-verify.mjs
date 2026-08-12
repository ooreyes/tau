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
 * A deliberately cramped sheet: twelve parts on a 64-unit pitch with long
 * values, which is the condition the report's overlap screenshot was taken in.
 * Written as `.asc` text rather than placed part-by-part so the layout is
 * byte-identical on every run — a label-collision invariant that only holds for
 * some random layouts is not an invariant.
 */
function densyAsc() {
  const lines = ["Version 4", "SHEET 1 1200 900"];
  const kinds = [
    ["res", "R", "1k"],
    ["cap", "C", "1µ"],
    ["ind", "L", "10m"],
    ["res", "R", "4.7Meg"],
  ];
  let n = 0;
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const [sym, prefix, value] = kinds[col];
      n += 1;
      const x = 160 + col * 64;
      const y = 160 + row * 64;
      lines.push(`SYMBOL ${sym} ${x} ${y} R0`);
      lines.push(`SYMATTR InstName ${prefix}${n}`);
      lines.push(`SYMATTR Value ${value}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

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

      // Switch the waveform through the real control.
      const switched = await page.evaluate(() => {
        const selects = [...document.querySelectorAll(".component-inspector select")];
        const wave = selects.find((s) => [...s.options].some((o) => /sine/i.test(o.textContent ?? "")));
        if (!wave) return { ok: false, reason: "no waveform select in the inspector" };
        const option = [...wave.options].find((o) => /sine/i.test(o.textContent ?? ""));
        wave.value = option.value;
        wave.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, chose: option.textContent?.trim() };
      });
      if (!switched.ok) {
        return { pass: false, detail: `could not reach the waveform control: ${switched.reason}`, data: { before } };
      }
      await page.waitForTimeout(300);
      const after = await read();
      await shot(page, `P3-01-sine-${ctx.tag}`);

      const identityChanged = before.kind !== after.kind;
      const titleClean = !/dc source/i.test(after.titleText ?? "") && !/DC source/.test(after.inspectorText);
      const noDoubleBias = !(/dc operating point/i.test(after.inspectorText) && /(^|\s)offset/i.test(after.inspectorText));
      const captionSine = after.caption.some((t) => /sine|sin/i.test(t)) || /SINE/i.test(after.value ?? "");
      const pass = identityChanged && titleClean && noDoubleBias && captionSine;
      return {
        pass,
        detail: `kind ${before.kind} -> ${after.kind}; title "${after.titleText}"; `
          + `"DC source" still present in inspector: ${!titleClean}; `
          + `DC-operating-point and Offset both shown: ${!noDoubleBias}; `
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
      await freshSchematic(page, `p3-04a-${ctx.tag}`);
      const m = await page.evaluate(() => {
        const head = document.querySelector(".explorer-head");
        const trigger = document.querySelector(".explorer-overflow-trigger");
        const name = document.querySelector(".explorer-root-name");
        if (!head || !trigger || !name) {
          return { missing: { head: !head, trigger: !trigger, name: !name } };
        }
        const h = head.getBoundingClientRect();
        const t = trigger.getBoundingClientRect();
        const n = name.getBoundingClientRect();
        return {
          headRight: Math.round(h.right), triggerRight: Math.round(t.right),
          triggerWidth: Math.round(t.width), triggerVisible: t.width > 0 && t.height > 0,
          insideHead: t.right <= h.right + 1 && t.left >= h.left - 1,
          gapToName: Math.round(t.left - n.right),
          nameTruncated: name.scrollWidth > name.clientWidth + 1,
          headOverflowing: head.scrollWidth > head.clientWidth + 1,
        };
      });
      await shot(page, `P3-04A-header-${ctx.tag}`);
      if (m.missing) return { pass: false, detail: `header parts missing: ${JSON.stringify(m.missing)}`, data: m };
      const pass = m.triggerVisible && m.insideHead && m.gapToName >= 8 && !m.headOverflowing;
      return {
        pass,
        detail: `overflow trigger ${m.triggerWidth}px wide, inside header: ${m.insideHead}, `
          + `gap to root name: ${m.gapToName}px (need >= 8), header overflowing: ${m.headOverflowing}`,
        data: m,
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
      const children = rows.filter((r) => !r.isRoot);
      const rootIndent = rootRow?.contentLeft ?? 0;
      const flush = children.filter((r) => r.contentLeft <= rootIndent);
      const nested = rows.find((r) => /nested\.asc/.test(r.text ?? ""));
      const folder = rows.find((r) => /Project Storage/.test(r.text ?? ""));
      const deeperThanFolder = nested && folder ? nested.contentLeft > folder.contentLeft : null;
      return {
        pass: flush.length === 0 && deeperThanFolder === true,
        detail: `root row content at ${rootIndent}px; ${flush.length} child row(s) flush with or left of it `
          + `(${flush.map((r) => `${r.text}@${r.contentLeft}`).join(", ") || "none"}); `
          + `nested.asc at ${nested?.contentLeft}px vs its folder at ${folder?.contentLeft}px -> deeper: ${deeperThanFolder}`,
        data: rows,
      };
    },
  },

  {
    id: "P3-07",
    title: "no two labels overlap, ever",
    async run(page, ctx) {
      await freshSchematic(page, `p3-07-${ctx.tag}`, densyAsc());
      await page.waitForTimeout(500);
      const overlaps = await page.evaluate(() => {
        const texts = [...document.querySelectorAll(".label-layer text.ref, .label-layer text.val, .net-label-layer text.net-label-text")];
        const boxes = texts.map((t) => {
          const r = t.getBoundingClientRect();
          return { text: t.textContent?.trim(), cls: t.getAttribute("class"), x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom };
        }).filter((b) => b.w > 0 && b.h > 0);
        const hits = [];
        for (let i = 0; i < boxes.length; i += 1) {
          for (let j = i + 1; j < boxes.length; j += 1) {
            const a = boxes[i], c = boxes[j];
            const ox = Math.min(a.r, c.r) - Math.max(a.x, c.x);
            const oy = Math.min(a.b, c.b) - Math.max(a.y, c.y);
            if (ox > 0.5 && oy > 0.5) {
              hits.push({ a: a.text, b: c.text, overlapPx: `${ox.toFixed(1)}x${oy.toFixed(1)}` });
            }
          }
        }
        return { count: boxes.length, hits };
      });
      await shot(page, `P3-07-dense-${ctx.tag}`);
      return {
        pass: overlaps.hits.length === 0,
        detail: `${overlaps.count} label boxes measured on a 12-part sheet at 64-unit pitch; `
          + `${overlaps.hits.length} overlapping pair(s)`
          + (overlaps.hits.length ? `: ${overlaps.hits.slice(0, 6).map((h) => `"${h.a}"x"${h.b}" ${h.overlapPx}px`).join("; ")}` : ""),
        data: overlaps,
      };
    },
  },

  {
    id: "P3-08",
    title: "ground lands pin-up on every placement path",
    async run(page, ctx) {
      await freshSchematic(page, `p3-08-${ctx.tag}`);
      // Rotate the placement tool first: a sticky rotation from a previous part
      // is the most likely way a ground ends up sideways, so provoke it.
      await place(page, "Resistor", 0.25, 0.3);
      await page.keyboard.press("r");
      await page.keyboard.press("r");
      await place(page, "Ground", 0.45, 0.55);
      await page.waitForTimeout(200);
      const state = await page.evaluate(() => {
        const s = window.__TAU_DEV__.useSchematic.getState();
        return s.components
          .filter((c) => c.kind === "ground")
          .map((c) => ({ id: c.id, kind: c.kind, rotation: c.rotation, mirrored: Boolean(c.mirrored) }));
      });
      await shot(page, `P3-08-ground-${ctx.tag}`);
      const bad = state.filter((g) => g.rotation !== 0 || g.mirrored);
      return {
        pass: state.length > 0 && bad.length === 0,
        detail: `${state.length} ground(s) placed after two tool rotations; `
          + `orientations ${JSON.stringify(state.map((g) => ({ rot: g.rotation, mir: g.mirrored })))}; `
          + `${bad.length} not pin-up`,
        data: state,
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
        let l = Infinity, r = -Infinity, t = Infinity, b = -Infinity;
        for (const p of parts) {
          const pr = p.getBoundingClientRect();
          if (pr.width === 0 && pr.height === 0) continue;
          l = Math.min(l, pr.left); r = Math.max(r, pr.right);
          t = Math.min(t, pr.top); b = Math.max(b, pr.bottom);
        }
        return {
          visible: { w: Math.round(visible.right - visible.left), h: Math.round(visible.bottom - visible.top) },
          dxCentre: Math.round(((l + r) / 2) - ((visible.left + visible.right) / 2)),
          dyCentre: Math.round(((t + b) / 2) - ((visible.top + visible.bottom) / 2)),
          artWidth: Math.round(r - l), artHeight: Math.round(b - t),
          insideVisible: l >= visible.left - 1 && r <= visible.right + 1 && t >= visible.top - 1 && b <= visible.bottom + 1,
          railOpen: Boolean(railBox && railBox.width > 0),
        };
      });
      await shot(page, `P3-10-fitted-${ctx.tag}`);
      if (!centred) return { pass: false, detail: "nothing measurable on the canvas after fit", data: {} };
      // 1px is the report's bar; allow 2px for sub-pixel text metrics on the
      // union box, and say so rather than quietly widening it.
      const tol = 2;
      const pass = Math.abs(centred.dxCentre) <= tol && Math.abs(centred.dyCentre) <= tol && centred.insideVisible;
      return {
        pass,
        detail: `after a hard pan then fit: artwork centre is off by dx=${centred.dxCentre}px dy=${centred.dyCentre}px `
          + `(tolerance ${tol}px) in a ${centred.visible.w}x${centred.visible.h} visible box; `
          + `artwork ${centred.artWidth}x${centred.artHeight} fully inside: ${centred.insideVisible}; rail open: ${centred.railOpen}`,
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
      const strip = await page.evaluate(() => {
        const chroma = (rgb) => {
          const [r, g, b] = (rgb.match(/[\d.]+/g) ?? [0, 0, 0]).map(Number);
          return Math.max(r, g, b) - Math.min(r, g, b);
        };
        const btns = [...document.querySelectorAll(".editor-toolbar .editor-icon-btn")];
        return btns.map((b) => {
          const colours = [...b.querySelectorAll("svg, svg *")].flatMap((el) => {
            const cs = getComputedStyle(el);
            return [cs.stroke, cs.fill, cs.color].filter((c) => c && c !== "none" && !/rgba\(0, 0, 0, 0\)/.test(c));
          });
          return {
            label: b.getAttribute("aria-label"),
            disabled: b.disabled,
            maxChroma: Math.max(0, ...colours.map(chroma)),
            colours: [...new Set(colours)].slice(0, 4),
          };
        });
      });
      await page.locator(".editor-toolbar").screenshot({ path: path.join(outDir, `P3-13-strip-${ctx.tag}.png`) }).catch(() => {});
      await shot(page, `P3-13-editor-${ctx.tag}`);

      const enabled = strip.filter((b) => !b.disabled);
      const coloured = enabled.filter((b) => b.maxChroma > 12);
      const probe = strip.find((b) => /probe/i.test(b.label ?? ""));
      const probeRed = probe ? probe.colours.some((c) => {
        const [r, g, b] = (c.match(/[\d.]+/g) ?? [0, 0, 0]).map(Number);
        return r > 110 && r > g * 1.5 && r > b * 1.5;
      }) : false;
      const distinctAccents = new Set(enabled.filter((b) => b.maxChroma > 12).map((b) => b.colours[0])).size;
      return {
        pass: enabled.length > 0 && coloured.length >= Math.max(4, Math.ceil(enabled.length * 0.6)) && probeRed && distinctAccents >= 3,
        detail: `${strip.length} tool buttons (${enabled.length} enabled); ${coloured.length} carry a chromatic accent `
          + `(chroma > 12); ${distinctAccents} distinct accents; probe button reads red: ${probeRed} `
          + `(${probe ? probe.colours.join(" | ") : "no probe button found"})`,
        data: strip,
      };
    },
  },

  {
    id: "P3-14",
    title: "the schematic dock is Errors only and flags problems before Run",
    async run(page, ctx) {
      await freshSchematic(page, `p3-14-${ctx.tag}`);
      // A resistor with no ground and no source: several classes of error, and
      // not one simulation has been run.
      await place(page, "Resistor", 0.4, 0.45);
      await page.waitForTimeout(500);
      const dock = await page.evaluate(() => {
        const tabs = [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent?.replace(/\s+/g, " ").trim());
        const drawer = document.querySelector(".results-drawer") ?? document.querySelector("[class*=drawer]");
        const rows = [...document.querySelectorAll(".bottom-errors *")]
          .filter((el) => el.children.length === 0 && (el.textContent ?? "").trim().length > 0)
          .map((el) => el.textContent.trim());
        const badge = document.querySelector(".results-drawer-tab .badge, [class*=badge]");
        return {
          tabs,
          hasMeasurementsTab: tabs.some((t) => /measurement/i.test(t ?? "")),
          hasErrorsTab: tabs.some((t) => /error/i.test(t ?? "")),
          drawerText: drawer?.textContent?.replace(/\s+/g, " ").trim().slice(0, 400) ?? null,
          rows: [...new Set(rows)].slice(0, 12),
          badgeText: badge?.textContent?.trim() ?? null,
        };
      });
      await shot(page, `P3-14-dock-${ctx.tag}`);
      const flagsSomething = dock.rows.length > 0 || /ground|source|floating|unconnected|no .*(ground|source)/i.test(dock.drawerText ?? "");
      return {
        pass: !dock.hasMeasurementsTab && flagsSomething,
        detail: `schematic-mode dock tabs [${dock.tabs.join(", ")}]; Measurements tab present: ${dock.hasMeasurementsTab}; `
          + `pre-run diagnostics surfaced for a lone ungrounded resistor: ${flagsSomething} `
          + `(${dock.rows.length} row(s), badge "${dock.badgeText}")`,
        data: dock,
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
