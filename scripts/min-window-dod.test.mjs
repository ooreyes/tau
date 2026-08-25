import test from "node:test";
import assert from "node:assert/strict";
import { isRestingSchematicScenario } from "./min-window-dod.mjs";

test("minimum-window status-bar waiver is limited to resting schematic captures", () => {
  for (const label of ["empty-light", "schematic-dark", "schematic-panels-light", "hierarchy-guide-dark"]) {
    assert.equal(isRestingSchematicScenario(label), true, label);
  }
  for (const label of ["simulator-light", "dialog-dark", "command-light", "tool-feedback-dark"]) {
    assert.equal(isRestingSchematicScenario(label), false, label);
  }
});
