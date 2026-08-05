import { describe, it, expect } from "vitest";
import {
  applyPltSection,
  buildPltSection,
  classifyPltHeader,
  expressionFromTraceId,
  makePltTraceResolver,
  parsePlt,
  pltKindForMode,
  selectPltSection,
  serializePlt,
} from "./plotSettings";

const HARTLY = `[Transient Analysis]
{
   Npanes: 1
   {
      traces: 1 {524290,0,"V(out)"}
      X: ('µ',0,0,3e-005,0.00025)
      Y[0]: (' ',1,-2.5,0.5,2.5)
      Y[1]: ('_',0,1e+308,0,-1e+308)
      Volts: (' ',0,0,0,-2.5,0.5,2.5)
      Log: 0 0 0
      GridStyle: 1
   }
}
`;

const TRANSFORMER2 = `[Transient Analysis]
{
   Npanes: 3
   Active Pane: 1
   {
      traces: 1 {524290,0,"V(b)"}
      X: ('µ',0,0,1e-005,0.0001)
      Y[0]: (' ',1,-2.1,0.3,1.5)
      Y[1]: ('_',0,1e+308,0,-1e+308)
      Volts: (' ',0,0,1,-2.1,0.3,1.5)
      Log: 0 0 0
      GridStyle: 1
   },
   {
      traces: 1 {268959747,0,"V(a)"}
      X: ('µ',0,0,1e-005,0.0001)
      Y[0]: (' ',1,-2.1,0.3,1.5)
      Y[1]: ('_',0,1e+308,0,-1e+308)
      Volts: (' ',0,0,1,-2.1,0.3,1.5)
      Log: 0 0 0
      GridStyle: 1
   },
   {
      traces: 1 {268959748,0,"V(in)"}
      X: ('µ',0,0,1e-005,0.0001)
      Y[0]: (' ',1,0,0.1,1)
      Y[1]: ('_',0,1e+308,0,-1e+308)
      Volts: (' ',0,0,1,0,0.1,1)
      Log: 0 0 0
      GridStyle: 1
   }
}
`;

const LINKWITZ = `[AC Analysis]
{
   Npanes: 2
   {
      traces: 2 {589826,0,"V(out)"} {3,0,"V(out)/V(eq)"}
      X: ('K',0,10,0,10000)
      Y[0]: (' ',0,0.00316227766016838,5,1)
      Y[1]: (' ',0,-200,40,200)
      Log: 1 2 0
      GridStyle: 1
      PltMag: 1
      PltPhi: 1 0
   },
   {
      traces: 1 {524292,0,"V(eq)"}
      X: ('K',0,10,0,10000)
      Y[0]: (' ',0,0.891250938133746,1,3.54813389233576)
      Y[1]: (' ',0,132,4,180)
      Log: 1 2 0
      GridStyle: 1
      PltMag: 1
      PltPhi: 1 0
   }
}
`;

const NOTCH = `[AC Analysis]
{
   Npanes: 1
   {
      traces: 4 {524290,0,"V(w)"} {524291,0,"V(x)"} {524292,0,"V(y)"} {524293,0,"V(z)"}
      X: ('K',0,100,0,10000)
      Y[0]: (' ',0,1e-005,10,1)
      Y[1]: (' ',0,-100,20,100)
      Log: 1 2 0
      GridStyle: 1
      PltMag: 1
      PltPhi: 1 0
   }
}
`;

describe("classifyPltHeader / pltKindForMode", () => {
  it("maps common LTspice headers", () => {
    expect(classifyPltHeader("Transient Analysis")).toBe("transient");
    expect(classifyPltHeader("AC Analysis")).toBe("ac");
    expect(classifyPltHeader("DC transfer characteristic")).toBe("dc");
    expect(classifyPltHeader("Noise Spectral Density - (V/Hz½ or A/Hz½)")).toBe("noise");
    expect(classifyPltHeader("FFT of time domain data")).toBe("fft");
  });

  it("maps Tau UI modes onto plt kinds", () => {
    expect(pltKindForMode("tran")).toBe("transient");
    expect(pltKindForMode("ac")).toBe("ac");
    expect(pltKindForMode("step", "ac")).toBe("ac");
    expect(pltKindForMode("op")).toBe("unknown");
  });
});

describe("parsePlt", () => {
  it("parses a single-pane transient .plt (Hartly)", () => {
    const file = parsePlt(HARTLY);
    expect(file.sections).toHaveLength(1);
    const s = file.sections[0];
    expect(s.kind).toBe("transient");
    expect(s.npanes).toBe(1);
    expect(s.panes).toHaveLength(1);
    expect(s.panes[0].traces).toEqual([{ colorId: 524290, flag: 0, expression: "V(out)" }]);
    expect(s.panes[0].x).toMatchObject({ prefix: "µ", min: 0, max: 0.00025 });
    expect(s.panes[0].y0).toMatchObject({ min: -2.5, max: 2.5 });
    expect(s.panes[0].y1?.prefix).toBe("_");
    expect(s.panes[0].log).toEqual([0, 0, 0]);
  });

  it("parses multi-pane transient with Active Pane (Transformer2)", () => {
    const s = parsePlt(TRANSFORMER2).sections[0];
    expect(s.npanes).toBe(3);
    expect(s.activePane).toBe(1);
    expect(s.panes.map((p) => p.traces[0]?.expression)).toEqual(["V(b)", "V(a)", "V(in)"]);
  });

  it("parses AC panes with ratio expressions and log flags (Linkwitz)", () => {
    const s = parsePlt(LINKWITZ).sections[0];
    expect(s.kind).toBe("ac");
    expect(s.panes).toHaveLength(2);
    expect(s.panes[0].traces.map((t) => t.expression)).toEqual(["V(out)", "V(out)/V(eq)"]);
    expect(s.panes[0].log).toEqual([1, 2, 0]);
    expect(s.panes[0].x).toMatchObject({ min: 10, max: 10000 });
  });

  it("parses multi-trace single pane (notch)", () => {
    const s = parsePlt(NOTCH).sections[0];
    expect(s.panes[0].traces.map((t) => t.expression)).toEqual(["V(w)", "V(x)", "V(y)", "V(z)"]);
  });

  it("refuses empty / headerless input", () => {
    expect(() => parsePlt("")).toThrow(/empty/i);
    expect(() => parsePlt("Npanes: 1\n")).toThrow(/No \[Analysis\]/i);
  });
});

describe("applyPltSection", () => {
  it("places resolved traces into panes and keeps X window", () => {
    const section = parsePlt(TRANSFORMER2).sections[0];
    const resolve = makePltTraceResolver([
      { id: "n_b", label: "V(b)" },
      { id: "n_a", label: "V(a)" },
      { id: "n_in", label: "V(in)" },
    ]);
    const applied = applyPltSection(section, resolve);
    expect(applied.layout.map((p) => p.traceIds)).toEqual([["n_b"], ["n_a"], ["n_in"]]);
    expect(applied.expressions).toEqual([]);
    expect(applied.xWindow).toEqual({ xMin: 0, xMax: 0.0001 });
    expect(applied.yWindow).toEqual({ yMin: -2.1, yMax: 1.5 });
    expect(applied.xLog).toBe(false);
  });

  it("routes arithmetic traces to expressions with expr: ids (Linkwitz)", () => {
    const section = parsePlt(LINKWITZ).sections[0];
    const resolve = makePltTraceResolver([
      { id: "n_out", label: "V(out)" },
      { id: "n_eq", label: "V(eq)" },
    ]);
    const applied = applyPltSection(section, resolve);
    expect(applied.layout[0].traceIds).toEqual(["n_out", "expr:V(out)/V(eq)"]);
    expect(applied.layout[1].traceIds).toEqual(["n_eq"]);
    expect(applied.expressions).toEqual(["V(out)/V(eq)"]);
    expect(applied.unresolved).toEqual(["V(out)/V(eq)"]);
    expect(applied.xLog).toBe(true);
    expect(applied.xWindow).toEqual({ xMin: 10, xMax: 10000 });
  });

  it("selectPltSection prefers the matching analysis kind", () => {
    const multi = parsePlt(`${HARTLY}\n${NOTCH}`);
    expect(selectPltSection(multi, "ac")?.kind).toBe("ac");
    expect(selectPltSection(multi, "transient")?.kind).toBe("transient");
  });
});

describe("parsePlt against Educational .plt corpus (when present)", () => {
  it("parses real LTspice Educational plot settings without inventing panes", async () => {
    const { access, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const root = join(
      process.env.HOME ?? "",
      "Documents/LTspice/examples/Educational",
    );
    try {
      await access(root);
    } catch {
      return; // offline / no LTspice install — unit fixtures above still gate the parser
    }
    const samples = ["Hartly.plt", "Transformer2.plt", "Linkwitz.plt", "notch.plt", "Howland.plt", "Vswitch.plt", "opamp.plt"];
    for (const name of samples) {
      const text = await readFile(join(root, name), "utf8");
      const file = parsePlt(text);
      expect(file.sections.length, name).toBeGreaterThan(0);
      for (const section of file.sections) {
        expect(section.panes.length, name).toBeGreaterThan(0);
        expect(section.panes.some((p) => p.traces.length > 0), name).toBe(true);
      }
    }
  });
});

describe("serializePlt / buildPltSection round-trip", () => {
  it("round-trips Hartly durable fields through serialize → parse", () => {
    const original = parsePlt(HARTLY);
    const text = serializePlt(original);
    const again = parsePlt(text);
    expect(again.sections).toHaveLength(1);
    const s = again.sections[0];
    expect(s.kind).toBe("transient");
    expect(s.panes).toHaveLength(1);
    expect(s.panes[0].traces.map((t) => t.expression)).toEqual(["V(out)"]);
    expect(s.panes[0].x).toMatchObject({ min: 0, max: 0.00025 });
    expect(s.panes[0].y0).toMatchObject({ min: -2.5, max: 2.5 });
    expect(s.panes[0].log).toEqual([0, 0, 0]);
  });

  it("round-trips multi-pane Transformer2 traces and Active Pane", () => {
    const original = parsePlt(TRANSFORMER2);
    const again = parsePlt(serializePlt(original));
    const s = again.sections[0];
    expect(s.activePane).toBe(1);
    expect(s.panes.map((p) => p.traces[0]?.expression)).toEqual(["V(b)", "V(a)", "V(in)"]);
  });

  it("round-trips Linkwitz ratio expression and log flags", () => {
    const again = parsePlt(serializePlt(parsePlt(LINKWITZ)));
    expect(again.sections[0].panes[0].traces.map((t) => t.expression)).toEqual([
      "V(out)",
      "V(out)/V(eq)",
    ]);
    expect(again.sections[0].panes[0].log).toEqual([1, 2, 0]);
  });

  it("buildPltSection + serialize produces Open-compatible panes from Tau state", () => {
    const section = buildPltSection({
      kind: "transient",
      panes: [
        { expressions: ["V(out)"] },
        { expressions: ["V(in)", "V(out)-V(in)"] },
      ],
      xWindow: { xMin: 0, xMax: 1e-3 },
      yWindow: { yMin: -1, yMax: 1 },
      activePane: 0,
    });
    const file = parsePlt(serializePlt({ sections: [section] }));
    expect(file.sections[0].panes.map((p) => p.traces.map((t) => t.expression))).toEqual([
      ["V(out)"],
      ["V(in)", "V(out)-V(in)"],
    ]);
    expect(file.sections[0].panes[0].x).toMatchObject({ min: 0, max: 1e-3 });
    expect(file.sections[0].activePane).toBe(0);
  });

  it("expressionFromTraceId strips expr: and skips ref overlays", () => {
    expect(expressionFromTraceId("expr:V(a)-V(b)", () => null)).toBe("V(a)-V(b)");
    expect(expressionFromTraceId("n1", (id) => (id === "n1" ? "V(out)" : null))).toBe("V(out)");
    expect(expressionFromTraceId("ref:V(out)", () => "V(out)")).toBeNull();
  });
});
