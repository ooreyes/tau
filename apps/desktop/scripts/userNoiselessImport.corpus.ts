/**
 * User vendor `.subckt` import proof, part two: the LTspice `noiseless` device
 * flag (LTspice parity). Analog Devices' macromodels tag every internal passive
 * `noiseless` to suppress its thermal-noise contribution. ngspice has no such
 * keyword, and on an R/C/L INSTANCE line it reads the trailing word as an
 * unknown model/parameter and FATALLY aborts the whole deck ("unknown parameter
 * (noiseless)" -> "incomplete or empty netlist"): the imported op-amp does
 * nothing at all. `parseUserModelLibraries`/`normalizeSubcktInterior`
 * (userModelLibrary.ts) strips the flag so the part simulates.
 *
 * The model is ADA4351 from LTspice's own library (Analog Devices macromodel),
 * read from disk and passed verbatim, never copied into this repo (third-party
 * asset). ADA4351 is a case where `noiseless` is the *only* construct ngspice
 * rejects - no `uplim`/`dnlim` soft-limit functions, no XSPICE code-model
 * devices - so stripping it is exactly what turns an empty netlist into a full
 * operating point. The subckt is instantiated with its declared ports (one
 * driven, the rest referenced to ground through a large resistor) and solved
 * with `.op`; a control build from the RAW vendor text confirms the same deck
 * aborts on the flag.
 *
 * Runs under vitest.corpus.config.ts (scripts/acceptance-corpus.sh), NOT the
 * default suite: it needs a real ngspice and the installed vendor file, and is
 * skipped cleanly when either is absent.
 */
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { parseUserModelLibraries, resolveUserSubckt } from "../src/engine/userModelLibrary";

const LIB_PATH = join(
  homedir(),
  "Library", "Application Support", "LTspice", "lib", "sub", "ADA4351.lib",
);
const SUBCKT = "ADA4351";
const haveNgspice = spawnSync("ngspice", ["--version"], { encoding: "utf8" }).error === undefined;

/** Slice the verbatim `.subckt NAME … .ends` span out of a vendor file, so the
 * raw control deck differs from the translated one by nothing but the flag. */
function rawSubcktBlock(text: string, name: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => new RegExp(`^\\.subckt\\s+${name}\\b`, "i").test(l.trim()));
  if (start < 0) throw new Error(`no .subckt ${name} in vendor file`);
  let depth = 0;
  for (let i = start; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (/^\.subckt\b/i.test(t)) depth += 1;
    else if (/^\.ends\b/i.test(t)) {
      depth -= 1;
      if (depth === 0) return lines.slice(start, i + 1).join("\n");
    }
  }
  throw new Error(`unterminated .subckt ${name}`);
}

/** Wrap a subckt block into a runnable `.op` deck: instantiate it with as many
 * external nodes as it declares ports, drive the first, and tie the rest to
 * ground through 1k so the macromodel has a defined bias without shorting its
 * internal references. */
function opDeck(subcktBlock: string): string {
  const header = subcktBlock.split("\n").find((l) => /^\.subckt\b/i.test(l.trim()))!;
  const ports = header.trim().split(/\s+/).slice(2).length;
  const nodes = Array.from({ length: ports }, (_, i) => `n${i + 1}`);
  return [
    `* ${SUBCKT} vendor import proof`,
    "V1 n1 0 2.5",
    ...nodes.slice(1).map((n, i) => `Rg${i + 2} ${n} 0 1k`),
    `X1 ${nodes.join(" ")} ${SUBCKT}`,
    subcktBlock,
    ".op",
    ".end",
    "",
  ].join("\n");
}

function runNgspice(netlist: string): { status: number; output: string } {
  const dir = mkdtempSync(join(tmpdir(), "tau-noiseless-"));
  try {
    const cir = join(dir, "deck.cir");
    writeFileSync(cir, netlist);
    const run = spawnSync("ngspice", ["-b", cir], { encoding: "utf8", timeout: 4 * 60_000 });
    return { status: run.status ?? -1, output: `${run.stdout ?? ""}\n${run.stderr ?? ""}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!existsSync(LIB_PATH) || !haveNgspice)("user vendor .subckt import (noiseless flag)", () => {
  it("strips LTspice's noiseless flag so a real ADI macromodel solves instead of aborting", () => {
    const libText = readFileSync(LIB_PATH, "latin1");

    // The vendor file really carries the flag on its instance lines...
    const rawBlock = rawSubcktBlock(libText, SUBCKT);
    expect(rawBlock).toMatch(/\bnoiseless\b/i);

    // ...and Tau's translation removes every one while preserving the vendor's
    // real content (node names, model refs, values) byte-for-byte otherwise.
    const fixedBlock = resolveUserSubckt(parseUserModelLibraries([libText]), SUBCKT);
    expect(fixedBlock, "ADA4351 should resolve from the attached library").not.toBeNull();
    expect(fixedBlock!).not.toMatch(/\bnoiseless\b/i);
    expect(fixedBlock!).toContain("RinDiff INNx INPx RQT 3.75E12");

    // Control: the RAW vendor text aborts. ngspice reads `noiseless` on a
    // resistor line as an unknown parameter and empties the netlist.
    const raw = runNgspice(opDeck(rawBlock));
    const rawLower = raw.output.toLowerCase();
    expect(rawLower).toContain("unknown parameter (noiseless)");
    expect(rawLower).toContain("incomplete or empty netlist");

    // Translated: the same deck now solves. No noiseless error, a clean exit,
    // and a real operating point (the expanded subckt's internal nodes appear
    // in the .op node table).
    const fixed = runNgspice(opDeck(fixedBlock!));
    expect(fixed.status, fixed.output.slice(-2000)).toBe(0);
    const fixedLower = fixed.output.toLowerCase();
    // No trace of the flag's failure modes (the raw control hit both above).
    expect(fixedLower).not.toContain("unknown parameter (noiseless)");
    expect(fixedLower).not.toContain("can't find model 'noiseless'");
    expect(fixedLower).not.toContain("incomplete or empty netlist");
    expect(fixedLower).not.toContain("simulation(s) aborted");
    expect(fixed.output).toMatch(/\bx1\.\S+\s+[-+]?[\d.]/i);
  });
});
