import { describe, expect, it } from "vitest";

import { isInteractiveSchematic, liveControlHint, liveControls } from "./liveControls";
import type { ComponentKind, SchematicComponent } from "./types";

let seq = 0;
const part = (
  kind: ComponentKind,
  value: string,
  label = `X${++seq}`,
): SchematicComponent => ({
  id: `${kind}-${seq}`,
  kind,
  x: 0,
  y: 0,
  rotation: 0,
  value,
  label,
});

describe("isInteractiveSchematic", () => {
  it("detects a schematic the reader can operate from its parts alone", () => {
    expect(isInteractiveSchematic([
      part("vsource", "5"),
      part("switch", "open", "S1"),
      part("resistor", "1k", "R1"),
      part("ground", "", "GND"),
    ])).toBe(true);
  });

  it("leaves a plain R/C/L and source circuit alone", () => {
    expect(isInteractiveSchematic([
      part("vsource", "SINE(0 1 1k)", "V1"),
      part("resistor", "1k", "R1"),
      part("capacitor", "100n", "C1"),
      part("inductor", "10m", "L1"),
      part("ground", "", "GND"),
    ])).toBe(false);
    expect(isInteractiveSchematic([])).toBe(false);
  });

  it("counts every hand-operable kind, and only those", () => {
    for (const kind of ["switch", "pushButton", "spdt", "potentiometer"] as const) {
      expect(isInteractiveSchematic([part(kind, "")])).toBe(true);
    }
  });

  /**
   * The case that decides whether this predicate is "has a moving part" or
   * "has something a hand can work". A relay's contact is thrown by its coil
   * (`NON_ACTUABLE`), so announcing it as a control would advertise a click
   * the simulator then refuses.
   */
  it("does not call a relay or a motor a control, because neither is hand-operable", () => {
    expect(isInteractiveSchematic([
      part("vsource", "5", "V1"),
      part("relay", "", "K1"),
      part("motor", "", "M1"),
      part("ground", "", "GND"),
    ])).toBe(false);
  });
});

describe("liveControls", () => {
  it("reads a switch's live position off its value, in the solver's own spelling", () => {
    expect(liveControls([part("switch", "open", "S1")])[0]).toMatchObject({
      name: "S1",
      form: "contact",
      gesture: "toggle",
      position: "OPEN",
    });
    expect(liveControls([part("switch", "closed", "S1")])[0].position).toBe("CLOSED");
    // Hand-typed spellings the solver already accepts must not read as OPEN.
    expect(liveControls([part("switch", "on", "S1")])[0].position).toBe("CLOSED");
    expect(liveControls([part("switch", "1", "S1")])[0].position).toBe("CLOSED");
  });

  it("names the gesture each control actually takes", () => {
    expect(liveControls([part("pushButton", "open", "PB1")])[0]).toMatchObject({
      gesture: "press",
      position: "OPEN",
    });
    expect(liveControls([part("spdt", "nc", "SW2")])[0]).toMatchObject({
      gesture: "throw",
      position: "NC",
    });
    expect(liveControls([part("spdt", "no", "SW2")])[0].position).toBe("NO");
    expect(liveControls([part("potentiometer", "10k Wiper=0.62", "RV1")])[0]).toMatchObject({
      form: "wiper",
      gesture: "drag",
      position: "62%",
    });
  });

  it("reports a centred wiper as 50% and its end stops as 0% and 100%", () => {
    expect(liveControls([part("potentiometer", "10k", "RV1")])[0].position).toBe("50%");
    expect(liveControls([part("potentiometer", "10k Wiper=0", "RV1")])[0].position).toBe("0%");
    expect(liveControls([part("potentiometer", "10k Wiper=1", "RV1")])[0].position).toBe("100%");
  });

  it("keeps document order and drops everything that is not a control", () => {
    const controls = liveControls([
      part("resistor", "1k", "R1"),
      part("switch", "closed", "S1"),
      part("relay", "", "K1"),
      part("potentiometer", "10k", "RV1"),
      part("pushButton", "open", "PB1"),
    ]);
    expect(controls.map((c) => c.name)).toEqual(["S1", "RV1", "PB1"]);
  });

  it("still has something to call an unnamed control", () => {
    expect(liveControls([part("switch", "open", "   ")])[0].name).toBe("This control");
  });
});

describe("liveControlHint", () => {
  it("names the one control, its gesture, and what re-runs", () => {
    const one = liveControls([part("switch", "open", "S1")]);
    expect(liveControlHint(one, "op")).toBe(
      "Toggle S1 on the circuit and the operating point re-solves.",
    );
    expect(liveControlHint(one, "tran")).toBe(
      "Toggle S1 on the circuit and the transient re-runs.",
    );
  });

  it("uses the drag verb for a lone potentiometer", () => {
    expect(liveControlHint(liveControls([part("potentiometer", "10k", "RV1")]), "ac")).toBe(
      "Drag RV1 on the circuit and the AC sweep re-runs.",
    );
  });

  it("stops naming controls once the readouts already list them", () => {
    const many = liveControls([part("switch", "open", "S1"), part("pushButton", "open", "PB1")]);
    expect(liveControlHint(many, "dc")).toBe(
      "Operate a control on the circuit and the DC sweep re-runs.",
    );
  });

  it("names every analysis an actuation can re-run", () => {
    const one = liveControls([part("switch", "open", "S1")]);
    for (const analysis of ["tran", "op", "ac", "dc", "tf", "noise"] as const) {
      const hint = liveControlHint(one, analysis);
      expect(hint).toMatch(/^Toggle S1 on the circuit and the .+\.$/);
      // Voice: no exclamation, no em-dash, no apology (DESIGN_SYSTEM section 6).
      expect(hint).not.toMatch(/[!—]/);
    }
  });

  it("says nothing at all about a circuit with no controls", () => {
    expect(liveControlHint(liveControls([part("resistor", "1k", "R1")]), "tran")).toBeNull();
  });

  /**
   * The re-run sentences above are all false while a solve is in flight. A live
   * run does not restart anything: `simulation/liveActuation.ts` halts the
   * solver, alters the one device the emitter wrote for the part, and resumes
   * the SAME transient, so the trace keeps its history and acquires a corner.
   * Promising a re-run there tells the reader to expect the plot to blank, and
   * that expectation is what makes a working feature look broken.
   */
  it("promises a bend, not a re-run, while the circuit is energised", () => {
    const one = liveControls([part("switch", "open", "S1")]);
    expect(liveControlHint(one, "tran", true)).toBe(
      "Toggle S1 on the circuit and the running trace bends.",
    );
    // The authored analysis stops mattering once a run is live: there is one
    // solve in flight and it is the thing that responds, whatever the document
    // happens to declare.
    for (const analysis of ["tran", "op", "ac", "dc", "tf", "noise"] as const) {
      expect(liveControlHint(one, analysis, true)).toBe(
        "Toggle S1 on the circuit and the running trace bends.",
      );
    }
  });

  it("keeps the plural form when several controls are energised", () => {
    const many = liveControls([part("switch", "open", "S1"), part("pushButton", "open", "PB1")]);
    expect(liveControlHint(many, "dc", true)).toBe(
      "Operate a control on the circuit and the running trace bends.",
    );
  });
});
