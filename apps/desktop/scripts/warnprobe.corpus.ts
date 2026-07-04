import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { describe, it } from "vitest";
import { importAsc, makeSubcircuitResolver, decodeSchematicText } from "../src/io/ascImport";

const HOME = homedir();
const files = ["1563","Fc","ISO16750-2_example","ISO7637-2_example","PLL","PLL2"];
describe("warnprobe", () => {
  it("dumps warnings", () => {
    for (const f of files) {
      const path = join(HOME,"Documents","LTspice","examples","Educational",`${f}.asc`);
      if (!existsSync(path)) { console.log(f, "MISSING"); continue; }
      const parentDir = join(path,"..");
      const resolver = makeSubcircuitResolver((t:string)=>{
        const read=(n:string)=>{const p=join(parentDir,n);return existsSync(p)?decodeSchematicText(readFileSync(p)):undefined;};
        const asy=read(`${t}.asy`), asc=read(`${t}.asc`);
        return (!asy&&!asc)?null:{asy,asc};
      });
      const r = importAsc(decodeSchematicText(readFileSync(path)),{resolveSubcircuit:resolver});
      console.log(`\n=== ${f} (${r.warnings.length} warns) ===`);
      for (const w of r.warnings) console.log("  -", w);
    }
  });
});
