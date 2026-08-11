import { describe, expect, it } from "vitest";

import { LIVE_SCOPE_NAMES } from "./LiveScopePane";
import { RUN_TRANSPORT_NAMES } from "./RunTransport";
import { SHELL, SHELL_CONTROLS, SHELL_GROUPS } from "./shellContract";

/**
 * `shellContract.ts` is the one place a rename has to be visible, but the
 * components own the strings they actually render. Both cannot be the source of
 * truth, so these assertions are the join: the contract records the names, the
 * components set them, and a rename in either place fails here instead of
 * silently making a `getByRole` query — or a screenshot script — look for a
 * surface that no longer answers to that word.
 */
describe("shellContract - the live run's names", () => {
  it("records exactly the names RunTransport and LiveScopePane render", () => {
    expect(SHELL_GROUPS.runTransport).toBe(RUN_TRANSPORT_NAMES.group);
    expect(SHELL_GROUPS.liveScope).toBe(LIVE_SCOPE_NAMES.pane);
    expect(SHELL_CONTROLS.liveRun).toBe(RUN_TRANSPORT_NAMES.run);
    expect(SHELL_CONTROLS.liveStop).toBe(RUN_TRANSPORT_NAMES.stop);
    expect(SHELL_CONTROLS.runMode).toBe(RUN_TRANSPORT_NAMES.modeGroup);
    expect(SHELL_CONTROLS.scopeResumeFollow).toBe(LIVE_SCOPE_NAMES.resumeFollow);
  });

  /**
   * "Live", "Run" and "Stop" are all overloaded in this app. The transport sits
   * inside the circuit overview and the scope inside the results drawer, both
   * of which are already landmarks, and the canvas's hand-operable switches are
   * already "Live controls" — so a collision here would make two different
   * things answer to one name for anyone driving the UI by name.
   */
  it("keeps every live name distinct from the landmark inventory", () => {
    const landmarks = Object.values(SHELL).map((surface) => surface.name);
    // The components, not `SHELL_GROUPS`: those two entries are aliases of the
    // same strings by design (the case above pins that), so counting them here
    // would report a collision that is really the contract doing its job.
    const live = [...Object.values(RUN_TRANSPORT_NAMES), ...Object.values(LIVE_SCOPE_NAMES)];
    for (const name of [...live, ...Object.values(SHELL_GROUPS)]) {
      expect(landmarks).not.toContain(name);
    }
    expect(new Set(live).size).toBe(live.length);
  });
});
