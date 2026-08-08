import { describe, it } from "vitest";
import { compileAssistantCircuitPlan } from "./lib/assistantCircuitPlan";

describe("scratch", () => {
  it("dumps", () => {
    const flipFlops = Array.from({ length: 4 }, (_, index) => ({
      ref: `A${index + 1}`,
      kind: "dflop",
      value: "Vhigh=5 Vlow=0",
    }));
    const loads = Array.from({ length: 4 }, (_, index) => [
      { ref: `R${index + 1}`, kind: "resistor", value: `${index + 1}k` },
      { ref: `C${index + 1}`, kind: "capacitor", value: `${index + 1}n` },
    ]).flat();
    const groundPins = ["VD.n", "VCLK.n"];
    for (const flipFlop of flipFlops) {
      groundPins.push(`${flipFlop.ref}.pre`, `${flipFlop.ref}.clr`, `${flipFlop.ref}.com`);
    }
    for (let index = 1; index <= 4; index += 1) {
      groundPins.push(`R${index}.b`, `C${index}.b`);
    }
    const plan = {
      mode: "create",
      filename: "mixed-shift-register.asc",
      components: [
        { ref: "VD", kind: "vsource", value: "PWL(0 0 1m 0 1.001m 5 3m 5 3.001m 0 5m 0 5.001m 5 7m 5 7.001m 0 9m 0)" },
        { ref: "VCLK", kind: "vsource", value: "PULSE(0 5 0.5m 1n 1n 0.25m 1m)" },
        ...flipFlops,
        ...loads,
      ],
      nets: [
        { name: "DATA", pins: ["VD.p", "A1.d"] },
        { name: "CLK", pins: ["VCLK.p", ...flipFlops.map(({ ref }) => `${ref}.clk`)] },
        ...flipFlops.map(({ ref }, index) => ({
          name: `Q${index + 1}`,
          pins: [
            `${ref}.q`,
            ...(index < flipFlops.length - 1 ? [`A${index + 2}.d`] : []),
            `R${index + 1}.a`,
            `C${index + 1}.a`,
          ],
        })),
        ...flipFlops.map(({ ref }, index) => ({ name: `Q${index + 1}BAR`, pins: [`${ref}.qbar`] })),
        { name: "0", pins: groundPins },
      ],
      directives: [".tran 2u 10m"],
    };
    try {
      compileAssistantCircuitPlan("stress-mixed-signal", plan);
      console.log("OK");
    } catch (e) {
      console.log("ERR", (e as Error).message);
    }
  });
});
