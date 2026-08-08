import { describe, expect, it } from "vitest";
import { decodeParams, encodeParams, paramFields, paramSummary } from "./params";
import { CATALOG } from "./catalog";
import { parseModulator } from "../engine/modulatorSpec";

describe("MOSFET param encode/decode", () => {
  it("round-trips model + W/L/KP/VTO", () => {
    const encoded = encodeParams("nmos", {
      model: "NMOS",
      w: "20u",
      l: "2u",
      kp: "50u",
      vto: "0.7",
    });
    expect(encoded).toBe("NMOS W=20u L=2u KP=50u VTO=0.7");
    expect(decodeParams("nmos", encoded)).toEqual({
      model: "NMOS",
      w: "20u",
      l: "2u",
      kp: "50u",
      vto: "0.7",
    });
  });

  it("keeps a bare model name without inventing W/L", () => {
    expect(decodeParams("pmos", "PMOS")).toEqual({
      model: "PMOS",
      w: "",
      l: "",
      kp: "",
      vto: "",
    });
  });

  it("falls back to the generic model name when the value is bare geometry", () => {
    expect(decodeParams("nmos", "W=2u L=1u")).toEqual({
      model: "NMOS",
      w: "2u",
      l: "1u",
      kp: "",
      vto: "",
    });
    expect(decodeParams("pmos", "")).toEqual({ model: "PMOS", w: "", l: "", kp: "", vto: "" });
  });

  it("omits empty geometry keys instead of emitting W= with no number", () => {
    expect(encodeParams("nmos", { model: "IRF540", w: "", l: "", kp: "", vto: "3.5" }))
      .toBe("IRF540 VTO=3.5");
  });

  it("encodes inductor inductance as a single-field value", () => {
    expect(encodeParams("inductor", { l: "10u" })).toBe("10u");
    expect(decodeParams("inductor", "10u")).toEqual({ l: "10u" });
  });
});

describe("charge-defined capacitor controls", () => {
  it("decodes the LTspice Q expression and initial voltage into named fields", () => {
    expect(decodeParams("capacitor", "Q=100p*x*sin(2*pi*2K*time) IC=0.25")).toEqual({
      charge: "100p*x*sin(2*pi*2K*time)",
      ic: "0.25",
    });
  });

  it("re-encodes edits without requiring the user to type Q= or IC= syntax", () => {
    expect(encodeParams("capacitor", { charge: "200p*x", ic: "1" })).toBe("Q=200p*x IC=1");
    expect(encodeParams("capacitor", { charge: "200p*x", ic: "" })).toBe("Q=200p*x");
  });

  it("selects the charge fields only for a Q= value, on both capacitor kinds", () => {
    expect(paramFields("capacitor", "Q=1p*x").map((f) => f.key)).toEqual(["charge", "ic"]);
    expect(paramFields("polarizedCapacitor", "Q=1p*x").map((f) => f.key)).toEqual(["charge", "ic"]);
    expect(paramFields("capacitor", "1µ").map((f) => f.key)).toEqual(["c"]);
    expect(decodeParams("polarizedCapacitor", "Q=1p*x")).toEqual({ charge: "1p*x", ic: "" });
    expect(decodeParams("capacitor", "1µ")).toEqual({ c: "1µ" });
  });
});

describe("AC source fields", () => {
  it("reads the two-token catalog default as an implicit zero offset", () => {
    expect(decodeParams("vac", "1 1k")).toEqual({ offset: "0", amplitude: "1", frequency: "1k" });
    expect(decodeParams("iac", "1m 1k")).toEqual({ offset: "0", amplitude: "1m", frequency: "1k" });
  });

  it("reads a three-token value as offset/amplitude/frequency", () => {
    expect(decodeParams("vac", "2 1 1k")).toEqual({ offset: "2", amplitude: "1", frequency: "1k" });
  });

  it("accepts comma and @ separators", () => {
    expect(decodeParams("vac", "1,1k")).toEqual({ offset: "0", amplitude: "1", frequency: "1k" });
    expect(decodeParams("vac", "1@1k")).toEqual({ offset: "0", amplitude: "1", frequency: "1k" });
  });

  it("fills a single token as the amplitude and an empty value as the full default", () => {
    expect(decodeParams("vac", "3")).toEqual({ offset: "0", amplitude: "3", frequency: "1k" });
    expect(decodeParams("vac", "")).toEqual({ offset: "0", amplitude: "1", frequency: "1k" });
  });

  it("drops a zero offset when encoding, keeps a real one", () => {
    expect(encodeParams("vac", { offset: "0", amplitude: "1", frequency: "1k" })).toBe("1 1k");
    expect(encodeParams("vac", { offset: "2", amplitude: "1", frequency: "1k" })).toBe("2 1 1k");
  });

  it("treats a cleared amplitude as zero rather than re-inventing the default", () => {
    expect(encodeParams("vac", { offset: "0", amplitude: "", frequency: "1k" })).toBe("0 1k");
    expect(encodeParams("iac", {})).toBe("0 1k");
  });
});

describe("pulse source fields", () => {
  it("round-trips the catalog default", () => {
    expect(decodeParams("vpulse", "0 5 100k 0.5")).toEqual({
      low: "0",
      high: "5",
      frequency: "100k",
      duty: "0.5",
    });
    expect(encodeParams("vpulse", { low: "0", high: "5", frequency: "100k", duty: "0.5" }))
      .toBe("0 5 100k 0.5");
  });

  it("fills missing trailing tokens with the pulse defaults", () => {
    expect(decodeParams("vpulse", "1 4")).toEqual({
      low: "1",
      high: "4",
      frequency: "100k",
      duty: "0.5",
    });
    expect(decodeParams("vpulse", "")).toEqual({
      low: "0",
      high: "5",
      frequency: "100k",
      duty: "0.5",
    });
    expect(encodeParams("vpulse", { high: "3.3" })).toBe("0 3.3 100k 0.5");
  });
});

describe("comparator fields", () => {
  it("decodes positional and keyed forms through the solver's own parser", () => {
    expect(decodeParams("comparator", "1 0")).toEqual({ vhigh: "1", vlow: "0", vhyst: "0" });
    expect(decodeParams("comparator", "5 0 0.1")).toEqual({ vhigh: "5", vlow: "0", vhyst: "0.1" });
    expect(decodeParams("comparator", "Vhigh=3.3 Vlow=0")).toEqual({
      vhigh: "3.3",
      vlow: "0",
      vhyst: "0",
    });
    expect(decodeParams("comparator", "5 0 1m").vhyst).toBe("0.001");
  });

  it("drops a zero hysteresis so the ideal comparator stays two tokens", () => {
    expect(encodeParams("comparator", { vhigh: "5", vlow: "0", vhyst: "0" })).toBe("5 0");
    expect(encodeParams("comparator", { vhigh: "5", vlow: "0", vhyst: "0.1" })).toBe("5 0 0.1");
    expect(encodeParams("comparator", {})).toBe("1 0");
  });
});

describe("motor fields", () => {
  it("accepts both the positional and the keyed armature forms", () => {
    expect(decodeParams("motor", "10 1m")).toEqual({ r: "10", l: "1m" });
    expect(decodeParams("motor", "R=5 L=2m")).toEqual({ r: "5", l: "2m" });
    expect(decodeParams("motor", "R=5")).toEqual({ r: "5", l: "1m" });
    expect(decodeParams("motor", "")).toEqual({ r: "10", l: "1m" });
  });

  it("normalizes a typed micro sign to the ASCII suffix the engine reads", () => {
    expect(decodeParams("motor", "10 1µ")).toEqual({ r: "10", l: "1u" });
  });

  it("always re-encodes positionally, filling cleared fields with the defaults", () => {
    expect(encodeParams("motor", { r: "5", l: "2m" })).toBe("5 2m");
    expect(encodeParams("motor", { r: "", l: "" })).toBe("10 1m");
  });
});

describe("single-field kinds", () => {
  it("stores the whole trimmed value under the one field key", () => {
    expect(decodeParams("resistor", "  1k  ")).toEqual({ r: "1k" });
    expect(decodeParams("switch", "closed")).toEqual({ state: "closed" });
    expect(decodeParams("transformer", "1:1")).toEqual({ ratio: "1:1" });
    expect(encodeParams("resistor", { r: " 4k7 " })).toBe("4k7");
    expect(encodeParams("spdt", { throw: "nc" })).toBe("nc");
  });
});

/**
 * The transmission line is the proof that a multi-field kind is now a data
 * edit: its `Td=… Z0=…` grammar is the default one, so it reached the panel
 * without a line of encode/decode dispatch.
 */
describe("keyed fields added as data only", () => {
  it("gives the transmission line named delay and impedance controls", () => {
    expect(paramFields("tline", "Td=50n Z0=50").map((f) => f.key)).toEqual(["td", "z0"]);
    expect(decodeParams("tline", "Td=50n Z0=75")).toEqual({ td: "50n", z0: "75" });
    expect(encodeParams("tline", { td: "50n", z0: "75" })).toBe("Td=50n Z0=75");
  });

  it("reads the keys in either order and fills a missing one with the engine default", () => {
    expect(decodeParams("tline", "Z0=75 Td=10n")).toEqual({ td: "10n", z0: "75" });
    expect(decodeParams("tline", "Z0=75")).toEqual({ td: "1n", z0: "75" });
    expect(decodeParams("tline", "")).toEqual({ td: "1n", z0: "50" });
  });

  it("omits a cleared key instead of writing a bare equals sign", () => {
    expect(encodeParams("tline", { td: "", z0: "75" })).toBe("Z0=75");
  });
});

describe("keyed values the panel does not model", () => {
  it("carries unrecognized tokens through an edit instead of deleting them", () => {
    const decoded = decodeParams("nmos", "IRF540 W=10u AD=1p m=2");
    expect(decoded.model).toBe("IRF540");
    expect(decoded.w).toBe("10u");
    expect(encodeParams("nmos", { ...decoded, w: "20u" })).toBe("IRF540 W=20u AD=1p m=2");
  });

  it("adds no carrier key when every token was understood", () => {
    expect(Object.keys(decodeParams("tline", "Td=5n Z0=50")).sort()).toEqual(["td", "z0"]);
  });
});

describe("potentiometer wiper", () => {
  it("decodes a bare value to the resistance plus the default centred wiper", () => {
    expect(decodeParams("potentiometer", "10k")).toEqual({ r: "10k", wiper: "0.5" });
  });

  it("decodes a Wiper= token alongside the resistance", () => {
    expect(decodeParams("potentiometer", "10k Wiper=0.25")).toEqual({ r: "10k", wiper: "0.25" });
  });

  it("omits a centred wiper so an untouched default keeps the compact spelling", () => {
    expect(encodeParams("potentiometer", { r: "10k", wiper: "0.5" })).toBe("10k");
  });

  it("emits the Wiper= token for an off-centre value", () => {
    expect(encodeParams("potentiometer", { r: "4k7", wiper: "0.25" })).toBe("4k7 Wiper=0.25");
  });

  it("carries a token the panel does not model through an edit", () => {
    const decoded = decodeParams("potentiometer", "10k Taper=log");
    const edited = encodeParams("potentiometer", { ...decoded, wiper: "0.2" });
    expect(edited).toContain("Taper=log");
    expect(edited).toContain("Wiper=0.2");
  });

  // The netlist takes the resistance as the token that is not `Wiper=`, so the
  // panel has to agree however the two were typed - otherwise the box would
  // read 10k while the deck ran 4k7.
  it("reads the resistance even when the wiper token was typed first", () => {
    expect(decodeParams("potentiometer", "Wiper=0.8 4k7")).toEqual({ r: "4k7", wiper: "0.8" });
    expect(encodeParams("potentiometer", decodeParams("potentiometer", "Wiper=0.8 4k7")))
      .toBe("4k7 Wiper=0.8");
  });
});

/**
 * The four controlled sources share one number and four identical-looking
 * pins, so everything that distinguishes them lives in the field data: the
 * unit `spiceNetlist.ts` emits that number in, and what the control pair is.
 */
describe("controlled source gains", () => {
  it("names each gain with the unit its own netlist line uses", () => {
    expect(paramFields("vcvs", "10").map((f) => [f.label, f.unit])).toEqual([["Voltage gain", "V/V"]]);
    expect(paramFields("vccs", "1m").map((f) => [f.label, f.unit])).toEqual([["Transconductance", "A/V"]]);
    expect(paramFields("cccs", "10").map((f) => [f.label, f.unit])).toEqual([["Current gain", "A/A"]]);
    expect(paramFields("ccvs", "1k").map((f) => [f.label, f.unit])).toEqual([["Transresistance", "V/A"]]);
  });

  it("describes the control port of every one of them", () => {
    for (const kind of ["vcvs", "vccs", "cccs", "ccvs"] as const) {
      expect(paramFields(kind, "1")[0].description).toMatch(/control pins C\+ and C-/);
    }
  });

  // F and H synthesize their own `V_<base>_sense` between C+ and C-, so
  // wiring one across an existing V1 shorts it instead of measuring it.
  it("says on the current-controlled pair that the sense branch is Tau's own", () => {
    for (const kind of ["cccs", "ccvs"] as const) {
      expect(paramFields(kind, "1")[0].description).toMatch(/cannot watch an existing source such as V1/);
      expect(paramFields(kind, "1")[0].description).toMatch(/in series with the branch/);
    }
    for (const kind of ["vcvs", "vccs"] as const) {
      expect(paramFields(kind, "1")[0].description).not.toMatch(/in series/);
    }
  });

  it("stores the gain as the whole value, unchanged", () => {
    expect(decodeParams("ccvs", " 1k ")).toEqual({ gain: "1k" });
    expect(encodeParams("vccs", { gain: "2m" })).toBe("2m");
  });
});

/**
 * `Laplace=H(s)` is a transfer function, not a gain, and no E/G syntax carries
 * both, so it is a value variant rather than a second box. F and H take a
 * constant only and must keep their gain control whatever is typed.
 */
describe("Laplace transfer on the voltage-controlled sources", () => {
  it("swaps in a transfer-function field for a Laplace value", () => {
    expect(paramFields("vcvs", "Laplace=1/(1+s)").map((f) => f.key)).toEqual(["laplace"]);
    expect(paramFields("vccs", "Laplace=1/(1+s)").map((f) => f.key)).toEqual(["laplace"]);
    expect(paramFields("vcvs", "10").map((f) => f.key)).toEqual(["gain"]);
  });

  it("shows the expression without the user retyping the Laplace= prefix", () => {
    expect(decodeParams("vcvs", "Laplace=10/(1+0.001*s)")).toEqual({ laplace: "10/(1+0.001*s)" });
    expect(encodeParams("vcvs", { laplace: "10/(1+0.01*s)" })).toBe("Laplace=10/(1+0.01*s)");
    expect(decodeParams("vcvs", "laplace = 1/s")).toEqual({ laplace: "1/s" });
  });

  it("carries a token in front of the transfer through an edit instead of deleting it", () => {
    const decoded = decodeParams("vcvs", "10 Laplace=1/(1+s)");
    expect(decoded.laplace).toBe("1/(1+s)");
    expect(encodeParams("vcvs", { ...decoded, laplace: "2/(1+s)" })).toBe("10 Laplace=2/(1+s)");
  });

  it("leaves the current-controlled pair on its gain field", () => {
    expect(paramFields("cccs", "Laplace=1/(1+s)").map((f) => f.key)).toEqual(["gain"]);
    expect(paramFields("ccvs", "Laplace=1/(1+s)").map((f) => f.key)).toEqual(["gain"]);
  });

  /**
   * `s_xfer` is a voltage-in/voltage-out code model, so `laplaceSourceLines`
   * guards its exact branch with `if (!isCurrent)` and falls every G source back
   * to the DC gain H(0). One description shared by both kinds would promise a
   * VCCS user a frequency response the deck never runs, so the two must differ.
   */
  it("does not promise a VCCS the exact transfer function only a VCVS gets", () => {
    const hint = (kind: "vcvs" | "vccs") =>
      paramFields(kind, "Laplace=1/(1+s)")[0].description ?? "";
    expect(hint("vcvs")).toContain("runs exactly");
    expect(hint("vccs")).not.toContain("exactly");
    expect(hint("vccs")).toContain("DC gain");
  });
});

/**
 * The VCO. `mark=<f> space=<f>` was already the default keyed grammar, so the
 * fields are data; what has to hold is that the panel says the same thing about
 * a value as `engine/modulatorSpec.ts` does, including for a value that leaves
 * one of the two out.
 */
describe("modulator (VCO) frequencies", () => {
  it("names both tokens as frequencies in hertz", () => {
    expect(paramFields("modulator", "mark=1K space=1K").map((f) => [f.key, f.label, f.unit]))
      .toEqual([["mark", "Mark frequency", "Hz"], ["space", "Space frequency", "Hz"]]);
  });

  it("round-trips the catalog default and reads the keys in either order", () => {
    expect(decodeParams("modulator", "mark=1K space=1K")).toEqual({ mark: "1K", space: "1K" });
    expect(decodeParams("modulator", "space=200 mark=2K")).toEqual({ mark: "2K", space: "200" });
    expect(encodeParams("modulator", { mark: "2K", space: "200" })).toBe("mark=2K space=200");
  });

  // A panel that invented its own default would show a frequency the deck does
  // not run. Both fallbacks are `parseModulator`'s.
  it("fills a missing key with the frequency the deck would use", () => {
    expect(decodeParams("modulator", "mark=2K")).toEqual({ mark: "2K", space: "0" });
    expect(decodeParams("modulator", "")).toEqual({ mark: "1k", space: "0" });
    const deck = parseModulator("mark=2K");
    expect(deck.space).toBe(0);
    expect(deck.mark).toBe(2000);
  });

  // The FM pin selects between the two frequencies and the AM and COM pins have
  // no field at all, so the part is unreadable without a summary above them.
  it("says what the part outputs and what drives each pin", () => {
    const summary = paramSummary("modulator", "mark=1K space=1K");
    expect(summary).toMatch(/oscillator/i);
    expect(summary).toMatch(/FM/);
    expect(summary).toMatch(/AM/);
    expect(summary).toMatch(/COM/);
    expect(summary).toMatch(/Q/);
    expect(paramFields("modulator", "mark=1K")[0].description).toMatch(/1 V/);
    expect(paramFields("modulator", "mark=1K")[1].description).toMatch(/0 V/);
  });

  it("carries no summary for a kind whose fields speak for themselves", () => {
    expect(paramSummary("resistor", "1k")).toBe("");
    expect(paramSummary("diode", "1N4148")).toBe("");
  });
});

describe("kinds without a parameter schema", () => {
  it("decodes to nothing rather than inventing fields", () => {
    expect(paramFields("diode", "1N4148")).toEqual([]);
    expect(decodeParams("diode", "1N4148")).toEqual({});
    expect(decodeParams("ground", "")).toEqual({});
  });
});

/**
 * The destructive trap this codec exists to remove: a field set whose encoding
 * loses the other fields blanks the component on the first keystroke. Every
 * kind with a schema must survive an edit to each of its fields, so a kind
 * added later is covered by this test the day it gets a schema.
 */
describe("every catalogued field set survives an edit", () => {
  const SAMPLE = "2";

  for (const entry of CATALOG) {
    const fields = paramFields(entry.kind, entry.defaultValue);
    if (fields.length === 0) continue;

    it(`${entry.kind}: the catalog default re-encodes to itself`, () => {
      expect(encodeParams(entry.kind, decodeParams(entry.kind, entry.defaultValue)))
        .toBe(entry.defaultValue.trim());
    });

    for (const field of fields) {
      it(`${entry.kind}: editing ${field.key} keeps every other field`, () => {
        const base = decodeParams(entry.kind, entry.defaultValue);
        const edited = { ...base, [field.key]: SAMPLE };
        const roundTripped = decodeParams(entry.kind, encodeParams(entry.kind, edited));
        expect(roundTripped[field.key]).toBe(SAMPLE);
        for (const other of fields) {
          if (other.key === field.key) continue;
          expect(roundTripped[other.key]).toBe(base[other.key]);
        }
      });
    }
  }
});
