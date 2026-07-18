import { describe, expect, it, vi } from "vitest";
import { importProjectAsc } from "./projectAscImport";

const parent = `Version 4
SHEET 1 880 680
SYMBOL child 100 100 R0
SYMATTR InstName X1
SYMATTR Value gain=3
`;
const childAsy = `Version 4
SymbolType CELL
PIN 0 0 LEFT 0
PINATTR PinName IN
PINATTR SpiceOrder 1
PIN 64 0 RIGHT 0
PINATTR PinName OUT
PINATTR SpiceOrder 2
SYMATTR Value gain=2
`;
const childAsc = `Version 4
SHEET 1 880 680
FLAG 0 0 IN
FLAG 64 0 OUT
SYMBOL res 32 0 R90
SYMATTR InstName R1
SYMATTR Value {gain}k
`;

describe("importProjectAsc", () => {
  it("resolves project-root symbol libraries and applies CELL overrides", async () => {
    const inMemory = new Map([
      ["/project/sym/child.asy", childAsy],
      ["/project/sym/child.asc", childAsc],
    ]);
    const result = await importProjectAsc(parent, {
      sourcePath: "/project/examples/top.asc",
      rootPath: "/project",
      pathExists: async (path) => inMemory.has(path),
      readText: async (path) => inMemory.get(path) ?? "",
    });

    expect(result.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "resistor", value: "3k" }),
    ]));
    expect(result.warnings).toEqual([]);
  });

  it("does not probe traversal or absolute symbol paths", async () => {
    const exists = vi.fn(async () => false);
    const hostile = `${parent}SYMBOL ../../secret 0 0 R0\nSYMATTR InstName X2\n`;
    await importProjectAsc(hostile, {
      sourcePath: "/project/top.asc",
      rootPath: "/project",
      pathExists: exists,
      readText: async () => "",
    });
    expect(exists.mock.calls.flat().every((path) => !String(path).includes("secret"))).toBe(true);
  });
});
