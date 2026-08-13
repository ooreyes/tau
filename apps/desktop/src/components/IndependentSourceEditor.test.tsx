// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IndependentSourceEditor } from "./IndependentSourceEditor";
import { sourceValueLabel } from "./Canvas.geometry";
import { componentDisplayName } from "../schematic/componentNames";
import { buildSpiceDeck } from "../engine/spiceNetlist";
import { schematicToAsc } from "../io/ascExport";
import { ascToSchematic, parseAsc } from "../io/ascImport";

Element.prototype.hasPointerCapture = () => false;
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};
Element.prototype.scrollIntoView = () => {};

afterEach(cleanup);

function renderSource(value: string, legacyKind?: "vac" | "iac" | "vpulse") {
  const onValueChange = vi.fn();
  const onBeginChange = vi.fn();
  render(
    <IndependentSourceEditor
      value={value}
      unit={legacyKind === "iac" ? "A" : "V"}
      legacyKind={legacyKind}
      onBeginChange={onBeginChange}
      onValueChange={onValueChange}
    />,
  );
  return { onBeginChange, onValueChange };
}

describe("IndependentSourceEditor validation", () => {
  it("keeps an invalid unitless duty draft visible and does not mutate the source", () => {
    const { onBeginChange, onValueChange } = renderSource("0 5 100k 0.5", "vpulse");
    const duty = screen.getByLabelText("Duty (0–1)") as HTMLInputElement;

    fireEvent.change(duty, { target: { value: "2" } });

    expect(duty.value).toBe("2");
    expect(duty.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("at or below 1");
    expect(onBeginChange).not.toHaveBeenCalled();
    expect(onValueChange).not.toHaveBeenCalled();

    fireEvent.change(duty, { target: { value: "0.75" } });

    expect(duty.getAttribute("aria-invalid")).toBe("false");
    expect(onBeginChange).toHaveBeenCalledOnce();
    expect(onBeginChange).toHaveBeenCalledWith("duty");
    expect(onValueChange).toHaveBeenLastCalledWith("0 5 100k 0.75");
  });

  it("refuses non-positive legacy frequency drafts while retaining the valid value", () => {
    const { onBeginChange, onValueChange } = renderSource("1 1k", "vac");
    const frequency = screen.getByLabelText("Frequency") as HTMLInputElement;

    fireEvent.change(frequency, { target: { value: "0" } });

    expect(frequency.value).toBe("0");
    expect(frequency.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("above 0");
    expect(onBeginChange).not.toHaveBeenCalled();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("keeps an incomplete unitless cycles draft accessible until it is valid", () => {
    const { onBeginChange, onValueChange } = renderSource("SINE(0 1 1k)");
    const cycles = screen.getByLabelText("Cycles") as HTMLInputElement;

    fireEvent.change(cycles, { target: { value: "1e-" } });

    expect(cycles.value).toBe("1e-");
    expect(cycles.getAttribute("aria-invalid")).toBe("true");
    expect(cycles.getAttribute("aria-describedby")).toBeTruthy();
    expect(onBeginChange).not.toHaveBeenCalled();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("accepts LTspice-valid zero PULSE edge and on-time values", () => {
    const { onBeginChange, onValueChange } = renderSource("PULSE(0 5 0 1n 1n 5u 10u)");

    for (const label of ["Rise time", "Fall time", "On time"]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: "0" } });
    }

    expect(onBeginChange).toHaveBeenCalledWith("rise");
    expect(onBeginChange).toHaveBeenCalledWith("fall");
    expect(onBeginChange).toHaveBeenCalledWith("width");
    expect(onValueChange.mock.calls.map(([next]) => next)).toEqual([
      "PULSE(0 5 0 0n 1n 5u 10u)",
      "PULSE(0 5 0 1n 0n 5u 10u)",
      "PULSE(0 5 0 1n 1n 0u 10u)",
    ]);
  });

  it("validates PWL times as a draft before mutating the source", () => {
    const { onBeginChange, onValueChange } = renderSource("PWL(1m 0 2m 1)");
    const firstTime = screen.getByLabelText("PWL time 1") as HTMLInputElement;

    // The second point may not move before the first point.
    fireEvent.change(firstTime, { target: { value: "3" } });
    expect(firstTime.value).toBe("3");
    expect(firstTime.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("nondecreasing");
    expect(onBeginChange).not.toHaveBeenCalled();
    expect(onValueChange).not.toHaveBeenCalled();

    // Equal and increasing timestamps are both legal and commit normally.
    fireEvent.change(firstTime, { target: { value: "2" } });
    expect(firstTime.getAttribute("aria-invalid")).toBe("false");
    expect(onBeginChange).toHaveBeenCalledWith("pwl-time-0");
    expect(onValueChange).toHaveBeenLastCalledWith("PWL(2m 0 2m 1)");
  });
});

/**
 * PDF-3 item 1 — "the two should conflate … selection of it should completely
 * swap the component to be the corresponding one … replace any sign of its
 * former self."
 *
 * `screenshots/pdf3-report/img-001-000.png` shows a part whose Waveform reads
 * Sine printing BOTH `DC operating point 5 V` and `Offset 5 V`: two labels for
 * one number, because `decodeIndependentSourceValue("SINE(5 1 1k)", "V")` sets
 * `dcBias = inferredBias = parameters.offset = "5"` and the editor rendered the
 * DC row unconditionally.
 *
 * The rule these tests pin: EXACTLY ONE bias row per waveform. For DC that row
 * is `DC level` (the name `params.ts`'s own `vsource` field already uses — one
 * name per thing). For a waveform whose own first parameter IS the bias — sine's
 * Offset, pulse's Low level, exp's Initial level, PWL's first point — that
 * parameter is the row, and there is no second one. The only exception is a
 * source carrying an EXPLICIT `DC <n>` alongside its function, which LTspice
 * allows and Tau must not silently drop: that gets one row named `DC bias`,
 * which is a different quantity from the waveform's own offset and says so.
 */
describe("P3-01 an independent source shows exactly one bias row per waveform", () => {
  const biasRowLabels = (): string[] =>
    ["DC level", "DC bias", "DC operating point", "Offset", "Low level", "Initial level"].filter(
      (label) => screen.queryByLabelText(label) !== null,
    );

  it("names a DC source's single row 'DC level', the word params.ts already uses", () => {
    renderSource("5");
    expect(biasRowLabels()).toEqual(["DC level"]);
  });

  it("shows a sine's Offset and NOT a second DC row - the exact duplication in the report", () => {
    renderSource("SINE(5 1 1k)");
    expect(screen.queryByLabelText("DC operating point")).toBeNull();
    expect(biasRowLabels()).toEqual(["Offset"]);
  });

  it.each([
    ["PULSE(5 9 0 1n 1n 5u 10u)", "Low level"],
    ["EXP(5 1 0 1u 1m 1u)", "Initial level"],
    ["SFFM(5 1 1k 1 100)", "Offset"],
  ])("shows one bias row for %s", (value, expected) => {
    renderSource(value);
    expect(biasRowLabels()).toEqual([expected]);
  });

  it("shows no separate DC row for PWL, whose first point IS the bias", () => {
    renderSource("PWL(0 5 1m 5)");
    expect(biasRowLabels()).toEqual([]);
    expect(screen.getByLabelText("PWL level 1")).toBeTruthy();
  });

  it("keeps an imported explicit `DC 2 SINE(...)` bias visible, editable and encoded", () => {
    // Import fidelity: the bias is a real second quantity here, not a duplicate
    // of Offset, and dropping the row would let the encoder silently discard it.
    const { onValueChange } = renderSource("DC 2 SINE(0 1 1k)");
    expect(biasRowLabels()).toEqual(["DC bias", "Offset"]);

    fireEvent.change(screen.getByLabelText("DC bias"), { target: { value: "3" } });
    expect(onValueChange).toHaveBeenLastCalledWith("DC 3 SINE(0 1 1k)");
  });
});

/**
 * The Done-when's walk: DC -> Sine -> Pulse -> DC, asserting at EVERY step the
 * displayed name, the visible field set, `component.value`, the canvas caption
 * and the emitted netlist card, plus a byte-identical `.asc` round trip for
 * each waveform.
 *
 * The pre-fix state this replaces, measured by the gate:
 * `kind vsource -> vsource; title "DC source"; value "SINE(5 1 1k)"; fields
 * [..., DC operating point, Offset, Amplitude, ...]`.
 *
 * The kind deliberately does NOT move: `vac`/`vpulse` are storage aliases with
 * their own positional dialect and a different netlist card, and three of the
 * six waveforms have no kind at all. See `componentNames.ts`'s header. What the
 * reader sees is the identity, and every surface below now agrees on it.
 */
describe("P3-01 walking the waveform changes every surface of the part's identity", () => {
  /** Drive the real Select the way a reader does. Radix needs a pointer press
   *  on the trigger; the stubbed capture methods at the top of this file are
   *  what make that work under jsdom. */
  const chooseWaveform = (label: string) => {
    const trigger = screen.getByLabelText("Waveform type");
    trigger.focus();
    // Keyboard rather than pointer: Radix opens on Space/Enter/ArrowDown, and
    // that path needs none of the pointer-capture geometry jsdom lacks.
    fireEvent.keyDown(trigger, { key: " " });
    fireEvent.click(screen.getByRole("option", { name: label }));
  };

  /** The single V card the deck must always contain - never two, never renamed. */
  const sourceCard = (value: string): string => {
    const deck = buildSpiceDeck(
      {
        components: [
          { id: "v1", kind: "vsource", x: 0, y: 0, rotation: 0, value, label: "V1" },
          { id: "r1", kind: "resistor", x: 128, y: 0, rotation: 90, value: "1k", label: "R1" },
          { id: "g1", kind: "ground", x: 0, y: 32, rotation: 0, value: "", label: "" },
        ],
        wires: [
          { id: "w1", points: [{ x: 0, y: -32 }, { x: 128, y: -32 }] },
          { id: "w2", points: [{ x: 128, y: 32 }, { x: 0, y: 32 }] },
        ],
      },
      { kind: "op" },
    );
    const cards = deck.netlist.split("\n").filter((line) => /^V\d/.test(line.trim()));
    expect(cards, deck.netlist).toHaveLength(1);
    return cards[0].trim();
  };

  /** Export one source to `.asc`, read it back, and return the value that
   *  survived. Equality with the input is the byte-identical round trip. */
  const ascRoundTripValue = (value: string): string => {
    const { text } = schematicToAsc({
      components: [{ id: "v1", kind: "vsource", x: 0, y: 0, rotation: 0, value, label: "V1" }],
      wires: [],
      netLabels: [],
    });
    const back = ascToSchematic(parseAsc(text));
    expect(back.components).toHaveLength(1);
    expect(back.components[0].kind).toBe("vsource");
    return back.components[0].value;
  };

  function Harness({ initial }: { initial: string }) {
    const [value, setValue] = useState(initial);
    return (
      <>
        <output data-testid="value">{value}</output>
        <output data-testid="title">{componentDisplayName("vsource", value)}</output>
        <output data-testid="caption">{sourceValueLabel("vsource", value)}</output>
        <IndependentSourceEditor
          value={value}
          unit="V"
          onBeginChange={() => {}}
          onValueChange={setValue}
        />
      </>
    );
  }

  const surfaces = () => ({
    value: screen.getByTestId("value").textContent ?? "",
    title: screen.getByTestId("title").textContent,
    // Normalize the thin space `explicitUnit` puts between a number and its
    // unit, so these expectations stay readable.
    caption: (screen.getByTestId("caption").textContent ?? "").replace(/[\u2009\u00a0]/g, " "),
    fields: Array.from(document.querySelectorAll<HTMLElement>(".property-field > span"))
      .map((span) => span.textContent),
  });

  it("walks DC -> Sine -> Pulse -> DC with the name, fields, value, caption and card all agreeing", () => {
    render(<Harness initial="5" />);

    let now = surfaces();
    expect(now.title).toBe("DC source");
    expect(now.value).toBe("5");
    expect(now.caption).toBe("5 V");
    expect(now.fields).toEqual(["Waveform", "DC level"]);
    expect(sourceCard(now.value)).toBe("V1 n001 0 DC 5");
    expect(ascRoundTripValue(now.value)).toBe("5");

    chooseWaveform("Sine");
    now = surfaces();
    // Nothing of the DC state survives except the operating level, which is
    // what the sine now oscillates about - that is a migration, not a remnant.
    expect(now.title).toBe("Sine voltage source");
    expect(now.value).toBe("SINE(5 1 1k)");
    expect(now.caption).toBe("Sine · 1 V @ 1k Hz");
    expect(now.fields).toEqual([
      "Waveform", "Offset", "Amplitude", "Frequency", "Start delay", "Damping", "Phase", "Cycles",
    ]);
    expect(now.fields).not.toContain("DC operating point");
    expect(sourceCard(now.value)).toBe("V1 n001 0 DC 5 SIN(5 1 1000)");
    expect(ascRoundTripValue(now.value)).toBe("SINE(5 1 1k)");

    chooseWaveform("Pulse");
    now = surfaces();
    expect(now.title).toBe("Pulse voltage source");
    // The seeded high level must differ from the low level, or the "pulse" the
    // reader just asked for is a flat line and the switch looks like a no-op.
    expect(now.value).toBe("PULSE(5 10 0 1n 1n 5u 10u)");
    expect(now.caption).toBe("Pulse · 5 V→10 V");
    expect(now.fields).toEqual([
      "Waveform", "Low level", "High level", "Start delay", "Rise time", "Fall time", "On time",
      "Period", "Cycles",
    ]);
    expect(sourceCard(now.value)).toBe("V1 n001 0 DC 5 PULSE(5 10 0 1e-9 1e-9 0.000005 0.00001)");
    expect(ascRoundTripValue(now.value)).toBe("PULSE(5 10 0 1n 1n 5u 10u)");

    chooseWaveform("DC");
    now = surfaces();
    expect(now.title).toBe("DC source");
    expect(now.value).toBe("5");
    expect(now.caption).toBe("5 V");
    expect(now.fields).toEqual(["Waveform", "DC level"]);
    expect(sourceCard(now.value)).toBe("V1 n001 0 DC 5");
  });

  it("keeps the AC analysis disclosure available on every waveform - it is a stimulus, not a waveform", () => {
    render(<Harness initial="5" />);
    for (const waveform of ["Sine", "Pulse", "Piecewise linear", "Exponential", "Single-frequency FM", "DC"]) {
      chooseWaveform(waveform);
      expect(
        screen.getByRole("button", { name: "Toggle AC analysis stimulus" }),
        waveform,
      ).toBeTruthy();
    }
  });

  it("keeps AC collapsed until requested, then explains and edits the .ac-only stimulus", () => {
    const { onValueChange } = renderSource("5");

    expect(screen.queryByLabelText("Enable small-signal AC stimulus for .ac analysis")).toBeNull();
    const disclosure = screen.getByRole("button", { name: "Toggle AC analysis stimulus" });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(disclosure);

    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Sets the small-signal excitation for .ac; it does not change this source’s time-domain waveform.")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Enable small-signal AC stimulus for .ac analysis"));
    expect(onValueChange).toHaveBeenLastCalledWith("5 AC 1");
  });

  it("opens the AC analysis disclosure for an authored stimulus without changing its value", () => {
    renderSource("5 AC 2 45");

    expect(screen.getByRole("button", { name: "Toggle AC analysis stimulus" }).getAttribute("aria-expanded")).toBe("true");
    expect((screen.getByRole("textbox", { name: "AC amplitude" }) as HTMLInputElement).value).toBe("2");
    expect((screen.getByRole("textbox", { name: "AC phase (°)" }) as HTMLInputElement).value).toBe("45");
  });

  it("gives each waveform switch its own begin-change key, so undo steps back one waveform at a time", () => {
    // `beginParamChange` in ShellPanels coalesces by KEY: it only snapshots
    // history when the key changes. A constant "mode" key therefore merged
    // DC -> Sine -> Pulse into one entry and undo skipped Sine entirely.
    const onBeginChange = vi.fn();
    render(
      <IndependentSourceEditor
        value="5"
        unit="V"
        onBeginChange={onBeginChange}
        onValueChange={() => {}}
      />,
    );

    chooseWaveform("Sine");
    chooseWaveform("Pulse");

    expect(onBeginChange.mock.calls.map(([key]) => key)).toEqual(["mode:sine", "mode:pulse"]);
  });
});

/**
 * Done-when clause 4: "an alias-stored part that converges to `vsource` does so
 * in one undoable step". The editor half — that the switch is routed to the
 * identity seam rather than to a bare value write. The store half (one history
 * entry, kind and value restored together, one V card) is in
 * `store/useSchematic.test.ts`.
 */
describe("P3-01 a legacy alias converges to its canonical kind when its waveform changes", () => {
  const chooseWaveform = (label: string) => {
    const trigger = screen.getByLabelText("Waveform type");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: " " });
    fireEvent.click(screen.getByRole("option", { name: label }));
  };

  it.each([
    ["vac", "V", "1 1k", "Pulse", "vsource", "PULSE(0 5 0 1n 1n 5u 10u)"],
    ["iac", "A", "1m 1k", "DC", "isource", "0"],
    ["vpulse", "V", "0 5 100k 0.5", "Sine", "vsource", "SINE(0 1 1k)"],
  ] as const)(
    "routes a %s switched to %s through the identity seam, never through a bare value write",
    (legacyKind, unit, value, waveform, expectedKind, expectedValue) => {
      const onIdentityChange = vi.fn();
      const onValueChange = vi.fn();
      const onBeginChange = vi.fn();
      render(
        <IndependentSourceEditor
          value={value}
          unit={unit}
          legacyKind={legacyKind}
          onBeginChange={onBeginChange}
          onValueChange={onValueChange}
          onIdentityChange={onIdentityChange}
        />,
      );

      chooseWaveform(waveform);

      expect(onIdentityChange).toHaveBeenCalledExactlyOnceWith(expectedKind, expectedValue);
      // A bare value write would leave the kind behind and the alias's
      // positional codec would then read the function text as garbage.
      expect(onValueChange).not.toHaveBeenCalled();
      // And no separate history snapshot: `setSourceIdentity` takes its own,
      // so an extra `onBeginChange` here would record an empty entry.
      expect(onBeginChange).not.toHaveBeenCalled();
    },
  );

  it("leaves a canonical vsource on the plain value path, because it has no alias to escape", () => {
    const onIdentityChange = vi.fn();
    const onValueChange = vi.fn();
    render(
      <IndependentSourceEditor
        value="5"
        unit="V"
        onBeginChange={() => {}}
        onValueChange={onValueChange}
        onIdentityChange={onIdentityChange}
      />,
    );

    chooseWaveform("Sine");

    expect(onIdentityChange).not.toHaveBeenCalled();
    expect(onValueChange).toHaveBeenLastCalledWith("SINE(5 1 1k)");
  });

  it("still applies the waveform when no identity seam is wired, so the editor works standalone", () => {
    // The fallback exists because ShellPanels wires `onIdentityChange` in a
    // file this lane does not own; the editor must not become inert if that
    // prop is missing.
    const onValueChange = vi.fn();
    render(
      <IndependentSourceEditor
        value="1 1k"
        unit="V"
        legacyKind="vac"
        onBeginChange={() => {}}
        onValueChange={onValueChange}
      />,
    );

    chooseWaveform("Pulse");

    expect(onValueChange).toHaveBeenLastCalledWith("PULSE(0 5 0 1n 1n 5u 10u)");
  });
});
