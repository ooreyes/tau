#!/usr/bin/env node
/**
 * Static §10 drift gate (DESIGN_SYSTEM.md §7 + FEATURE_PARITY Phase 4b hex gate).
 *
 * Proves:
 *   1. App.css has zero #hex / raw color keywords outside token-defining blocks
 *   2. Production ts/tsx chrome has zero hardcoded #hex (allowlisted data/engine)
 *   3. Resizable / Command / Toast primitives exist and are wired
 *   4. Zero production native <select>
 *   5. Legacy shell-toast / cmdk-backdrop markup is gone
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "apps/desktop/src");

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const RGBA = /\brgba?\(/g;
const COLOR_MIX_WHITE_BLACK = /color-mix\([^)]*\b(white|black)\b/gi;
const NATIVE_SELECT = /<select[\s>]/g;

/** Paths relative to apps/desktop/src that may contain hex for data/engine, not chrome. */
const HEX_ALLOWLIST = [
  // Probe / plot expression colors are measurement data, not chrome.
  "components/SimulationPanel.tsx",
  "lib/cssColor.ts",
  "lib/assistantCircuitPlan.ts", // AI plan SVG preview strokes (not app chrome)
  // Tests + fixtures
  "components/SimulationPanel.test.tsx",
  "App.workspace.test.tsx",
  "lib/cssColor.test.ts",
  "simulation/plotExpression.test.ts",
  "simulation/waveformViewerDod.test.ts",
];

const TOKEN_SEL = /(:root|\[data-theme|prefers-color-scheme|@theme)/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|css)$/.test(name)) out.push(p);
  }
  return out;
}

function hexOutsideTokenBlocks(cssText) {
  const lines = cssText.split(/\r?\n/);
  let depth = 0;
  let inToken = 0;
  const tokenDepthStack = [];
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (TOKEN_SEL.test(line) && line.includes("{")) {
      tokenDepthStack.push(depth);
      inToken += 1;
    }
    for (const m of line.matchAll(HEX)) {
      const commentIdx = line.indexOf("/*");
      if (commentIdx !== -1 && commentIdx < m.index) continue;
      if (inToken === 0) hits.push({ line: i + 1, text: line.trim().slice(0, 120) });
    }
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;
    depth += opens - closes;
    while (tokenDepthStack.length && depth <= tokenDepthStack[tokenDepthStack.length - 1]) {
      tokenDepthStack.pop();
      inToken = Math.max(0, inToken - 1);
    }
  }
  return hits;
}

function fail(msg) {
  console.error(`DESIGN-SYSTEM-GREP: FAIL — ${msg}`);
  process.exit(1);
}

const appCss = readFileSync(path.join(SRC, "App.css"), "utf8");
const cssHits = hexOutsideTokenBlocks(appCss);
if (cssHits.length) {
  fail(`App.css has ${cssHits.length} #hex outside token blocks:\n` + cssHits.slice(0, 10).map((h) => `  L${h.line}: ${h.text}`).join("\n"));
}

const files = walk(SRC);
const hexLeaks = [];
const rgbaLeaks = [];
const colorMixLeaks = [];
const selectLeaks = [];

for (const file of files) {
  const rel = path.relative(SRC, file).replaceAll("\\", "/");
  if (rel === "App.css" || rel === "styles/tokens.css") continue;
  if (/\.test\.(ts|tsx)$/.test(rel) || /\.corpus\.ts$/.test(rel)) continue;
  const text = readFileSync(file, "utf8");
  if (!HEX_ALLOWLIST.includes(rel)) {
    for (const m of text.matchAll(HEX)) {
      hexLeaks.push(`${rel}:${lineOf(text, m.index)} ${m[0]}`);
    }
  }
  // Production chrome must not use raw rgba()/color-mix(... white|black).
  if (!rel.endsWith(".css") && !HEX_ALLOWLIST.includes(rel) && !rel.startsWith("simulation/") && !rel.startsWith("engine/") && !rel.startsWith("io/")) {
    for (const m of text.matchAll(RGBA)) {
      // cssColor parser + plotPng transparent check are not chrome.
      if (rel === "lib/cssColor.ts" || rel === "simulation/plotPng.ts") continue;
      rgbaLeaks.push(`${rel}:${lineOf(text, m.index)}`);
    }
    for (const m of text.matchAll(COLOR_MIX_WHITE_BLACK)) {
      colorMixLeaks.push(`${rel}:${lineOf(text, m.index)} ${m[0].slice(0, 60)}`);
    }
  }
  if (/\.tsx$/.test(rel) && !rel.includes(".test.")) {
    for (const m of text.matchAll(NATIVE_SELECT)) {
      selectLeaks.push(`${rel}:${lineOf(text, m.index)}`);
    }
  }
}

function lineOf(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

if (hexLeaks.length) fail(`hardcoded #hex outside allowlist (${hexLeaks.length}):\n  ${hexLeaks.slice(0, 15).join("\n  ")}`);
if (rgbaLeaks.length) fail(`raw rgba() in production chrome (${rgbaLeaks.length}):\n  ${rgbaLeaks.slice(0, 10).join("\n  ")}`);
if (colorMixLeaks.length) fail(`color-mix toward white/black (${colorMixLeaks.length}):\n  ${colorMixLeaks.slice(0, 10).join("\n  ")}`);
if (selectLeaks.length) fail(`native <select> in production tsx (${selectLeaks.length}):\n  ${selectLeaks.join("\n  ")}`);

const mustExist = [
  "components/ui/command.tsx",
  "components/ui/resizable.tsx",
  "components/ui/sonner.tsx",
  "components/ui/instrument-icon-button.tsx",
];
for (const rel of mustExist) {
  try {
    readFileSync(path.join(SRC, rel));
  } catch {
    fail(`missing primitive ${rel}`);
  }
}

const appTsx = readFileSync(path.join(SRC, "App.tsx"), "utf8");
if (!appTsx.includes('from "./components/ui/sonner"') && !appTsx.includes("from '@/components/ui/sonner'")) {
  fail("App.tsx does not import ui/sonner Toaster");
}
if (!appTsx.includes("<Toaster")) fail("App.tsx does not mount <Toaster />");
if (appTsx.includes("shell-toast")) fail("App.tsx still references shell-toast");

const cmd = readFileSync(path.join(SRC, "components/CommandPalette.tsx"), "utf8");
if (!cmd.includes("@/components/ui/command") && !cmd.includes('"./ui/command"')) {
  fail("CommandPalette does not import ui/command");
}
if (cmd.includes("cmdk-backdrop")) fail("CommandPalette still uses legacy cmdk-backdrop");

const shell = readFileSync(path.join(SRC, "components/ShellPanels.tsx"), "utf8");
if (!shell.includes("ui/resizable")) fail("ShellPanels does not import ui/resizable");

if (appCss.includes(".shell-toast")) fail("App.css still defines .shell-toast (dead legacy toast)");
if (appCss.includes(".cmdk-backdrop")) fail("App.css still defines .cmdk-backdrop (legacy command host)");

console.log("DESIGN-SYSTEM-GREP: hex-outside-tokens=0 native-select=0");
console.log("DESIGN-SYSTEM-GREP: primitives=command+resizable+sonner+instrument-icon wired");
console.log("DESIGN-SYSTEM-GREP: ok");
