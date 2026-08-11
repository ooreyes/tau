#!/usr/bin/env node

/**
 * Generate the project-owned seven-segment acceptance corpus. The files are
 * deliberately ordinary LTspice-compatible `.asc` text: no temporary paths,
 * user libraries, or proprietary symbols are involved.
 *
 * Usage:
 *   node scripts/generate-sevenseg-fixtures.mjs --write
 *   node scripts/generate-sevenseg-fixtures.mjs --check
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "fixtures", "ui-ux", "seven-segment");
const patterns = {
  0: "abcdef",
  1: "bc",
  2: "abdeg",
  3: "abcdg",
  4: "bcfg",
  5: "acdfg",
  6: "acdefg",
  7: "abc",
  8: "abcdefg",
  9: "abcdfg",
};

const wires = [
  "WIRE 160 288 440 288",
  "WIRE 208 304 440 304",
  "WIRE 256 320 440 320",
  "WIRE 304 336 440 336",
  "WIRE 520 288 680 288",
  "WIRE 520 304 632 304",
  "WIRE 520 320 584 320",
  "WIRE 520 336 736 336",
  "WIRE 440 352 440 520",
  "WIRE 160 368 160 520",
  "WIRE 208 384 208 520",
  "WIRE 256 400 256 520",
  "WIRE 304 416 304 520",
  "WIRE 680 368 680 520",
  "WIRE 632 384 632 520",
  "WIRE 584 400 584 520",
  "WIRE 736 416 736 520",
  "WIRE 80 520 800 520",
  "FLAG 80 520 0",
];

const sourcePins = [
  [160, 272, "a"],
  [208, 288, "b"],
  [256, 304, "c"],
  [304, 320, "d"],
  [680, 272, "e"],
  [632, 288, "f"],
  [584, 304, "g"],
  [736, 320, "dp"],
];

function ascFor(name, pattern, state) {
  const active = new Set(pattern);
  const lines = [
    "Version 4",
    "SHEET 1 880 680",
    ...wires,
    "SYMBOL res 480 320 R0",
    "SYMATTR InstName U1",
    "SYMATTR Value \"\"",
    "SYMATTR TauKind sevenSeg",
    "SYMATTR TauValue \"\"",
    "SYMATTR TauLabel U1",
  ];
  sourcePins.forEach(([x, y, segment], index) => {
    lines.push(
      `SYMBOL voltage ${x} ${y} R0`,
      `SYMATTR InstName V${index + 1}`,
      `SYMATTR Value ${active.has(segment) ? 5 : 0}`,
    );
  });
  lines.push(`TEXT 96 560 Left 2 !.tran 1m 10m`, `TEXT 96 592 Left 2 ; QA digit ${name}; state ${state}`);
  return `${lines.join("\n")}\n`;
}

const expected = new Map([
  ...Object.entries(patterns).map(([digit, pattern]) => [`digit-${digit}.asc`, ascFor(digit, pattern, "settled")]),
  ["live.asc", ascFor("8", patterns[8], "live")],
  ["stopped.asc", ascFor("8", patterns[8], "stopped")],
]);

const mode = process.argv.includes("--check") ? "check" : "write";
if (mode === "write") fs.mkdirSync(root, { recursive: true });
let mismatches = 0;
for (const [file, text] of expected) {
  const target = path.join(root, file);
  if (mode === "write") {
    fs.writeFileSync(target, text, "utf8");
    continue;
  }
  if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== text) {
    mismatches += 1;
    console.error(`STALE: ${path.relative(process.cwd(), target)}`);
  }
}
if (mode === "write") {
  console.log(`SEVEN-SEG-FIXTURES: wrote ${expected.size} files to ${path.relative(process.cwd(), root)}`);
} else if (mismatches > 0) {
  process.exitCode = 1;
} else {
  console.log(`SEVEN-SEG-FIXTURES: ${expected.size}/${expected.size} current`);
}
