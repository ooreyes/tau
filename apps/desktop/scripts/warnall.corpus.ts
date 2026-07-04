import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { describe, it } from "vitest";
import { importAsc, makeSubcircuitResolver, decodeSchematicText } from "../src/io/ascImport";

const HOME = homedir();
const CORPUS_DIRS = [
  { dir: join(HOME, "Downloads", "LTspice_export"), label: "LTspice_export" },
  { dir: join(HOME, "Documents", "LTspice"), label: "LTspice" },
  { dir: join(HOME, "Documents", "LTspice", "examples", "Educational"), label: "Educational" },
];

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

describe("warnall", () => {
  it("dumps all corpus warnings", () => {
    for (const { dir, label } of CORPUS_DIRS) {
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir).sort()) {
        if (!/\.asc$/i.test(name)) continue;
        const path = join(dir, name);
        try {
          const r = importAsc(decodeSchematicText(readFileSync(path)), {
            resolveSubcircuit: siblingResolver(dir),
          });
          if (r.warnings.length > 0) {
            console.log(`\n=== ${label}/${name} (${r.warnings.length}) ===`);
            for (const w of r.warnings) console.log("  -", w);
          }
        } catch (e) {
          console.log(`\n!!! ${label}/${name} THREW: ${(e as Error).message}`);
        }
      }
    }
  });
});
