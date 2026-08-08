import { describe, expect, it } from "vitest";
import { decodeParams, encodeParams, paramFields } from "./params";
import { CATALOG } from "./catalog";

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
