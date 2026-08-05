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
});
