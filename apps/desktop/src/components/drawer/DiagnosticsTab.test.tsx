// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BottomPanel,
  diagnosticMessageKey,
  diagnosticNextStep,
  diagnosticSituationTitle,
  mergeDiagnostics,
} from "./DiagnosticsTab";
import type { LiveDiagnostic } from "../../schematic/documentValidation";

afterEach(() => cleanup());

const componentIssue = (): LiveDiagnostic => ({
  id: "bad-parameter:r1:0",
  code: "bad-parameter",
  severity: "error",
  message: "R1: Resistance: Enter a finite Ω.",
  componentId: "r1",
  reference: "R1",
  focus: { kind: "component", componentId: "r1", reference: "R1" },
});

describe("BottomPanel diagnostics focus seam (P4-17)", () => {
  it("lists a pre-run component error with a named focus action", () => {
    const onFocusDiagnostic = vi.fn();
    render(
      <BottomPanel
        result={null}
        issues={[componentIssue()]}
        onFocusDiagnostic={onFocusDiagnostic}
      />,
    );

    const focus = screen.getByRole("button", {
      name: "Focus R1: R1: Resistance: Enter a finite Ω.",
    });
    fireEvent.click(focus);
    expect(onFocusDiagnostic).toHaveBeenCalledWith({
      kind: "component", componentId: "r1", reference: "R1",
    });
  });

  it("uses the same focus callback for a net-owned warning", () => {
    const onFocusDiagnostic = vi.fn();
    const netIssue: LiveDiagnostic = {
      id: "label-names-nothing::0",
      code: "label-names-nothing",
      severity: "warning",
      message: 'Net label "OUT" names nothing: it is not on a wire or a pin.',
      net: { id: "N003", x: 160, y: 96, label: "OUT" },
      focus: { kind: "net", netId: "N003", x: 160, y: 96, label: "OUT" },
    };
    render(<BottomPanel result={null} issues={[netIssue]} onFocusDiagnostic={onFocusDiagnostic} />);

    fireEvent.click(screen.getByRole("button", {
      name: 'Focus net OUT: Net label "OUT" names nothing: it is not on a wire or a pin.',
    }));
    expect(onFocusDiagnostic).toHaveBeenCalledWith(netIssue.focus);
  });

  it("keeps the structured focus action when engine wording duplicates a live row", () => {
    const message = "R1 is only connected to one pin.";
    const onFocusDiagnostic = vi.fn();
    render(
      <BottomPanel
        result={{ ok: true, title: "Operating point", warnings: [message] } as never}
        issues={[{ ...componentIssue(), id: "floating-pin:r1:0", code: "floating-pin", severity: "warning", message }]}
        onFocusDiagnostic={onFocusDiagnostic}
      />,
    );

    expect(screen.getAllByText(message)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: `Focus R1: ${message}` }));
    expect(onFocusDiagnostic).toHaveBeenCalledWith({ kind: "component", componentId: "r1", reference: "R1" });
  });

  it("normalizes whitespace and case for engine/live deduplication", () => {
    expect(diagnosticMessageKey("  Floating   node N1 ")).toBe("floating node n1");
  });
});

/**
 * PDF-6 item 6: the `!` rail button is the authoritative toggle, and the panel
 * must accept that authority without losing the uncontrolled behaviour the
 * results drawer and `ShellPanels.test.tsx` still depend on.
 */
const failedRun = {
  ok: false,
  title: "Transient",
  message: "singular matrix at t=0",
  warnings: ["R2 shorted by wire"],
} as never;

const okRunWithWarnings = {
  ok: true,
  title: "Transient",
  warnings: ["R2 shorted by wire", "C1 has no DC path to ground"],
} as never;

describe("BottomPanel controlled disclosure (PDF-6 item 6)", () => {
  it("shows nothing until `open` says so, and hides again when it flips back", () => {
    const { rerender } = render(<BottomPanel result={failedRun} open={false} />);
    expect(screen.queryByText("singular matrix at t=0")).toBeNull();
    expect(screen.getByRole("button", { name: /^Errors/ }).getAttribute("aria-expanded"))
      .toBe("false");

    rerender(<BottomPanel result={failedRun} open />);
    expect(screen.getByText("singular matrix at t=0")).toBeTruthy();

    rerender(<BottomPanel result={failedRun} open={false} />);
    expect(screen.queryByText("singular matrix at t=0")).toBeNull();
  });

  it("reports the header toggle upward instead of opening itself", () => {
    const onOpenChange = vi.fn();
    render(<BottomPanel result={failedRun} open={false} onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: /^Errors/ }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    // Still shut: the shell owns the state, so a controlled panel must not open
    // on its own or the rail button would look un-pressed while the body showed.
    expect(screen.queryByText("singular matrix at t=0")).toBeNull();
  });

  it("does not overwrite the shell's `open` when a new diagnosis arrives", () => {
    const { rerender } = render(<BottomPanel result={failedRun} open={false} />);
    rerender(
      <BottomPanel result={{ ...(failedRun as object), message: "timestep too small" } as never} open={false} />,
    );
    expect(screen.queryByText("timestep too small")).toBeNull();
  });

  it("keeps its own auto-open behaviour when neither prop is passed", () => {
    render(<BottomPanel result={failedRun} />);
    const toggle = screen.getByRole("button", { name: /^Errors/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("BottomPanel as a problem list (PDF-5 item 17)", () => {
  it("uses a specific situation title, icon semantics, and expandable technical detail", () => {
    const row = mergeDiagnostics(failedRun).rows[0];
    expect(diagnosticSituationTitle(row)).toBe("The solver could not complete the analysis");
    expect(diagnosticNextStep(row)).toContain("run again");

    render(<BottomPanel result={failedRun} />);
    expect(screen.getByText("The solver could not complete the analysis")).toBeTruthy();
    expect(screen.getAllByText("Technical details")).toHaveLength(2);
    expect(document.querySelector(".lucide-circle-alert")).toBeTruthy();
  });

  it("orders errors before warnings whatever order they were produced in", () => {
    // The warning is produced first here (a live row precedes the run's failure
    // in nothing but wall-clock terms), so a list that simply concatenated its
    // inputs would put it on top.
    const merged = mergeDiagnostics(failedRun, ["Opened with 1 warning"], [
      { id: "no-ground::0", code: "no-ground", severity: "error", message: "This circuit has no ground." },
      { id: "floating-pin:r9:0", code: "floating-pin", severity: "warning", message: "R9 is only connected to one pin." },
    ] as LiveDiagnostic[]);

    expect(merged.rows.map((row) => row.severity)).toEqual([
      "error", "error", "warning", "warning", "warning",
    ]);
    expect(merged.rows[0].message).toBe("singular matrix at t=0");
    expect(merged.errorCount).toBe(2);
    expect(merged.warningCount).toBe(3);
    // The pre-existing contract: `count` is still the total, so App's badge
    // arithmetic keeps working unchanged.
    expect(merged.count).toBe(5);
  });

  it("labels each row with its severity in words and says where it is", () => {
    render(
      <BottomPanel
        result={failedRun}
        issues={[componentIssue()]}
        onFocusDiagnostic={vi.fn()}
      />,
    );
    // Two errors (the run's failure and the bad parameter) and one warning.
    expect(screen.getAllByText("Error")).toHaveLength(2);
    expect(screen.getAllByText("Warning")).toHaveLength(1);
    // The part for a live row, the reporting stage for the engine's own prose.
    expect(screen.getByText("R1")).toBeTruthy();
    expect(screen.getAllByText("Run").length).toBeGreaterThan(0);
  });

  it("announces only the run's own failure, not the live linter's rows", () => {
    render(<BottomPanel result={failedRun} issues={[componentIssue()]} />);
    // Two error rows on screen, exactly one of which interrupts a screen reader:
    // the linter re-runs on every keystroke and an alert per keystroke is hostile.
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert").textContent).toContain("singular matrix at t=0");
  });
});

describe("BottomPanel under the errors-only severity policy", () => {
  it("drops warning rows from the list and from the count", () => {
    render(<BottomPanel result={failedRun} severityPolicy="errors-only" />);
    expect(screen.getByText("singular matrix at t=0")).toBeTruthy();
    expect(screen.queryByText("R2 shorted by wire")).toBeNull();
    expect(document.querySelector(".bottom-panel-count")!.textContent).toBe("1");
    expect(screen.getByText("1 warning hidden")).toBeTruthy();
  });

  it("still lists every row under the default policy", () => {
    render(<BottomPanel result={failedRun} severityPolicy="all" />);
    expect(screen.getByText("R2 shorted by wire")).toBeTruthy();
    expect(document.querySelector(".bottom-panel-count")!.textContent).toBe("2");
    expect(screen.queryByText(/warning hidden/)).toBeNull();
  });

  it("goes green over a warning-only run, and says what it is hiding", () => {
    const { container } = render(
      <BottomPanel result={okRunWithWarnings} severityPolicy="errors-only" />,
    );
    expect(container.querySelector(".bottom-panel.is-clean")).toBeTruthy();
    expect(container.querySelector(".bottom-panel.has-warning")).toBeNull();
    expect(container.querySelector(".bottom-panel.has-error")).toBeNull();
    // Green, but never silently: "No issues" would be a lie here.
    expect(screen.getByRole("status").textContent).toBe("No errors · 2 warnings hidden");
  });

  it("is yellow over the same run under the default policy", () => {
    const { container } = render(<BottomPanel result={okRunWithWarnings} severityPolicy="all" />);
    expect(container.querySelector(".bottom-panel.has-warning")).toBeTruthy();
    expect(container.querySelector(".bottom-panel.is-clean")).toBeNull();
  });
});
