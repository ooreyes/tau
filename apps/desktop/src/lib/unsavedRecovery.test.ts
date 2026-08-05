import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchematicDocument } from "../store/useSchematic";
import {
  LEGACY_AUTOSAVE_KEY,
  UNSAVED_RECOVERY_KEY,
  clearAllUnsavedLocalState,
  clearUnsavedRecovery,
  documentHasRecoverableContent,
  formatRecoveryAge,
  loadUnsavedRecovery,
  peekUnsavedRecoveryOffer,
  saveUnsavedRecovery,
} from "./unsavedRecovery";

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

function resistorDoc(): SchematicDocument {
  return {
    components: [{
      id: "r1",
      kind: "resistor",
      label: "R1",
      value: "1k",
      x: 0,
      y: 0,
      rotation: 0,
    }],
    wires: [],
    probes: [],
    netLabels: [],
  };
}

describe("documentHasRecoverableContent", () => {
  it("rejects a blank document", () => {
    expect(documentHasRecoverableContent({ components: [], wires: [] })).toBe(false);
  });

  it("accepts a document with a component", () => {
    expect(documentHasRecoverableContent(resistorDoc())).toBe(true);
  });
});

describe("saveUnsavedRecovery / loadUnsavedRecovery", () => {
  it("round-trips a dirty snapshot", () => {
    saveUnsavedRecovery({
      title: "tank.asc",
      filePath: "/tmp/tank.asc",
      signature: "sig-1",
      document: resistorDoc(),
      savedAt: 1_700_000_000_000,
    });
    expect(loadUnsavedRecovery()).toEqual({
      version: 1,
      savedAt: 1_700_000_000_000,
      dirty: true,
      title: "tank.asc",
      filePath: "/tmp/tank.asc",
      signature: "sig-1",
      document: expect.objectContaining({
        components: [expect.objectContaining({ label: "R1", value: "1k" })],
      }),
    });
  });

  it("refuses to persist a blank document and clears any prior snapshot", () => {
    saveUnsavedRecovery({
      title: "tank.asc",
      signature: "sig-1",
      document: resistorDoc(),
    });
    expect(loadUnsavedRecovery()).not.toBeNull();
    saveUnsavedRecovery({
      title: "blank.asc",
      signature: "sig-blank",
      document: { components: [], wires: [] },
    });
    expect(loadUnsavedRecovery()).toBeNull();
  });

  it("discards corrupt or wrong-version payloads", () => {
    memory.set(UNSAVED_RECOVERY_KEY, JSON.stringify({ version: 99, dirty: true }));
    expect(loadUnsavedRecovery()).toBeNull();
    memory.set(UNSAVED_RECOVERY_KEY, "{not-json");
    expect(loadUnsavedRecovery()).toBeNull();
  });
});

describe("peekUnsavedRecoveryOffer", () => {
  it("returns the versioned snapshot when present", () => {
    saveUnsavedRecovery({
      title: "a.asc",
      signature: "s",
      document: resistorDoc(),
    });
    expect(peekUnsavedRecoveryOffer()?.title).toBe("a.asc");
  });

  it("migrates a legacy non-empty autosave into an offer", () => {
    memory.set(LEGACY_AUTOSAVE_KEY, JSON.stringify(resistorDoc()));
    const offer = peekUnsavedRecoveryOffer();
    expect(offer).not.toBeNull();
    expect(offer?.title).toBe("untitled.asc");
    expect(offer?.signature).toBe("legacy-autosave");
    expect(offer?.document.components[0]?.label).toBe("R1");
    expect(loadUnsavedRecovery()?.signature).toBe("legacy-autosave");
  });

  it("ignores an empty legacy autosave", () => {
    memory.set(LEGACY_AUTOSAVE_KEY, JSON.stringify({ components: [], wires: [] }));
    expect(peekUnsavedRecoveryOffer()).toBeNull();
  });
});

describe("clearAllUnsavedLocalState", () => {
  it("clears both recovery and legacy autosave keys", () => {
    saveUnsavedRecovery({
      title: "a.asc",
      signature: "s",
      document: resistorDoc(),
    });
    memory.set(LEGACY_AUTOSAVE_KEY, JSON.stringify(resistorDoc()));
    clearAllUnsavedLocalState();
    expect(loadUnsavedRecovery()).toBeNull();
    expect(memory.get(LEGACY_AUTOSAVE_KEY)).toBeUndefined();
  });

  it("clearUnsavedRecovery leaves the legacy key alone", () => {
    memory.set(LEGACY_AUTOSAVE_KEY, "keep");
    saveUnsavedRecovery({
      title: "a.asc",
      signature: "s",
      document: resistorDoc(),
    });
    clearUnsavedRecovery();
    expect(loadUnsavedRecovery()).toBeNull();
    expect(memory.get(LEGACY_AUTOSAVE_KEY)).toBe("keep");
  });
});

describe("formatRecoveryAge", () => {
  it("formats relative ages", () => {
    const now = 1_700_000_000_000;
    expect(formatRecoveryAge(now - 10_000, now)).toBe("just now");
    expect(formatRecoveryAge(now - 120_000, now)).toBe("2 minutes ago");
    expect(formatRecoveryAge(now - 3_600_000, now)).toBe("1 hour ago");
    expect(formatRecoveryAge(now - 3 * 86_400_000, now)).toBe("3 days ago");
  });
});
