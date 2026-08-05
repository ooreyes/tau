import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  normalizeSymbolType,
  resolveInstalledAsyPath,
  resetInstalledAsyPathCacheForTests,
} from "./ltspiceSymbolResolve";

describe("ltspiceSymbolResolve", () => {
  let tempDir = "";

  afterEach(() => {
    resetInstalledAsyPathCacheForTests();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = "";
  });

  function fixture(): string {
    tempDir = mkdtempSync(join(tmpdir(), "tau-ltspice-symbol-"));
    mkdirSync(join(tempDir, "ADC"), { recursive: true });
    mkdirSync(join(tempDir, "OpAmps"), { recursive: true });
    writeFileSync(join(tempDir, "ADC", "AD4000.asy"), "Version 4\nSYMATTR Prefix X\n");
    writeFileSync(join(tempDir, "OpAmps", "AD711.asy"), "Version 4\nSYMATTR Prefix X\n");
    return tempDir;
  }

  it("rejects absolute and parent-escape symbol types", () => {
    expect(normalizeSymbolType("/etc/passwd")).toBeNull();
    expect(normalizeSymbolType("../escape")).toBeNull();
    expect(normalizeSymbolType("..\\escape")).toBeNull();
    expect(resolveInstalledAsyPath([fixture()], "../escape")).toBeNull();
    expect(resolveInstalledAsyPath([fixture()], "/ADC/AD4000")).toBeNull();
  });

  it("resolves bare leaf names via case-insensitive basename search", () => {
    const root = fixture();
    expect(resolveInstalledAsyPath([root], "AD4000")).toBe(join(root, "ADC", "AD4000.asy"));
    resetInstalledAsyPathCacheForTests();
    expect(resolveInstalledAsyPath([root], "ad4000")).toBe(join(root, "ADC", "AD4000.asy"));
  });

  it("prefers the authored relative path over a basename collision", () => {
    const root = fixture();
    expect(resolveInstalledAsyPath([root], "OpAmps\\AD711")).toBe(join(root, "OpAmps", "AD711.asy"));
  });

  it("caches both query and leaf keys for later lookups", () => {
    const root = fixture();
    expect(resolveInstalledAsyPath([root], "AD4000")).toBe(join(root, "ADC", "AD4000.asy"));
    expect(resolveInstalledAsyPath([root], "ad4000")).toBe(join(root, "ADC", "AD4000.asy"));
    expect(resolveInstalledAsyPath([root], "ADC/AD4000")).toBe(join(root, "ADC", "AD4000.asy"));
  });

  it("refuses ambiguous basename matches instead of picking a family", () => {
    const root = fixture();
    mkdirSync(join(root, "Misc"), { recursive: true });
    writeFileSync(join(root, "Misc", "AD4000.asy"), "Version 4\nSYMATTR Prefix X\n");
    expect(resolveInstalledAsyPath([root], "AD4000")).toBeNull();
  });

  it("treats the same relative path in two lib roots as one unique leaf", () => {
    // Autobuilder stages a TCC-safe copy beside the live LTspice lib; both
    // expose OpAmps/ADA4077-1.asy. Absolute-path uniqueness falsely refused.
    const staged = fixture();
    const liveParent = mkdtempSync(join(tmpdir(), "tau-ltspice-live-"));
    const live = join(liveParent, "sym");
    mkdirSync(join(live, "OpAmps"), { recursive: true });
    writeFileSync(join(live, "OpAmps", "ADA4077-1.asy"), "Version 4\nSYMATTR Prefix X\n");
    writeFileSync(join(staged, "OpAmps", "ADA4077-1.asy"), "Version 4\nSYMATTR Prefix X\n");
    try {
      expect(resolveInstalledAsyPath([staged, live], "ADA4077-1")).toBe(
        join(staged, "OpAmps", "ADA4077-1.asy"),
      );
      resetInstalledAsyPathCacheForTests();
      // Distinct families across roots stay refused.
      mkdirSync(join(live, "Misc"), { recursive: true });
      writeFileSync(join(live, "Misc", "ADA4077-1.asy"), "Version 4\nSYMATTR Prefix X\n");
      expect(resolveInstalledAsyPath([staged, live], "ADA4077-1")).toBeNull();
    } finally {
      rmSync(liveParent, { recursive: true, force: true });
    }
  });
});
