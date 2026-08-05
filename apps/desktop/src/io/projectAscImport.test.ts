import { describe, expect, it, vi } from "vitest";
import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { importProjectAsc } from "./projectAscImport";
import { ascRewriteRisks, serializeSchematicFile } from "../project/types";

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
  it("saves the canonical Class-D parent with its deadtime hierarchy intact", async () => {
    const fixtureDir = resolve(process.cwd(), "../../examples/class-d-amplifier");
    const sourcePath = join(fixtureDir, "class-d-starter.asc");
    const source = await readFile(sourcePath, "utf8");
    const result = await importProjectAsc(source, {
      sourcePath,
      rootPath: fixtureDir,
      pathExists: async (path) => access(path).then(() => true, () => false),
      readText: async (path) => readFile(path, "utf8"),
    });

    expect(result.hierarchicalBlocks).toHaveLength(1);
    expect(result.hierarchicalBlocks[0]).toMatchObject({
      type: "deadtime",
      attrs: { InstName: "X1" },
      provenance: expect.objectContaining({ componentCount: expect.any(Number) }),
    });
    expect(ascRewriteRisks(source, result.foreignSymbols, result.hierarchicalBlocks)).toEqual([]);

    const saved = serializeSchematicFile(sourcePath, {
      components: result.components,
      wires: result.wires,
      probes: [],
      netLabels: result.netLabels,
      directives: result.directives,
      textAnnotations: result.textAnnotations,
      ascShapes: result.shapes,
      ascDataFlags: result.dataFlags,
      ascForeignSymbols: result.foreignSymbols,
      ascHierarchicalBlocks: result.hierarchicalBlocks,
      ascSheet: result.sheet,
      userModelLibraries: result.modelLibraries,
    });
    expect(saved.warnings).toEqual([]);
    expect(saved.contents).toContain("SYMBOL deadtime 336 -304 R0");
    expect(saved.contents).toContain("SYMATTR InstName X1");
    expect(saved.contents).not.toContain("SYMATTR InstName X1.");
  });

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

  it("follows a nested .lib inside an auto-resolved sibling library", async () => {
    const peer = `.subckt PEER 1 2\nR1 1 2 1k\n.ends PEER\n`;
    const parent = `* parent wraps peer\n.lib peer.lib\n.subckt WRAP 1 2\nX1 1 2 PEER\n.ends WRAP\n`;
    const io = probe(new Map([
      ["/project/examples/parent.lib", parent],
      ["/project/examples/peer.lib", peer],
    ]));
    const result = await importProjectAsc(withInclude("parent.lib"), {
      sourcePath: "/project/examples/top.asc",
      rootPath: "/project",
      pathExists: io.pathExists,
      readText: io.readText,
    });

    expect(result.modelLibraries).toEqual([
      { name: "parent.lib", text: parent },
      { name: "peer.lib", text: peer },
    ]);
    expect(io.read).toEqual([
      "/project/examples/parent.lib",
      "/project/examples/peer.lib",
    ]);
  });

  it("follows a nested .include through the installed LTspice library root", async () => {
    const peer = `.subckt UOA2 1 2 3 4 5\nR1 1 2 1meg\n.ends UOA2\n`;
    const parent = `.lib UniversalOpAmp2.lib\n.subckt AD8310 1 2 3 4 5\nX1 1 2 3 4 5 UOA2\n.ends AD8310\n`;
    const reads: string[] = [];
    const result = await importProjectAsc(withInclude("AD8310.lib"), {
      sourcePath: "/project/examples/top.asc",
      rootPath: "/project",
      pathExists: async () => false,
      readText: async () => "",
      readInstalledLtspiceText: async (id) => {
        reads.push(id);
        if (id === "sub/AD8310.lib") return parent;
        if (id === "sub/UniversalOpAmp2.lib") return peer;
        throw new Error("missing");
      },
    });

    expect(result.modelLibraries).toEqual([
      { name: "ad8310.lib", text: parent },
      { name: "universalopamp2.lib", text: peer },
    ]);
    expect(reads.filter((id) => id.startsWith("sub/"))).toEqual([
      "sub/AD8310.lib",
      "sub/UniversalOpAmp2.lib",
    ]);
  });

  it("does not follow a nested path that escapes confinement", async () => {
    const parent = `.include ../../secret.lib\n.subckt WRAP 1 2\nR1 1 2 1k\n.ends WRAP\n`;
    const io = probe(new Map([["/project/examples/parent.lib", parent]]));
    const result = await importProjectAsc(withInclude("parent.lib"), {
      sourcePath: "/project/examples/top.asc",
      rootPath: "/project",
      pathExists: io.pathExists,
      readText: io.readText,
    });

    expect(result.modelLibraries).toEqual([{ name: "parent.lib", text: parent }]);
    expect(io.read).toEqual(["/project/examples/parent.lib"]);
    expect(io.asked.every((path) => !path.toLowerCase().includes("secret"))).toBe(true);
  });

  it("breaks a cyclic nested .include without duplicating libraries", async () => {
    const a = `.include b.lib\n.subckt A 1 2\nR1 1 2 1k\n.ends A\n`;
    const b = `.include a.lib\n.subckt B 1 2\nR1 1 2 2k\n.ends B\n`;
    const io = probe(new Map([
      ["/project/examples/a.lib", a],
      ["/project/examples/b.lib", b],
    ]));
    const result = await importProjectAsc(withInclude("a.lib"), {
      sourcePath: "/project/examples/top.asc",
      rootPath: "/project",
      pathExists: io.pathExists,
      readText: io.readText,
    });

    expect(result.modelLibraries).toEqual([
      { name: "a.lib", text: a },
      { name: "b.lib", text: b },
    ]);
    expect(io.read).toEqual([
      "/project/examples/a.lib",
      "/project/examples/b.lib",
    ]);
  });

  it("resolves a vendor op-amp's .asy model alias and implicit library without changing the ASC", async () => {
    const source = `Version 4
SHEET 1 880 680
SYMBOL Opamps/OP07 100 100 R0
SYMATTR InstName U1
`;
    const symbol = `Version 4
SymbolType CELL
SYMATTR Value OP07
SYMATTR Prefix X
SYMATTR SpiceModel vendor.lib
SYMATTR Value2 LT1001
PIN -32 80 NONE 0
PINATTR PinName In+
PINATTR SpiceOrder 1
PIN -32 48 NONE 0
PINATTR PinName In-
PINATTR SpiceOrder 2
PIN 0 32 NONE 0
PINATTR PinName V+
PINATTR SpiceOrder 3
PIN 0 96 NONE 0
PINATTR PinName V-
PINATTR SpiceOrder 4
PIN 32 64 NONE 0
PINATTR PinName OUT
PINATTR SpiceOrder 5
`;
    const model = ".subckt LT1001 1 2 3 4 5\nE1 5 0 1 2 1Meg\n.ends LT1001\n";
    const io = probe(new Map([
      ["/project/sym/Opamps/OP07.asy", symbol],
      ["/project/lib/sub/vendor.lib", model],
    ]));
    const result = await importProjectAsc(source, {
      sourcePath: "/project/examples/top.asc",
      rootPath: "/project",
      pathExists: io.pathExists,
      readText: io.readText,
    });

    expect(result.components[0]).toMatchObject({
      kind: "opamp",
      ltSymbolType: "Opamps/OP07",
      ltModelName: "LT1001",
      ltModelFile: "vendor.lib",
    });
    expect(result.modelLibraries).toEqual([{ name: "vendor.lib", text: model }]);
    const saved = serializeSchematicFile("/project/examples/top.asc", {
      components: result.components,
      wires: result.wires,
      probes: [],
      netLabels: result.netLabels,
      directives: result.directives,
      ascForeignSymbols: result.foreignSymbols,
      ascHierarchicalBlocks: result.hierarchicalBlocks,
      userModelLibraries: result.modelLibraries,
    });
    expect(saved.contents).toBe(source);
    expect(saved.contents).not.toMatch(/SYMATTR (?:Value2|SpiceModel)/);
  });

  it("reads Prefix-X symbol metadata and plaintext model only from the fixed installed library", async () => {
    const source = `Version 4
SHEET 1 880 680
SYMBOL PowerProducts/LT1175 100 200 R0
SYMATTR InstName U1
`;
    const symbol = `Version 4
SymbolType CELL
SYMATTR Value LT1175
SYMATTR Prefix X
SYMATTR SpiceModel LT1175.lib
SYMATTR Value2 LT1175
PIN 0 -144 TOP 8
PINATTR PinName IN
PINATTR SpiceOrder 1
PIN 128 64 RIGHT 8
PINATTR PinName OUT
PINATTR SpiceOrder 2
`;
    const model = ".subckt LT1175 IN OUT\nR1 IN OUT 1k\n.ends LT1175\n";
    const installed = new Map([
      ["sym/PowerProducts/LT1175.asy", symbol],
      ["sub/LT1175.lib", model],
    ]);
    const reads: string[] = [];
    const result = await importProjectAsc(source, {
      sourcePath: "/project/examples/top.asc",
      rootPath: "/project",
      pathExists: async () => false,
      readText: async () => "",
      readInstalledLtspiceText: async (id) => {
        reads.push(id);
        const text = installed.get(id);
        if (!text) throw new Error("missing");
        return text;
      },
    });

    expect(result.foreignSymbols).toHaveLength(0);
    expect(result.components[0]).toMatchObject({
      kind: "subckt",
      value: "LT1175",
      ltModelFile: "LT1175.lib",
    });
    expect(result.modelLibraries).toEqual([{ name: "lt1175.lib", text: model }]);
    expect(reads).toContain("sym/PowerProducts/LT1175.asy");
    expect(reads).toContain("sub/LT1175.lib");
  });

  it("keeps an installed encrypted model unavailable without sinking the schematic", async () => {
    const source = "Version 4\nSHEET 1 880 680\nSYMBOL PowerProducts/LT1172 0 0 R0\nSYMATTR InstName U1\n";
    const symbol = "Version 4\nSymbolType CELL\nSYMATTR Value LT1172\nSYMATTR Prefix X\nSYMATTR SpiceModel LT1172.sub\nPIN 0 0 LEFT 0\nPINATTR PinName IN\nPINATTR SpiceOrder 1\n";
    const result = await importProjectAsc(source, {
      sourcePath: "/project/top.asc",
      rootPath: "/project",
      pathExists: async () => false,
      readText: async () => "",
      readInstalledLtspiceText: async (id) => {
        if (id.endsWith(".asy")) return symbol;
        throw new Error("binary or encrypted");
      },
    });
    expect(result.components[0]).toMatchObject({ kind: "subckt", value: "LT1172" });
    expect(result.modelLibraries).toEqual([]);
  });

  it("does not read an implicit model path that escapes through .asy metadata", async () => {
    const source = "Version 4\nSHEET 1 880 680\nSYMBOL Opamps/OP07 0 0 R0\nSYMATTR InstName U1\n";
    const symbol = "Version 4\nSymbolType CELL\nSYMATTR Value OP07\nSYMATTR Value2 LT1001\nSYMATTR SpiceModel ../../secret.lib\n";
    const io = probe(new Map([["/project/sym/Opamps/OP07.asy", symbol]]));
    const result = await importProjectAsc(source, {
      sourcePath: "/project/examples/top.asc",
      rootPath: "/project",
      pathExists: io.pathExists,
      readText: io.readText,
    });
    expect(result.modelLibraries).toEqual([]);
    expect(io.asked.every((path) => !path.includes("secret"))).toBe(true);
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

  // A vendor library can easily be bigger than the project reader's byte cap,
  // and the reader throws on one. That must cost the models, not the whole
  // schematic - the deck builder still names the file it could not resolve.
  it("still imports the schematic when the library file cannot be read", async () => {
    const io = probe(new Map([["/project/examples/huge.lib", opampLib]]));
    const result = await importProjectAsc(withInclude("huge.lib"), {
      sourcePath: "/project/examples/top.asc",
      rootPath: "/project",
      pathExists: io.pathExists,
      readText: async (path: string) => {
        if (path.endsWith("huge.lib")) throw new Error("Schematic files are limited to 5,242,880 bytes.");
        return io.readText(path);
      },
    });

    expect(result.modelLibraries).toEqual([]);
    expect(result.components).toHaveLength(1);
  });
});
