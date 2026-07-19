import { describe, expect, it } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileAssistantCircuitPlan, GOLDEN_CLASS_D_ASSISTANT_PLAN } from "./assistantCircuitPlan";
import { buildSpiceDeck } from "../engine/spiceNetlist";
import { buildParamScope } from "../simulation/paramScope";

const haveNgspice = spawnSync("ngspice", ["--version"], { encoding: "utf8" }).error === undefined;

describe.skipIf(!haveNgspice)("golden Class-D ngspice smoke", () => {
  it("PWM switches rail-to-rail and the half-bridge averages mid-supply at Vin≈0", () => {
    const action = compileAssistantCircuitPlan("golden-sim", GOLDEN_CLASS_D_ASSISTANT_PLAN);
    expect(action.type).toBe("create_asc");
    if (action.type !== "create_asc") throw new Error("expected create");
    // 2 ms ≈ 200 carrier cycles; Vin still near 0 so duty ≈ 50%.
    const stopTime = 0.002;
    const steps = 20_000;
    const deck = buildSpiceDeck(
      {
        components: action.document.components,
        wires: action.document.wires,
        netLabels: action.document.netLabels,
        params: buildParamScope(action.document.directives ?? []),
        directives: action.document.directives ?? [],
      },
      { kind: "tran", stopTime, steps },
    );
    expect(deck.netlist).toMatch(/B_U1\s+\w+\s+0\s+V=/i);
    expect(deck.netlist).toMatch(/V\(IN\)/i);
    expect(deck.netlist).toMatch(/V\(TRI\)/i);
    expect(deck.netlist).toMatch(/\bM1\b/i);
    expect(deck.netlist).toMatch(/\bM2\b/i);
    expect(deck.netlist).toMatch(/TAU_PMOS/i);

    const netlist = deck.netlist.replace(
      /\n\.end$/,
      [
        "",
        ".meas tran vpwmmax MAX V(PWM)",
        ".meas tran vpwmmin MIN V(PWM)",
        ".meas tran vpwmavg AVG V(PWM)",
        ".meas tran vswpp PP V(SW)",
        ".meas tran voutavg AVG V(OUT) FROM=0.5m TO=2m",
        ".end",
      ].join("\n"),
    );
    const dir = mkdtempSync(join(tmpdir(), "tau-classd-golden-"));
    try {
      const cir = join(dir, "classd.cir");
      writeFileSync(cir, netlist);
      const run = spawnSync("ngspice", ["-b", cir], { encoding: "utf8", timeout: 120_000 });
      const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
      expect(run.status, output.slice(-2500)).toBe(0);
      const meas = (name: string) => {
        const m = new RegExp(`^${name}\\s*=\\s*(\\S+)`, "im").exec(output);
        expect(m, `.meas ${name} missing:\n${output.slice(-1500)}`).not.toBeNull();
        return Number(m![1]);
      };
      const vpwmMax = meas("vpwmmax");
      const vpwmMin = meas("vpwmmin");
      const vpwmAvg = meas("vpwmavg");
      const vswPp = meas("vswpp");
      const voutAvg = meas("voutavg");
      // Comparator rails 0/10 - must actually switch both ways.
      expect(vpwmMax).toBeGreaterThan(9);
      expect(vpwmMin).toBeLessThan(1);
      expect(vpwmAvg).toBeGreaterThan(2);
      expect(vpwmAvg).toBeLessThan(8);
      // Complementary half-bridge must bang SW between the rails (dense PWM).
      expect(vswPp).toBeGreaterThan(8);
      // Near-zero audio → ~50% duty → filtered OUT near mid-supply, not a rail.
      expect(voutAvg).toBeGreaterThan(3);
      expect(voutAvg).toBeLessThan(7);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
