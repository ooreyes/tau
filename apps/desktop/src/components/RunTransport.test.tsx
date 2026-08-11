// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_WINDOW_SECONDS, RUN_TRANSPORT_NAMES, RunTransport } from "./RunTransport";
import {
  STOP_REASON_KINDS,
  describeStopReason,
  liveRunPlan,
  rateReport,
  windowPlanFromAuthoredTran,
  withWindowBounds,
  type LiveRunStatus,
  type RunPlan,
  type StopReason,
  type StopReasonKind,
  type WindowRunPlan,
} from "../simulation/liveRun";

afterEach(cleanup);

/** Every callback, so a test can assert the ones it does not drive stayed silent. */
function handlers() {
  return { onPlanChange: vi.fn(), onRun: vi.fn(), onStop: vi.fn() };
}

/** The most recent plan the component reported. */
function lastPlan(onPlanChange: ReturnType<typeof vi.fn>): WindowRunPlan {
  const calls = onPlanChange.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0] as WindowRunPlan;
}

const runButton = () => screen.getByRole("button", { name: RUN_TRANSPORT_NAMES.run });
const stopButton = () => screen.getByRole("button", { name: RUN_TRANSPORT_NAMES.stop });
const liveRadio = () => screen.getByRole("radio", { name: RUN_TRANSPORT_NAMES.modeLive });
const windowRadio = () => screen.getByRole("radio", { name: RUN_TRANSPORT_NAMES.modeWindow });
const stopField = () =>
  screen.getByLabelText(RUN_TRANSPORT_NAMES.windowStop) as HTMLInputElement;

/**
 * Every stop reason this component is proved to render, as ONE table.
 *
 * The coverage guard at the bottom derives its expectation from this array
 * rather than re-typing the kinds: a second hand-written list agrees with the
 * model just as happily while the render table quietly misses a kind, which is
 * the exact hole the guard exists to close.
 */
const STOP_REASON_CASES: [StopReasonKind, StopReason][] = [
  ["user-stopped", { kind: "user-stopped" }],
  ["left-simulator", { kind: "left-simulator" }],
  ["sample-budget", { kind: "sample-budget", atCircuitTime: 2.5, budget: 2_000_000 }],
  ["horizon-reached", { kind: "horizon-reached", atCircuitTime: 5e-3 }],
  ["diverged", { kind: "diverged", atCircuitTime: 1e-4, detail: "timestep too small" }],
  ["circuit-edited", { kind: "circuit-edited" }],
];

/** A run in flight, with whatever the rate estimator currently knows. */
function running(solvedCircuitTime: number, achieved: number | null, target: number | null = null): LiveRunStatus {
  return { phase: "running", solvedCircuitTime, rate: rateReport(target, achieved) };
}

describe("RunTransport", () => {
  it("defaults to a continuous live run with no time bound to configure", () => {
    render(<RunTransport {...handlers()} />);

    expect(liveRadio().getAttribute("aria-checked")).toBe("true");
    expect(windowRadio().getAttribute("aria-checked")).toBe("false");
    // No duration field at all in LIVE: a bound the user cannot see is exactly
    // what this control exists to remove.
    expect(screen.queryByLabelText(RUN_TRANSPORT_NAMES.windowStop)).toBeNull();
    expect(
      screen.getByText("Runs continuously, like a circuit on the bench, until you stop it."),
    ).toBeTruthy();
  });

  it("starts a run through Run and stops the same control once it is in flight", () => {
    const h = handlers();
    const { rerender } = render(<RunTransport {...h} />);

    fireEvent.click(runButton());
    expect(h.onRun).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: RUN_TRANSPORT_NAMES.stop })).toBeNull();

    rerender(<RunTransport {...h} status={running(0.002, null)} />);

    // One control that changed identity, not two controls side by side.
    expect(screen.queryByRole("button", { name: RUN_TRANSPORT_NAMES.run })).toBeNull();
    fireEvent.click(stopButton());
    expect(h.onStop).toHaveBeenCalledTimes(1);
    expect(h.onRun).toHaveBeenCalledTimes(1);
  });

  it("stops a bounded run through the same control a live run stops through", () => {
    const h = handlers();
    render(
      <RunTransport
        {...h}
        plan={windowPlanFromAuthoredTran({ stopTime: 5e-3 }, { directive: ".tran 5m" })}
        status={running(1e-3, 0.5, 1)}
      />,
    );

    fireEvent.click(stopButton());
    expect(h.onStop).toHaveBeenCalledTimes(1);
  });

  it("refuses to start when the caller says the circuit cannot run, but never refuses to stop", () => {
    const h = handlers();
    const { rerender } = render(<RunTransport {...h} disabled />);
    expect((runButton() as HTMLButtonElement).disabled).toBe(true);

    rerender(<RunTransport {...h} disabled status={running(1, null)} />);
    expect((stopButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("switches to a bounded window and reports each edited duration in seconds", () => {
    const h = handlers();
    const { rerender } = render(<RunTransport {...h} />);

    fireEvent.click(windowRadio());
    const chosen = h.onPlanChange.mock.calls[0]![0] as RunPlan;
    expect(chosen.mode).toBe("window");
    expect((chosen as WindowRunPlan).stopTime).toBe(DEFAULT_WINDOW_SECONDS);
    // A window the user chose has no authored provenance to restore.
    expect((chosen as WindowRunPlan).origin).toEqual({ source: "user", authored: null });

    rerender(<RunTransport {...h} plan={chosen} />);
    expect(windowRadio().getAttribute("aria-checked")).toBe("true");
    // 1 ms reads in the decade it was written in, not as 0.001.
    expect(stopField().value).toBe("1");
    expect(screen.getByText("Runs to t = 1 ms, then stops.")).toBeTruthy();

    fireEvent.change(stopField(), { target: { value: "100" } });
    const hundredMilli = lastPlan(h.onPlanChange);
    expect(hundredMilli.stopTime).toBeCloseTo(0.1, 12);

    // "1s" and "1" mean the same second, because the SI prefix is its own
    // control — this is EngineeringInput's parsing, not a hand-rolled field.
    rerender(<RunTransport {...h} plan={hundredMilli} />);
    expect(stopField().value).toBe("100");
    fireEvent.change(stopField(), { target: { value: "1" } });
    expect(lastPlan(h.onPlanChange).stopTime).toBeCloseTo(1e-3, 15);
  });

  it("keeps the SI prefix picker rather than hand-rolling a number field", () => {
    render(<RunTransport {...handlers()} plan={windowPlanFromAuthoredTran({ stopTime: 1 })} />);
    const prefix = screen.getByRole("combobox", {
      name: `${RUN_TRANSPORT_NAMES.windowStop} SI prefix`,
    });
    expect(prefix.getAttribute("data-slot")).toBe("select-trigger");
    expect(prefix.textContent).toContain("s");
  });

  it("returns to the caller's remembered window instead of inventing a new one", () => {
    const h = handlers();
    const remembered = withWindowBounds(
      windowPlanFromAuthoredTran({ stopTime: 5e-3 }, { directive: ".tran 5m" }),
      { stopTime: 0.25 },
    );
    render(<RunTransport {...h} windowPlan={remembered} />);

    fireEvent.click(windowRadio());
    expect(h.onPlanChange).toHaveBeenCalledWith(remembered);
  });

  it("goes back to live, and ignores a click on the mode already selected", () => {
    const h = handlers();
    const live = liveRunPlan({ targetRate: 0.5 });
    const { rerender } = render(
      <RunTransport {...h} plan={windowPlanFromAuthoredTran({ stopTime: 1 })} livePlan={live} />,
    );

    fireEvent.click(liveRadio());
    expect(h.onPlanChange).toHaveBeenCalledWith(live);

    rerender(<RunTransport {...h} plan={live} livePlan={live} />);
    fireEvent.click(liveRadio());
    expect(h.onPlanChange).toHaveBeenCalledTimes(1);
  });

  it("shows an authored .tran as the visible source of a pre-selected window", () => {
    render(
      <RunTransport
        {...handlers()}
        plan={windowPlanFromAuthoredTran({ stopTime: 5e-3 }, { directive: ".tran 5m" })}
      />,
    );

    expect(windowRadio().getAttribute("aria-checked")).toBe("true");
    expect(stopField().value).toBe("5");
    expect(screen.getByText("From this file's .tran 5m.")).toBeTruthy();
    // Nothing to restore until it has actually been changed.
    expect(screen.queryByRole("button", { name: RUN_TRANSPORT_NAMES.restoreAuthored })).toBeNull();
  });

  it("says the window has diverged from the file and puts it back on request", () => {
    const h = handlers();
    const authored = windowPlanFromAuthoredTran({ stopTime: 5e-3 }, { directive: ".tran 5m" });
    const edited = withWindowBounds(authored, { stopTime: 0.1 });
    render(<RunTransport {...h} plan={edited} />);

    expect(screen.getByText("Edited — this file asked for .tran 5m.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: RUN_TRANSPORT_NAMES.restoreAuthored }));

    const restored = h.onPlanChange.mock.calls[0]![0] as WindowRunPlan;
    expect(restored.stopTime).toBe(5e-3);
    expect(restored.origin.source).toBe("authored-tran");
  });

  it("surfaces an authored Tstart as an editable bound rather than applying it invisibly", () => {
    const h = handlers();
    render(
      <RunTransport
        {...h}
        plan={windowPlanFromAuthoredTran(
          { startTime: 1e-3, stopTime: 5e-3 },
          { directive: ".tran 0 5m 1m" },
        )}
      />,
    );

    const start = screen.getByLabelText(RUN_TRANSPORT_NAMES.windowStart) as HTMLInputElement;
    expect(start.value).toBe("1");
    fireEvent.change(start, { target: { value: "2" } });
    expect(lastPlan(h.onPlanChange).startTime).toBeCloseTo(2e-3, 15);
  });

  it("hides the start bound for a plain window so the common case is one number", () => {
    render(<RunTransport {...handlers()} plan={windowPlanFromAuthoredTran({ stopTime: 1 })} />);
    expect(screen.queryByLabelText(RUN_TRANSPORT_NAMES.windowStart)).toBeNull();
  });

  it("calls out a window that ends before it starts instead of running an empty plot", () => {
    const backwards = withWindowBounds(windowPlanFromAuthoredTran({ startTime: 1e-3, stopTime: 5e-3 }), {
      stopTime: 5e-4,
    });
    render(<RunTransport {...handlers()} plan={backwards} />);
    expect(screen.getByRole("alert").textContent).toContain("nothing to solve");
  });

  it.each([
    ["ends before it starts", 5e-4],
    ["ends exactly where it starts", 1e-3],
  ])("refuses to arm Run on a window that %s", (_case, stopTime) => {
    // Saying "there is nothing to solve" and leaving Run armed is worse than
    // either one alone: the component has already diagnosed the window, so the
    // user is invited to press a button whose only outcome is the empty plot
    // the message exists to spare them.
    const h = handlers();
    const backwards = withWindowBounds(windowPlanFromAuthoredTran({ startTime: 1e-3, stopTime: 5e-3 }), {
      stopTime,
    });
    const { rerender } = render(<RunTransport {...h} plan={backwards} />);

    expect((runButton() as HTMLButtonElement).disabled).toBe(true);
    // ...and nothing promises a stop time for a run that cannot happen.
    expect(screen.queryByText(/Runs to t =/)).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("nothing to solve");

    // `disabled` means "blocks Run"; a run in flight is still stoppable however
    // the window reads, and an unsolvable window is not a way to trap the user
    // in a running solver.
    rerender(<RunTransport {...h} plan={backwards} status={running(1, null)} />);
    expect((stopButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps Run armed the moment the window becomes solvable again", () => {
    // The refusal above must be about this window and not a latch: the
    // component holds no state, and the horizon comes back with the window.
    const h = handlers();
    const solvable = withWindowBounds(windowPlanFromAuthoredTran({ startTime: 1e-3, stopTime: 5e-3 }), {
      stopTime: 2e-3,
    });
    render(<RunTransport {...h} plan={solvable} />);

    expect((runButton() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Runs to t = 2 ms, then stops.")).toBeTruthy();
    fireEvent.click(runButton());
    expect(h.onRun).toHaveBeenCalledTimes(1);
  });

  it("locks the mode and the bounds while a run is in flight", () => {
    render(
      <RunTransport
        {...handlers()}
        plan={windowPlanFromAuthoredTran({ stopTime: 1 })}
        status={running(0.4, 1)}
      />,
    );

    expect((liveRadio() as HTMLButtonElement).disabled).toBe(true);
    expect((windowRadio() as HTMLButtonElement).disabled).toBe(true);
    // `:disabled`, not `.disabled`: the bounds are disabled by their ancestor
    // <fieldset disabled>, which is the platform's own propagation and does
    // not write the content attribute onto each control. That is the point of
    // using a fieldset — a field added later cannot forget to opt in.
    expect(stopField().matches(":disabled")).toBe(true);
    expect(
      screen
        .getByRole("combobox", { name: `${RUN_TRANSPORT_NAMES.windowStop} SI prefix` })
        .matches(":disabled"),
    ).toBe(true);
  });

  it("admits it has no rate yet rather than echoing the requested one", () => {
    render(<RunTransport {...handlers()} status={running(0.5, null, 2)} />);

    expect(screen.getByText("measuring…")).toBeTruthy();
    expect(screen.queryByText(/2× circuit s per s/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("prints the measured rate, and warns only when the model says the solver is short", () => {
    const h = handlers();
    // Comfortably on pace: the measurement shows, no warning.
    const { rerender } = render(<RunTransport {...h} status={running(0.5, 0.99, 1)} />);
    expect(screen.getByText("0.99× circuit s per s")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();

    // Free-run has nothing to fall short of, however slow it is.
    rerender(<RunTransport {...h} status={running(0.5, 0.01, null)} />);
    expect(screen.getByText("0.01× circuit s per s")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();

    // Behind the requested rate by more than the model's tolerance.
    rerender(<RunTransport {...h} status={running(0.5, 0.4, 1)} />);
    expect(screen.getByText("0.4× circuit s per s")).toBeTruthy();
    const warning = screen.getByRole("alert");
    expect(warning.textContent).toContain("Solver cannot keep up");
    expect(warning.textContent).toContain("0.4× against the 1× requested");
  });

  it.each(STOP_REASON_CASES)("renders the %s stop distinguishably, and offers Run again", (kind, reason) => {
    render(
      <RunTransport {...handlers()} status={{ phase: "stopped", solvedCircuitTime: 1, reason }} />,
    );

    // The label is what the guard below counts, so a case filed under a kind it
    // does not actually render would make that guard lie.
    expect(reason.kind).toBe(kind);
    expect(describeStopReason(reason).trim()).not.toBe("");
    expect(screen.getByText(describeStopReason(reason))).toBeTruthy();
    // A stopped run does not look like a running one: the control is Run again.
    expect(runButton()).toBeTruthy();
    expect(screen.queryByRole("button", { name: RUN_TRANSPORT_NAMES.stop })).toBeNull();
    // ...and no live telemetry lingers from the run that ended.
    expect(screen.queryByText("Measured rate")).toBeNull();
  });

  it("covers every stop reason the model can produce", () => {
    // Guards the table above by reading it: a new StopReason kind must fail
    // here rather than silently render as a blank status line, and so must a
    // kind that is in the model and in nobody's render case.
    const rendered = STOP_REASON_CASES.map(([kind]) => kind);
    expect(new Set(rendered)).toEqual(new Set(STOP_REASON_KINDS));
    // A duplicated row would let the set match while a kind went unrendered.
    expect(rendered).toHaveLength(STOP_REASON_KINDS.length);
  });

  it("names its controls so none of them collide with a name the shell already uses", () => {
    // The window with a Tstart, so BOTH engineering fields are mounted and the
    // SI-prefix comboboxes `EngineeringInput` derives (`<label> SI prefix`) are
    // in the collision check rather than only the names this file declares.
    const { rerender } = render(
      <RunTransport
        {...handlers()}
        plan={windowPlanFromAuthoredTran({ startTime: 1e-3, stopTime: 5e-3 }, { directive: ".tran 0 5m 1m" })}
      />,
    );

    // "Run simulation" / "Stop simulation" / "Stop" belong to the editor
    // toolbar, the results drawer, the simulation panel and the assistant.
    // "Live controls" is SHELL.liveControls, the canvas switches.
    const taken = ["Run simulation", "Stop simulation", "Stop", "Run", "Live controls", "Live"];
    const collidable = ["button", "radio", "group", "radiogroup", "combobox", "textbox"] as const;
    for (const name of taken) {
      for (const role of collidable) {
        expect(screen.queryAllByRole(role, { name })).toEqual([]);
      }
      // Nothing reaches these names by any other labelling route either.
      expect(screen.queryAllByLabelText(name)).toEqual([]);
    }
    // The Stop control is only mounted while a run is in flight, so it is
    // checked in the state that has it.
    rerender(
      <RunTransport
        {...handlers()}
        plan={windowPlanFromAuthoredTran({ startTime: 1e-3, stopTime: 5e-3 })}
        status={running(1e-3, 0.5, 1)}
      />,
    );
    for (const name of taken) {
      for (const role of collidable) {
        expect(screen.queryAllByRole(role, { name })).toEqual([]);
      }
    }
    rerender(
      <RunTransport {...handlers()} plan={windowPlanFromAuthoredTran({ stopTime: 1 })} />,
    );
    expect(screen.getByRole("group", { name: RUN_TRANSPORT_NAMES.group })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: RUN_TRANSPORT_NAMES.modeGroup })).toBeTruthy();
    // The visible words stay the user's words even though the names qualify them.
    expect(runButton().textContent).toContain("Run");
    expect(liveRadio().textContent).toBe("Live");
    expect(windowRadio().textContent).toBe("Window");
  });
});
