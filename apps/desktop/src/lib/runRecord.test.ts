import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { diskContentFingerprint } from "./externalEditConflict";
import {
  RUN_RECORD_HISTORY_KEY,
  RUN_RECORD_HISTORY_MAX,
  RUN_RECORD_KIND,
  RUN_RECORD_VERSION,
  buildRunRecord,
  clearRunRecordHistory,
  deckFingerprint,
  loadRunRecordHistory,
  parseRunRecord,
  rememberRunRecord,
  runRecordFileName,
  runRecordReproducibilityKey,
  serializeRunRecord,
} from "./runRecord";

const memory = new Map<string, string>();

beforeEach(() => {
  memory.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value); },
    removeItem: (key: string) => { memory.delete(key); },
    clear: () => memory.clear(),
    key: () => null,
    get length() { return memory.size; },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("deckFingerprint", () => {
  it("matches diskContentFingerprint for the same deck text", () => {
    const deck = "* tau deck\nR1 in out 1k\n.end\n";
    expect(deckFingerprint(deck)).toBe(diskContentFingerprint(deck));
  });

  it("returns null for empty/missing deck", () => {
    expect(deckFingerprint(null)).toBeNull();
    expect(deckFingerprint("")).toBeNull();
    expect(deckFingerprint(undefined)).toBeNull();
  });
});

describe("buildRunRecord / parseRunRecord", () => {
  it("round-trips a successful transient record", () => {
    const built = buildRunRecord({
      title: "rc.asc",
      filePath: "/tmp/rc.asc",
      documentSignature: "sig-rc",
      deckText: "* rc\nR1 1 0 1k\n.end\n",
      analysis: "tran",
      directive: ".tran 1m",
      engine: "ngspice",
      status: "ok",
      warnings: ["note: soft"],
      measurements: [{ name: "Vmax", value: 5, at: 1e-3 }],
      summary: {
        sampleCount: 100,
        netCount: 2,
        componentCount: 3,
        stopTime: 0.001,
        durationMs: 42,
        highlights: [{ label: "V(out)", value: 4.2, unit: "V" }],
      },
      createdAt: 1_700_000_000_000,
    });

    expect(built.kind).toBe(RUN_RECORD_KIND);
    expect(built.version).toBe(RUN_RECORD_VERSION);
    expect(built.circuit.deckFingerprint).toBe(diskContentFingerprint("* rc\nR1 1 0 1k\n.end\n"));
    expect(built.diagnostics).toEqual([
      { severity: "warning", code: "sim.warning", message: "note: soft" },
    ]);

    const parsed = parseRunRecord(JSON.parse(serializeRunRecord(built)));
    expect(parsed).toEqual(built);
  });

  it("records machine-readable error diagnostics without claiming success", () => {
    const built = buildRunRecord({
      title: "bad.asc",
      documentSignature: "sig-bad",
      analysis: "op",
      engine: "ngspice",
      status: "error",
      message: "Singular matrix",
      details: "stdout: ...\nstderr: ...",
      createdAt: 1_700_000_000_001,
    });
    expect(built.status).toBe("error");
    expect(built.diagnostics[0]).toEqual({
      severity: "error",
      code: "sim.error",
      message: "Singular matrix",
    });
    expect(built.technicalDetail).toMatch(/stdout/);
  });

  it("records refused runs with sim.refused", () => {
    const built = buildRunRecord({
      title: "chan.asc",
      documentSignature: "sig-chan",
      analysis: "tran",
      status: "refused",
      message: "Simulation refused: L1 (ind) has no electrically equivalent Tau model.",
      createdAt: 1_700_000_000_002,
    });
    expect(built.diagnostics[0]?.code).toBe("sim.refused");
    expect(built.analysis.engine).toBe("unknown");
  });

  it("discards corrupt or wrong-version payloads", () => {
    expect(parseRunRecord({ version: 99, kind: RUN_RECORD_KIND })).toBeNull();
    expect(parseRunRecord({ kind: "other", version: 1 })).toBeNull();
    expect(parseRunRecord(null)).toBeNull();
    expect(parseRunRecord("{not-json")).toBeNull();
  });
});

describe("runRecordReproducibilityKey", () => {
  it("matches for identical circuit/analysis identity ignoring wall-clock fields", () => {
    const a = buildRunRecord({
      title: "a.asc",
      documentSignature: "sig",
      deckText: "deck",
      analysis: "ac",
      engine: "ngspice",
      status: "ok",
      summary: { sampleCount: 10, durationMs: 5 },
      createdAt: 100,
    });
    const b = buildRunRecord({
      title: "a.asc",
      documentSignature: "sig",
      deckText: "deck",
      analysis: "ac",
      engine: "ngspice",
      status: "ok",
      summary: { sampleCount: 10, durationMs: 99 },
      createdAt: 200,
    });
    expect(runRecordReproducibilityKey(a)).toBe(runRecordReproducibilityKey(b));
  });

  it("changes when the document signature changes", () => {
    const a = buildRunRecord({
      title: "a.asc",
      documentSignature: "sig-1",
      analysis: "op",
      status: "ok",
      createdAt: 1,
    });
    const b = buildRunRecord({
      title: "a.asc",
      documentSignature: "sig-2",
      analysis: "op",
      status: "ok",
      createdAt: 1,
    });
    expect(runRecordReproducibilityKey(a)).not.toBe(runRecordReproducibilityKey(b));
  });
});

describe("runRecordFileName", () => {
  it("strips .asc and sanitizes", () => {
    expect(runRecordFileName("tank.asc")).toBe("tank.tau-run.json");
    expect(runRecordFileName("My Circuit!!.asc")).toBe("My_Circuit.tau-run.json");
  });
});

describe("rememberRunRecord / loadRunRecordHistory", () => {
  it("persists newest-first and caps length", () => {
    for (let i = 0; i < RUN_RECORD_HISTORY_MAX + 3; i += 1) {
      rememberRunRecord(buildRunRecord({
        title: `r${i}.asc`,
        documentSignature: `sig-${i}`,
        analysis: "op",
        status: "ok",
        createdAt: 1_000 + i,
      }));
    }
    const history = loadRunRecordHistory();
    expect(history).toHaveLength(RUN_RECORD_HISTORY_MAX);
    expect(history[0]?.circuit.title).toBe(`r${RUN_RECORD_HISTORY_MAX + 2}.asc`);
    expect(memory.get(RUN_RECORD_HISTORY_KEY)).toMatch(/tau\.run\.record\.v1/);
  });

  it("clears history", () => {
    rememberRunRecord(buildRunRecord({
      title: "x.asc",
      documentSignature: "s",
      analysis: "op",
      status: "ok",
      createdAt: 1,
    }));
    clearRunRecordHistory();
    expect(loadRunRecordHistory()).toEqual([]);
  });

  it("ignores corrupt history payloads", () => {
    memory.set(RUN_RECORD_HISTORY_KEY, "{bad");
    expect(loadRunRecordHistory()).toEqual([]);
  });
});
