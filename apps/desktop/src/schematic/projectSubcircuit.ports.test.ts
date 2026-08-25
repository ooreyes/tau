import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  asciiFold,
  defaultProjectModelName,
  hasMatchingOrderedProjectPorts,
  linkedProjectSheetPaths,
  MAX_PROJECT_SUBCIRCUIT_PORTS,
  orderedProjectSheetUses,
  projectSheetInterfaceDrift,
  projectSheetPortsValidation,
  PROJECT_SPICE_TOKEN,
  type PortSide,
  type ProjectSheetInterfaceEntry,
} from "./projectSubcircuit";
import type { SchematicPortDirection } from "./types";

/**
 * Item 14, lane CHILD. These are acceptance checks B4-B7 of the spec.
 *
 * The contract this file defends is *the friendly voice may never say "fine"
 * where Run would refuse*. Drift is an advisory, earlier restatement of the
 * same fact the fail-closed compiler asserts, so B5 pins the two together as a
 * property rather than as a handful of examples.
 */

function entryOf(
  names: readonly string[],
  directions: readonly SchematicPortDirection[],
  overrides: Partial<ProjectSheetInterfaceEntry> = {},
): ProjectSheetInterfaceEntry {
  return {
    sheetPath: "boost.sim",
    fileName: "boost.sim",
    status: "ok",
    ports: names.map((name, index) => ({
      name,
      labelId: `label-${index}`,
      direction: directions[index] ?? "BiDir",
    })),
    ...overrides,
  };
}

/** The side a direction implies under BLOCK's slot rule, for fixtures only. */
function sideFor(direction: SchematicPortDirection): PortSide {
  return direction === "In" ? "left" : "right";
}

describe("project sheet edge presentation", () => {
  it("keeps a linked child classified after its parent tab closes", () => {
    const childPaths = linkedProjectSheetPaths([{
      document: {
        components: [{
          id: "x1",
          kind: "subckt",
          x: 0,
          y: 0,
          rotation: 0,
          value: "Buck5V",
          label: "X1",
          projectSubcircuit: {
            sheetPath: "children/Buck5V.asc",
            model: "Buck5V",
            ports: ["VIN", "VOUT"],
          },
        }],
      },
    }]);
    expect(childPaths).toEqual(new Set(["children/Buck5V.asc"]));
  });

  it("orders confirmed parent mappings by canonical path then reference", () => {
    expect(orderedProjectSheetUses([
      { sheetPath: "z/top.sim", reference: "X2" },
      { sheetPath: "a/top.sim", reference: "X9" },
      { sheetPath: "a/top.sim", reference: "X1" },
    ])).toEqual([
      { sheetPath: "a/top.sim", reference: "X1" },
      { sheetPath: "a/top.sim", reference: "X9" },
      { sheetPath: "z/top.sim", reference: "X2" },
    ]);
  });

  it("orders non-ASCII paths by code point instead of the host locale", () => {
    expect(orderedProjectSheetUses([
      { sheetPath: "Å-power.sim", reference: "X1" },
      { sheetPath: "z-power.sim", reference: "X1" },
      { sheetPath: "a-power.sim", reference: "X1" },
    ]).map((use) => use.sheetPath)).toEqual([
      "a-power.sim",
      "z-power.sim",
      "Å-power.sim",
    ]);
  });
});

function sidesOf(directions: readonly SchematicPortDirection[]): PortSide[] {
  return directions.map(sideFor);
}

describe("projectSheetInterfaceDrift (B4 truth table)", () => {
  it("calls an identical ordered interface in-sync", () => {
    const directions: SchematicPortDirection[] = ["In", "Out", "BiDir"];
    const sides = sidesOf(directions);
    expect(projectSheetInterfaceDrift(
      ["IN", "OUT", "GND"],
      entryOf(["IN", "OUT", "GND"], directions),
      { current: sides, expected: sides },
    )).toEqual({ kind: "in-sync" });
  });

  it("folds case exactly the way the compiler's comparison does", () => {
    const sides: PortSide[] = ["left"];
    const drift = projectSheetInterfaceDrift(
      ["vin"],
      entryOf(["VIN"], ["In"]),
      { current: sides, expected: sides },
    );
    expect(drift.kind).toBe("in-sync");
  });

  it("reports a renamed position as the true fact, without inventing port identity", () => {
    const directions: SchematicPortDirection[] = ["In", "Out"];
    const sides = sidesOf(directions);
    const drift = projectSheetInterfaceDrift(
      ["IN", "OUT"],
      entryOf(["IN", "VOUT"], directions),
      { current: sides, expected: sides },
    );
    if (drift.kind !== "drifted") throw new Error(`expected drifted, got ${drift.kind}`);
    expect(drift.reordered).toBe(false);
    expect(drift.electricallyInert).toBe(false);
    expect(drift.rows.map((row) => row.change)).toEqual(["same", "renamed"]);
    const renamed = drift.rows[1]!;
    expect(renamed.position).toBe(2);
    expect(renamed.was).toMatchObject({ name: "OUT" });
    expect(renamed.now).toMatchObject({ name: "VOUT", direction: "Out" });
    // Required semantics: node order is unchanged, only the emitted header name.
    expect(renamed.consequence.toLowerCase()).toContain("node order is unchanged");
    expect(renamed.consequence).toContain(".subckt");
    expect(renamed.consequence).toContain("VOUT");
  });

  it("classifies a same-multiset reorder as moved, never as renamed", () => {
    const drift = projectSheetInterfaceDrift(
      ["IN", "OUT", "GND"],
      entryOf(["IN", "GND", "OUT"], ["In", "BiDir", "Out"]),
      { current: ["left", "right", "right"], expected: ["left", "right", "right"] },
    );
    if (drift.kind !== "drifted") throw new Error(`expected drifted, got ${drift.kind}`);
    expect(drift.reordered).toBe(true);
    expect(drift.rows.map((row) => row.change)).toEqual(["same", "moved", "moved"]);
    expect(drift.rows.some((row) => row.change === "renamed")).toBe(false);
    expect(drift.electricallyInert).toBe(false);
    expect(drift.summary).toContain("IN, OUT, GND");
    expect(drift.summary).toContain("IN, GND, OUT");
    const moved = drift.rows[1]!;
    expect(moved.consequence.toLowerCase()).toContain("which net becomes which node");
    expect(moved.consequence.toLowerCase()).toContain("wire on pin 2");
  });

  it("appends a row for a port the child gained", () => {
    const drift = projectSheetInterfaceDrift(
      ["IN", "OUT"],
      entryOf(["IN", "OUT", "EN"], ["In", "Out", "In"]),
      { current: ["left", "right"], expected: ["left", "right", "left"] },
    );
    if (drift.kind !== "drifted") throw new Error(`expected drifted, got ${drift.kind}`);
    const added = drift.rows[2]!;
    expect(added.change).toBe("added");
    expect(added.was).toBeUndefined();
    expect(added.now).toMatchObject({ name: "EN" });
    expect(added.consequence).toContain("pin 3");
  });

  it("says a removed port leaves its wire unconnected", () => {
    const drift = projectSheetInterfaceDrift(
      ["IN", "OUT", "GND"],
      entryOf(["IN", "OUT"], ["In", "Out"]),
      { current: ["left", "right", "right"], expected: ["left", "right"] },
    );
    if (drift.kind !== "drifted") throw new Error(`expected drifted, got ${drift.kind}`);
    const removed = drift.rows[2]!;
    expect(removed.change).toBe("removed");
    expect(removed.now).toBeUndefined();
    expect(removed.consequence.toLowerCase()).toContain("left unconnected");
    expect(drift.electricallyInert).toBe(false);
  });

  it("marks a side-only change electrically inert and names both sides", () => {
    const drift = projectSheetInterfaceDrift(
      ["IN", "GND"],
      entryOf(["IN", "GND"], ["In", "In"]),
      { current: ["left", "right"], expected: ["left", "left"] },
    );
    if (drift.kind !== "drifted") throw new Error(`expected drifted, got ${drift.kind}`);
    expect(drift.rows.map((row) => row.change)).toEqual(["same", "direction"]);
    expect(drift.electricallyInert).toBe(true);
    expect(drift.reordered).toBe(false);
    const moved = drift.rows[1]!;
    expect(moved.consequence).toContain("right");
    expect(moved.consequence).toContain("left");
    expect(moved.consequence.toLowerCase()).toContain("nothing electrical changes");
  });

  it("distinguishes not-checked, no-interface, unreadable and missing", () => {
    const sides = { current: ["left" as PortSide], expected: ["left" as PortSide] };
    expect(projectSheetInterfaceDrift(["IN"], null, sides)).toEqual({ kind: "not-checked" });
    expect(projectSheetInterfaceDrift(["IN"], entryOf([], []), sides)).toEqual({ kind: "no-interface" });
    expect(projectSheetInterfaceDrift(
      ["IN"],
      entryOf(["IN"], ["In"], { status: "no-interface", ports: [] }),
      sides,
    )).toEqual({ kind: "no-interface" });
    expect(projectSheetInterfaceDrift(
      ["IN"],
      entryOf([], [], { status: "unreadable", reason: "Unexpected token } in JSON at position 42" }),
      sides,
    )).toEqual({ kind: "sheet-unreadable", reason: "Unexpected token } in JSON at position 42" });
    expect(projectSheetInterfaceDrift(
      ["IN"],
      entryOf([], [], { status: "missing" }),
      sides,
    )).toEqual({ kind: "missing-sheet" });
  });
});

describe("projectSheetInterfaceDrift agreement with the compiler's comparison (B5)", () => {
  it("is in-sync exactly when the ordered contract matches and the sides agree", () => {
    // Deterministic PRNG: a flake here would be a correctness claim we could
    // not reproduce, and this property is the whole safety argument.
    let seed = 0x2f6e2b1;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const pick = <T,>(values: readonly T[]): T => values[Math.floor(random() * values.length)]!;
    const NAMES = ["IN", "OUT", "GND", "in", "En", "VCC", "vout"];
    const DIRECTIONS: SchematicPortDirection[] = ["In", "Out", "BiDir"];
    const SIDES: PortSide[] = ["left", "right", null];

    let inSync = 0;
    for (let iteration = 0; iteration < 240; iteration += 1) {
      const linkLength = 1 + Math.floor(random() * 4);
      const sheetLength = 1 + Math.floor(random() * 4);
      const linkPorts = Array.from({ length: linkLength }, () => pick(NAMES));
      const directions = Array.from({ length: sheetLength }, () => pick(DIRECTIONS));
      const sheetNames = Array.from({ length: sheetLength }, () => pick(NAMES));
      const entry = entryOf(sheetNames, directions);
      const current = Array.from({ length: linkLength }, () => pick(SIDES));
      const expected = Array.from({ length: sheetLength }, () => pick(SIDES));

      const drift = projectSheetInterfaceDrift(linkPorts, entry, { current, expected });
      const compilerAgrees = hasMatchingOrderedProjectPorts(linkPorts, entry.ports);
      const sidesAgree = current.length === expected.length
        && current.every((side, index) => side === expected[index]);
      const detail = JSON.stringify({ linkPorts, sheetNames, current, expected, kind: drift.kind });
      expect(drift.kind === "in-sync", detail).toBe(compilerAgrees && sidesAgree);
      if (drift.kind === "in-sync") inSync += 1;
    }
    // Both arms must actually be exercised, or the IFF above is vacuous.
    expect(inSync).toBeGreaterThan(0);
    expect(inSync).toBeLessThan(240);
  });
});

describe("defaultProjectModelName (B6)", () => {
  it("derives a model name from the file stem", () => {
    expect(defaultProjectModelName("boost.sim")).toBe("Boost");
    expect(defaultProjectModelName("sheets/rc_cell.tau.json")).toBe("Rc_cell");
    expect(defaultProjectModelName("_probe.sim")).toBe("_probe");
  });

  it("returns null rather than silently sanitizing an unusable stem", () => {
    for (const fileName of ["rc-cell.sim", "2stage.sim", "boost converter.sim", ".sim", "", "π.sim"]) {
      expect(defaultProjectModelName(fileName), fileName).toBeNull();
    }
  });

  it("never returns a string that fails PROJECT_SPICE_TOKEN", () => {
    const candidates = [
      "boost.sim", "rc-cell.sim", "A.sim", "a.tau.json", "9.sim", "__.sim",
      "deep/dir/x.sim", "MiXeD.sim", "with.dots.sim", `${"z".repeat(200)}.sim`,
    ];
    for (const candidate of candidates) {
      const name = defaultProjectModelName(candidate);
      if (name !== null) expect(PROJECT_SPICE_TOKEN.test(name), `${candidate} -> ${name}`).toBe(true);
    }
  });
});

describe("projectSheetPortsValidation refusal strings are byte-identical (B7)", () => {
  /**
   * Deriving, not restating: the expected messages are read out of the
   * pre-change artefact in git (cdecde0, the commit this lane started from)
   * rather than retyped here, so this test cannot pass by agreeing with itself.
   */
  const baseline = execFileSync(
    "git",
    ["show", "cdecde0:apps/desktop/src/schematic/projectSubcircuit.ts"],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  /**
   * Only the sentences THIS function can produce, not every literal in the
   * module. Pooling the whole file let a real wording change pass by matching
   * some other function's sentence: renaming the token role from "Sheet port
   * name" to "Interface pin name" (a user-visible change) still matched
   * issueForToken's `${role} must be …` template through its wildcard. So the
   * role is now substituted from the baseline's OWN call sites inside this
   * function, and the port limit from the baseline's own constant. The only
   * remaining wildcards are holes carrying test-supplied data.
   */
  const slice = baseline.slice(baseline.indexOf("export function projectSheetPortsValidation"));
  const body = slice.slice(0, slice.indexOf("\nexport ", 1));
  const tokenTemplate = /return `(\$\{role\} must be[^`]*)`/.exec(baseline)?.[1] ?? "";
  const portLimit = /MAX_PROJECT_SUBCIRCUIT_PORTS = ([\d_]+)/.exec(baseline)?.[1]?.replace(/_/g, "") ?? "";
  const roles = [...body.matchAll(/issueForToken\([^,]+, "([^"]+)"\)/g)].map((match) => match[1]!);
  const baselineSentences = [
    ...[...body.matchAll(/(?:`([^`]*)`|"([^"]*)")/g)]
      .map((match) => match[1] ?? match[2]!)
      .filter((literal) => literal.endsWith(".") && literal.includes(" ") && literal.length >= 20),
    ...roles.map((role) => tokenTemplate.replace("${role}", role)),
  ].map((literal) => literal.replace(/\$\{MAX_PROJECT_SUBCIRCUIT_PORTS\}/g, portLimit));
  const baselinePatterns = baselineSentences.map((literal) => new RegExp(`^${literal
    .split(/\$\{[^}]*\}/)
    .map((chunk) => chunk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".+")}$`));

  const refusals: readonly unknown[] = [
    "not-an-array",
    Array.from({ length: 65 }, (_, index) => ({ name: `P${index}`, labelId: `l${index}`, direction: "In" })),
    [null],
    [{ name: "1bad", labelId: "l1", direction: "In" }],
    [{ name: "OK", labelId: "", direction: "In" }],
    [{ name: "OK", labelId: "l1", direction: "Sideways" }],
    [{ name: "OK", labelId: "l1", direction: "In" }, { name: "ok", labelId: "l2", direction: "In" }],
    [{ name: "A", labelId: "l1", direction: "In" }, { name: "B", labelId: "l1", direction: "In" }],
  ];

  it("still refuses each authoring mistake with a message from the baseline", () => {
    expect(baselinePatterns.length).toBeGreaterThan(4);
    // The derivation itself must be load-bearing: if the extraction silently
    // stopped finding the role or the limit, every pattern below would widen
    // into a wildcard and the test would pass vacuously.
    expect(roles).toContain("Sheet port name");
    expect(portLimit).toBe(String(MAX_PROJECT_SUBCIRCUIT_PORTS));
    for (const ports of refusals) {
      const result = projectSheetPortsValidation(ports as never);
      expect(result.ok, JSON.stringify(ports)?.slice(0, 60)).toBe(false);
      expect(baselinePatterns.some((pattern) => pattern.test(result.error!)), result.error).toBe(true);
    }
  });

  it("still accepts a valid ordered interface and folds only ASCII case", () => {
    expect(projectSheetPortsValidation([
      { name: "IN", labelId: "a", direction: "In" },
      { name: "OUT", labelId: "b", direction: "Out" },
    ])).toEqual({ ok: true });
    expect(asciiFold("İ")).toBe("İ");
  });
});
