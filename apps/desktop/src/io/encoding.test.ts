import { describe, it, expect } from "vitest";
import { decodeSchematicText, parseAsc } from "./ascImport";

function utf16le(s: string, bom = true): Uint8Array {
  const out: number[] = [];
  if (bom) out.push(0xff, 0xfe);
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    out.push(c & 0xff, (c >> 8) & 0xff);
  }
  return new Uint8Array(out);
}
function utf16be(s: string): Uint8Array {
  const out: number[] = [0xfe, 0xff];
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    out.push((c >> 8) & 0xff, c & 0xff);
  }
  return new Uint8Array(out);
}

describe("decodeSchematicText", () => {
  it("decodes plain UTF-8/ASCII unchanged", () => {
    expect(decodeSchematicText(new TextEncoder().encode("Version 4\nSHEET 1"))).toBe("Version 4\nSHEET 1");
  });
  it("decodes UTF-16LE with BOM", () => {
    expect(decodeSchematicText(utf16le("Version 4"))).toBe("Version 4");
  });
  it("decodes UTF-16BE with BOM", () => {
    expect(decodeSchematicText(utf16be("Version 4"))).toBe("Version 4");
  });
  it("strips a UTF-8 BOM", () => {
    const b = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("Version 4")]);
    expect(decodeSchematicText(b)).toBe("Version 4");
  });
  it("decodes BOM-less UTF-16LE via heuristic", () => {
    expect(decodeSchematicText(utf16le("SYMBOL res 100 100 R0\nSYMATTR Value 10k", false))).toContain("SYMBOL res");
  });
  it("a UTF-16 SYMBOL line parses to a symbol after decode (regression)", () => {
    const txt = decodeSchematicText(utf16le("Version 4\nSHEET 1 880 680\nSYMBOL res 96 80 R0\nSYMATTR InstName R1\nSYMATTR Value 1k\n"));
    expect(parseAsc(txt).symbols.length).toBe(1);
  });
});
