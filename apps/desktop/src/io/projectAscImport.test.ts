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
const locallyParameterizedChildAsc = `Version 4
SHEET 1 880 680
FLAG 0 0 IN
FLAG 64 0 OUT
SYMBOL res 32 0 R90
SYMATTR InstName R1
SYMATTR Value {doubled}k
TEXT 0 100 Left 2 !.param doubled={gain}*2
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

  it("resolves bare symbols from the conventional PowerSim library", async () => {
    const inMemory = new Map([
      ["/project/sym/PowerSim/child.asy", childAsy],
      ["/project/sym/PowerSim/child.asc", locallyParameterizedChildAsc],
    ]);
    const result = await importProjectAsc(parent, {
      sourcePath: "/project/examples/top.asc",
      rootPath: "/project",
      pathExists: async (path) => inMemory.has(path),
      readText: async (path) => inMemory.get(path) ?? "",
    });

    expect(result.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "resistor", value: "6k" }),
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

const withInclude = (ref: string) => `Version 4
SHEET 1 880 680
SYMBOL res 100 100 R0
SYMATTR InstName R1
SYMATTR Value 1k
TEXT 0 200 Left 2 !.include ${ref}
`;

const opampLib = `.subckt OP07 1 2 3 4 5
R1 1 2 1meg
.ends OP07
`;

describe("importProjectAsc model library resolution", () => {
  const probe = (files: Map<string, string>) => {
    const asked: string[] = [];
    const read: string[] = [];
    return {
      asked,
      read,
      pathExists: async (path: string) => { asked.push(path); return files.has(path); },
      readText: async (path: string) => { read.push(path); return files.get(path) ?? ""; },
    };
  };

  it("reads a .include named library sitting beside the schematic", async () => {
    const io = probe(new Map([["/project/examples/opamp.lib", opampLib]]));
    const result = await importProjectAsc(withInclude("opamp.lib"), {
      sourcePath: "/project/examples/top.asc",
      rootPath: "/project",
      pathExists: io.pathExists,
      readText: io.readText,
    });

    expect(result.modelLibraries).toEqual([{ name: "opamp.lib", text: opampLib }]);
    expect(io.read).toEqual(["/project/examples/opamp.lib"]);
  });

  it("falls back to the project library folders when the sibling is absent", async () => {
    const io = probe(new Map([["/project/lib/sub/opamp.lib", opampLib]]));
    const result = await importProjectAsc(withInclude("opamp.lib"), {
      sourcePath: "/project/examples/top.asc",
      rootPath: "/project",
      pathExists: io.pathExists,
      readText: io.readText,
    });

    expect(result.modelLibraries).toEqual([{ name: "opamp.lib", text: opampLib }]);
  });

  it("resolves a quoted reference and matches on the base name", async () => {
    const io = probe(new Map([["/project/examples/models/opamp.lib", opampLib]]));
    const result = await importProjectAsc(withInclude('"models/opamp.lib"'), {
      sourcePath: "/project/examples/top.asc",
      rootPath: "/project",
      pathExists: io.pathExists,
      readText: io.readText,
    });

    expect(result.modelLibraries).toEqual([{ name: "opamp.lib", text: opampLib }]);
  });

  // The directive is document text, so a shared .asc must not be able to aim
  // Tau's reader at a path of its choosing.
  it.each([
    ["an escaping relative path", "../../../../etc/shadow.lib"],
    ["an absolute posix path", "/etc/shadow.lib"],
    ["an absolute windows path", "C:\\Windows\\secrets.lib"],
    ["a backslash escape", "..\\..\\secrets.lib"],
  ])("refuses to read %s", async (_label, ref) => {
    const io = probe(new Map());
    const result = await importProjectAsc(withInclude(ref), {
      sourcePath: "/project/examples/top.asc",
      rootPath: "/project",
      pathExists: io.pathExists,
      readText: io.readText,
    });

    expect(result.modelLibraries).toEqual([]);
    expect(io.read).toEqual([]);
    // Symbol resolution probes its own candidates; none of them, and nothing
    // else, may leave the project or carry the reference's path.
    for (const path of io.asked) {
      expect(path.startsWith("/project/")).toBe(true);
      expect(path).not.toContain("..");
      expect(path.toLowerCase()).not.toContain("shadow");
      expect(path.toLowerCase()).not.toContain("secrets");
    }
  });

  it("leaves a non-model extension to the deliberate attach flow", async () => {
    const io = probe(new Map([["/project/examples/notes.txt", opampLib]]));
    const result = await importProjectAsc(withInclude("notes.txt"), {
      sourcePath: "/project/examples/top.asc",
      rootPath: "/project",
      pathExists: io.pathExists,
      readText: io.readText,
    });

    expect(result.modelLibraries).toEqual([]);
    expect(io.read).toEqual([]);
  });

  it("does not re-read a name the bundled libraries already define", async () => {
    const io = probe(new Map([["/project/examples/TowTom2.sub", opampLib]]));
    const result = await importProjectAsc(withInclude("TowTom2.sub"), {
      sourcePath: "/project/examples/top.asc",
      rootPath: "/project",
      pathExists: io.pathExists,
      readText: io.readText,
    });

    expect(result.modelLibraries).toEqual([]);
    expect(io.read).toEqual([]);
  });

  it("reports no libraries when nothing on disk matches", async () => {
    const io = probe(new Map());
    const result = await importProjectAsc(withInclude("missing.lib"), {
      sourcePath: "/project/examples/top.asc",
      rootPath: "/project",
      pathExists: io.pathExists,
      readText: io.readText,
    });

    expect(result.modelLibraries).toEqual([]);
    expect(io.read).toEqual([]);
  });
});
