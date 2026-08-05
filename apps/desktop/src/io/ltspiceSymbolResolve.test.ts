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

  it("disambiguates ambiguous leaves when exactly one family names a plaintext ModelFile", () => {
    // Live LTspice ships Comparators/AD8561.asy → AD8561.sub (encrypted) and
    // OpAmps/AD8561.asy → AD8561.lib (plaintext). Prefer the plaintext-authored
    // family; never pick via same-stem twin expansion of the encrypted .sub.
    const lib = mkdtempSync(join(tmpdir(), "tau-ltspice-lib-"));
    tempDir = lib;
    const sym = join(lib, "sym");
    const sub = join(lib, "sub");
    mkdirSync(join(sym, "Comparators"), { recursive: true });
    mkdirSync(join(sym, "OpAmps"), { recursive: true });
    mkdirSync(sub, { recursive: true });
    writeFileSync(
      join(sym, "Comparators", "AD8561.asy"),
      "Version 4\nSYMATTR Prefix X\nSYMATTR SpiceModel AD8561.sub\n",
    );
    writeFileSync(
      join(sym, "OpAmps", "AD8561.asy"),
      "Version 4\nSYMATTR Prefix X\nSYMATTR SpiceModel AD8561.lib\n",
    );
    writeFileSync(join(sub, "AD8561.sub"), Buffer.from([0x00, 0x01, 0x02, 0x03]));
    writeFileSync(join(sub, "AD8561.lib"), ".subckt AD8561 1 2 3 4 5 6 7 8\n.ends\n");
    expect(resolveInstalledAsyPath([sym], "AD8561", { libRoots: [lib] })).toBe(
      join(sym, "OpAmps", "AD8561.asy"),
    );
  });

  it("still refuses ambiguous leaves when every family is encrypted-only", () => {
    const lib = mkdtempSync(join(tmpdir(), "tau-ltspice-lib-"));
    tempDir = lib;
    const sym = join(lib, "sym");
    const sub = join(lib, "sub");
    mkdirSync(join(sym, "OpAmps"), { recursive: true });
    mkdirSync(join(sym, "ADC"), { recursive: true });
    mkdirSync(sub, { recursive: true });
    writeFileSync(
      join(sym, "OpAmps", "AD4858.asy"),
      "Version 4\nSYMATTR Prefix X\nSYMATTR ModelFile AD4858.sub\n",
    );
    writeFileSync(
      join(sym, "ADC", "AD4858.asy"),
      "Version 4\nSYMATTR Prefix X\nSYMATTR ModelFile AD4858.sub\n",
    );
    writeFileSync(join(sub, "AD4858.sub"), Buffer.from([0x00, 0x01, 0x02, 0x03]));
    expect(resolveInstalledAsyPath([sym], "AD4858", { libRoots: [lib] })).toBeNull();
  });

  it("still refuses ambiguous leaves that name distinct plaintext libraries", () => {
    const lib = mkdtempSync(join(tmpdir(), "tau-ltspice-lib-"));
    tempDir = lib;
    const sym = join(lib, "sym");
    const sub = join(lib, "sub");
    mkdirSync(join(sym, "OpAmps"), { recursive: true });
    mkdirSync(join(sym, "ADC"), { recursive: true });
    mkdirSync(sub, { recursive: true });
    writeFileSync(
      join(sym, "OpAmps", "DUP.asy"),
      "Version 4\nSYMATTR Prefix X\nSYMATTR SpiceModel A.lib\n",
    );
    writeFileSync(
      join(sym, "ADC", "DUP.asy"),
      "Version 4\nSYMATTR Prefix X\nSYMATTR SpiceModel B.lib\n",
    );
    writeFileSync(join(sub, "A.lib"), ".subckt A 1\n.ends\n");
    writeFileSync(join(sub, "B.lib"), ".subckt B 1\n.ends\n");
    expect(resolveInstalledAsyPath([sym], "DUP", { libRoots: [lib] })).toBeNull();
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
