import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildSpiceDeck } from "../src/engine/spiceNetlist";
import { resolveLiveInstance } from "../src/engine/nativeLive";
import { parseTranDirective } from "../src/io/directiveAnalysis";
import { planLiveActuation, type ActuableComponent } from "../src/simulation/liveActuation";
import { actuatedValue } from "../src/schematic/actuation";
import type { SchematicDocument } from "../src/store/useSchematic";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURE_ROOT = join(REPO_ROOT, "fixtures", "packaged-qa");

function loadFixture(name: string): SchematicDocument {
  const path = join(FIXTURE_ROOT, name, `${name}.sim`);
  return JSON.parse(readFileSync(path, "utf8")) as SchematicDocument;
}

function transientDeck(document: SchematicDocument) {
  const tran = (document.directives ?? [])
    .map((directive) => parseTranDirective(directive))
    .find((parsed) => parsed !== null);
  expect(tran, "fixture must carry an authored .tran directive").not.toBeNull();
  const { userModelLibraries, ...baseDocument } = document;
  const deck = buildSpiceDeck({
    ...baseDocument,
    ...(userModelLibraries
      ? {
          userModelLibraries: userModelLibraries.map((library) => library.text),
          userModelLibraryNames: userModelLibraries.map((library) => library.name),
        }
      : {}),
  }, {
    kind: "tran",
    stopTime: tran!.stopTime,
    steps: tran!.steps,
  });
  expect(deck.modelSubstitutions, "named models must never be silently substituted").toEqual([]);
  expect(deck.unresolvedSubckts, "fixture must not contain unresolved X instances").toEqual([]);
  expect(deck.circuit.warnings, "fixture must be warning-clean").toEqual([]);
  expect(deck.netlist).toContain(".tran");
  return deck;
}

function component(document: SchematicDocument, label: string): ActuableComponent {
  const found = document.components.find((candidate) => candidate.label === label);
  if (!found) throw new Error(`fixture is missing ${label}`);
  return found;
}

describe("packaged Live QA fixtures", () => {
  it("opens the switched divider, emits its static resistor, and plans the exact alter", () => {
    const document = loadFixture("live-switched-divider");
    const deck = transientDeck(document);
    const switchPart = component(document, "SW_DIV");

    // This is the real static-contact output, not a voltage-controlled S model.
    expect(deck.netlist).toMatch(/^R_SW_DIV \S+ \S+ 1e12$/m);
    const outputNet = deck.circuit.nets.find((net) => {
      const labels = net.pins.map((pin) => pin.componentLabel);
      return labels.includes("SW_DIV") && labels.includes("R_LOAD");
    });
    expect(outputNet?.pins.map((pin) => pin.componentLabel).sort()).toEqual(["R_LOAD", "SW_DIV"]);
    expect(resolveLiveInstance(deck, "R_SW_DIV")).not.toBeNull();

    const nextValue = actuatedValue(switchPart, "press");
    expect(nextValue).toBe("closed");
    const target = planLiveActuation(deck, switchPart, nextValue!);
    expect(target).toMatchObject({
      kind: "alter",
      plan: {
        name: "SW_DIV",
        form: "contact",
        nextValue: "closed",
        steps: [{ instance: "R_SW_DIV", value: "1m", role: "contact" }],
      },
    });
    expect(target.kind === "alter" ? deck.netlist : "").toMatch(/^R_SW_DIV \S+ \S+ 1e12$/m);
    expect(target.kind === "alter" ? target.plan.steps[0]?.instance : null).toBe("R_SW_DIV");
  });

  it("opens the digital path, emits a real gate, and plans the exact logic alter", () => {
    const document = loadFixture("live-digital-path");
    const deck = transientDeck(document);
    const logicPart = component(document, "LOGIC_IN");

    expect(deck.netlist).toMatch(/^VLOGIC_IN \S+ \S+ DC 0$/m);
    expect(resolveLiveInstance(deck, "VLOGIC_IN")).not.toBeNull();
    expect(deck.netlist).toMatch(/^B_BUF_OUT_Q /m);
    expect(deck.netlist).toContain("logic_out");
    const outputNet = deck.circuit.nets.find((net) => {
      const labels = net.pins.map((pin) => pin.componentLabel);
      return labels.includes("BUF_OUT") && labels.includes("R_LOGIC_LOAD");
    });
    expect(outputNet?.pins.map((pin) => pin.componentLabel).sort()).toEqual(["BUF_OUT", "R_LOGIC_LOAD"]);

    const nextValue = actuatedValue(logicPart, "press");
    expect(nextValue).toBe("1");
    const target = planLiveActuation(deck, logicPart, nextValue!);
    expect(target).toMatchObject({
      kind: "alter",
      plan: {
        name: "LOGIC_IN",
        form: "binary",
        nextValue: "1",
        steps: [{ instance: "VLOGIC_IN", value: "1", role: "binary" }],
      },
    });
    expect(target.kind === "alter" ? target.plan.steps[0]?.instance : null).toBe("VLOGIC_IN");
  });
});
