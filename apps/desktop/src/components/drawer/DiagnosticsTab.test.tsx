// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BottomPanel, diagnosticMessageKey } from "./DiagnosticsTab";
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
