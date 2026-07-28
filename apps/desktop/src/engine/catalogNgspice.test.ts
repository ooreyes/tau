import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CATALOG } from "../schematic/catalog";
import { getComponentPins } from "../schematic/pins";
import type { SchematicComponent } from "../schematic/types";
import type { NetLabel } from "../schematic/types";
import { buildSpiceDeck } from "./spiceNetlist";
import { serializeSchematicFile } from "../project/types";
import { importAsc } from "../io/ascImport";
import { isLossyCarrierWarning } from "../io/ascExport";

const haveNgspice = spawnSync("ngspice", ["--version"], { encoding: "utf8" }).error === undefined;

describe.skipIf(!haveNgspice)("Library catalog - real ngspice smoke", () => {
  it("accepts and runs the default model for every Library component", () => {
    const failures: string[] = [];
    const dir = mkdtempSync(join(tmpdir(), "tau-catalog-ngspice-"));
    try {
      for (const [catalogIndex, entry] of CATALOG.entries()) {
        const dut: SchematicComponent = {
          id: `dut-${entry.kind}`,
          kind: entry.kind,
          x: 0,
          y: 0,
          rotation: 0,
          value: entry.defaultValue,
          label: entry.kind === "ground" ? "" : `${entry.prefix}${catalogIndex + 1}`,
        };
        const components: SchematicComponent[] = [
          dut,
          { id: "bias", kind: "vsource", x: 1024, y: 32, rotation: 0, value: "1", label: "VBIAS" },
          { id: "bias-load", kind: "resistor", x: 1056, y: 0, rotation: 0, value: "1k", label: "RBIAS" },
          { id: "bias-ground-a", kind: "ground", x: 1024, y: 64, rotation: 0, value: "", label: "" },
          { id: "bias-ground-b", kind: "ground", x: 1088, y: 0, rotation: 0, value: "", label: "" },
        ];
        const netLabels: NetLabel[] = [];
        // Give every terminal a DC path to ground without shorting sources or
        // control pairs. Exact endpoint co-location is the editor's normal
        // connectivity rule, so this also exercises each kind's pin geometry.
        for (const [pinIndex, pin] of getComponentPins(dut).entries()) {
          components.push({
            id: `bleed-${pinIndex}`,
            kind: "resistor",
            x: 544,
            y: pinIndex * 128,
            rotation: 0,
            value: "1G",
            label: `RB${pinIndex + 1}`,
          });
          components.push({
            id: `ground-${pinIndex}`,
            kind: "ground",
            x: 576,
            y: pinIndex * 128,
            rotation: 0,
            value: "",
            label: "",
          });
          const net = `dut_${pinIndex}`;
          netLabels.push(
            { id: `dut-label-${pinIndex}`, x: pin.x, y: pin.y, text: net },
            { id: `bleed-label-${pinIndex}`, x: 512, y: pinIndex * 128, text: net },
          );
        }

        try {
          const saved = serializeSchematicFile(`/catalog/${entry.kind}.asc`, {
            components,
            wires: [],
            probes: [],
            netLabels,
            directives: [],
          });
          // A lossy-carrier notice is informational: the part still reopens in
          // Tau as itself. Only a genuine save problem should fail this smoke.
          const blocking = saved.warnings.filter((w) => !isLossyCarrierWarning(w));
          if (blocking.length > 0) throw new Error(blocking.join(" "));
          const reopened = importAsc(saved.contents);
          const deck = buildSpiceDeck({
            components: reopened.components,
            wires: reopened.wires,
            netLabels: reopened.netLabels,
          }, { kind: "op" });
          const file = join(dir, `${entry.kind}.cir`);
          writeFileSync(file, deck.netlist);
          const run = spawnSync("ngspice", ["-b", file], { encoding: "utf8", timeout: 15_000 });
          if (run.status !== 0) {
            const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`.trim();
            failures.push(`${entry.kind}: ${output.slice(-500)}`);
          }
        } catch (error) {
          failures.push(`${entry.kind}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(failures).toEqual([]);
  }, 120_000);
});
