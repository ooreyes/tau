/**
 * Debug helper (not part of any suite's default glob unless named *.corpus.ts):
 * dumps the built .op deck for the corpus files named in DUMP_FILES so failing
 * ngspice runs can be inspected line-by-line. Usage:
 *   DUMP_FILES="LoopGain2 P2" pnpm -C apps/desktop exec vitest run \
 *     --config vitest.corpus.config.ts scripts/dumpDeck.corpus.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { describe, it } from "vitest";
import { importAsc, makeSubcircuitResolver, decodeSchematicText } from "../src/io/ascImport";
import { buildParamScope } from "../src/simulation/paramScope";
import { buildSpiceDeck } from "../src/engine/spiceNetlist";

const names = (process.env.DUMP_FILES ?? "").split(/\s+/).filter(Boolean);
const dir = process.env.DUMP_ROOT ?? join(homedir(), "Documents", "LTspice", "examples", "Educational");

function siblingResolver(parentDir: string) {
  return makeSubcircuitResolver((symbolType) => {
    const read = (name: string): string | undefined => {
      const path = join(parentDir, name);
      if (!existsSync(path)) return undefined;
      return decodeSchematicText(readFileSync(path));
    };
    const asy = read(`${symbolType}.asy`);
    const asc = read(`${symbolType}.asc`);
    if (!asy && !asc) return null;
    return { asy, asc };
  });
}

describe.skipIf(names.length === 0)("deck dump", () => {
  for (const name of names) {
    it(`dumps ${name}`, () => {
      const path = join(dir, `${name}.asc`);
      const text = decodeSchematicText(readFileSync(path));
      const imported = importAsc(text, { resolveSubcircuit: siblingResolver(dir) });
      const params = buildParamScope(imported.directives);
      const analysis = process.env.DUMP_ANALYSIS === "tran"
        ? { kind: "tran" as const, stopTime: Number(process.env.DUMP_STOP ?? "0.003"), steps: Number(process.env.DUMP_STEPS ?? "3000") }
        : { kind: "op" as const };
      const deck = buildSpiceDeck(
        {
          components: imported.components,
          wires: imported.wires,
          netLabels: imported.netLabels,
          params,
          directives: imported.directives,
        },
        analysis,
      );
      console.log(`\n===== ${name} =====\n${deck.netlist}\n===== end ${name} =====\n`);
    });
  }
});
