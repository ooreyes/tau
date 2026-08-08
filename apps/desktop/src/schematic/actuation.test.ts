import { describe, expect, it } from "vitest";
import {
  actuatedValue,
  actuationLabel,
  draggedWiper,
  isActuable,
  isDraggableWiper,
  wiperFraction,
  wiperValue,
  NON_ACTUABLE,
} from "./actuation";
import { parsePotentiometerSpec } from "../engine/potentiometerSpec";
import { isSpdtThrowToNo, isStaticContactClosed } from "./kindGroups";
import type { ComponentKind, Rotation } from "./types";

const part = (kind: ComponentKind, value: string, label = "S1") => ({ kind, value, label });

describe("contact actuation", () => {
  it("toggles a switch on press and ignores the release", () => {
    expect(actuatedValue(part("switch", "open"), "press")).toBe("closed");
    expect(actuatedValue(part("switch", "closed"), "press")).toBe("open");
    // A toggle switch stays where it is put; letting go must not undo it.
    expect(actuatedValue(part("switch", "closed"), "release")).toBeNull();
  });

  it("springs a normally-open button back when released", () => {
    const pressed = actuatedValue(part("pushButton", "open"), "press");
    expect(pressed).not.toBeNull();
    expect(isStaticContactClosed(pressed!)).toBe(true);
    const released = actuatedValue(part("pushButton", pressed!), "release");
    expect(released).not.toBeNull();
    expect(isStaticContactClosed(released!)).toBe(false);
  });

  it("opens a normally-closed button while held, then lets it close again", () => {
    // The palette places an NC button as the bare word "closed".
    const pressed = actuatedValue(part("pushButton", "closed"), "press");
    expect(pressed).not.toBeNull();
    expect(isStaticContactClosed(pressed!)).toBe(false);
    const released = actuatedValue(part("pushButton", pressed!), "release");
    expect(released).not.toBeNull();
    expect(isStaticContactClosed(released!)).toBe(true);
  });

  it("records where a button rests before its live state stops saying so", () => {
    // This is the whole reason `form` is written on the way in: after the first
    // press an NC button reads "open", and nothing left in the value would say
    // it should spring back to closed.
    const pressed = actuatedValue(part("pushButton", "closed"), "press");
    expect(pressed).toMatch(/\bform=nc\b/);
    // Two full cycles must land back where it started, not drift.
    let value = "closed";
    for (let cycle = 0; cycle < 2; cycle += 1) {
      value = actuatedValue(part("pushButton", value), "press")!;
      expect(isStaticContactClosed(value)).toBe(false);
      value = actuatedValue(part("pushButton", value), "release")!;
      expect(isStaticContactClosed(value)).toBe(true);
    }
  });

  it("keeps a latching button where it was clicked", () => {
    const latching = "open action=latching";
    const pressed = actuatedValue(part("pushButton", latching), "press");
    expect(pressed).not.toBeNull();
    expect(isStaticContactClosed(pressed!)).toBe(true);
    expect(actuatedValue(part("pushButton", pressed!), "release")).toBeNull();
  });

  it("throws an SPDT between its poles in the spelling the solver reads", () => {
    const thrown = actuatedValue(part("spdt", "no"), "press");
    expect(thrown).not.toBeNull();
    expect(isSpdtThrowToNo(thrown!)).toBe(false);
    const back = actuatedValue(part("spdt", thrown!), "press");
    expect(isSpdtThrowToNo(back!)).toBe(true);
  });

  it("actuates a hand-typed spelling the solver already accepts", () => {
    // `on` and `1` mean closed to the netlist, so they must mean closed here.
    expect(isStaticContactClosed(actuatedValue(part("switch", "on"), "press")!)).toBe(false);
    expect(isStaticContactClosed(actuatedValue(part("switch", "1"), "press")!)).toBe(false);
  });

  it("leaves the solver's reading of the value intact", () => {
    // The netlist tests the raw string's first word, so the contact state has
    // to stay the leading bare token however many other fields are stored.
    const pressed = actuatedValue(part("pushButton", "closed"), "press")!;
    expect(pressed.trim().split(/\s+/)[0]).toMatch(/^(open|closed)$/);
  });

  it("refuses the parts that only look operable, with a reason", () => {
    expect(isActuable("relay")).toBe(false);
    expect(isActuable("motor")).toBe(false);
    expect(NON_ACTUABLE.relay).toMatch(/coil/i);
    expect(actuatedValue(part("relay", "100"), "press")).toBeNull();
    expect(actuatedValue(part("resistor", "1k"), "press")).toBeNull();
  });

  it("names the gesture for a screen reader", () => {
    expect(actuationLabel(part("pushButton", "open", "SW3"))).toBe("Press SW3");
    expect(actuationLabel(part("switch", "open", "S1"))).toBe("Toggle S1");
    expect(actuationLabel(part("potentiometer", "10k", "RV1"))).toBe("Drag the RV1 wiper");
    expect(actuationLabel(part("resistor", "1k", "R1"))).toBeNull();
  });
});

describe("potentiometer wiper drag", () => {
  const pot = (value: string, rotation: Rotation = 0, mirrored = false) => ({
    kind: "potentiometer" as const,
    value,
    label: "RV1",
    rotation,
    mirrored,
  });

  it("offers a wiper only on the part that has one", () => {
    expect(isDraggableWiper("potentiometer")).toBe(true);
    expect(isDraggableWiper("resistor")).toBe(false);
    expect(isDraggableWiper("switch")).toBe(false);
    expect(wiperValue(part("resistor", "1k"), 0.25)).toBeNull();
  });

  it("moves the tap by the distance dragged, not to where the pointer landed", () => {
    // Absolute mapping would jerk the wiper to wherever the reader clicked, and
    // on the simulator canvas clicking a part is also how you select it.
    expect(draggedWiper(pot("10k"), 0.5, 0, 0)).toBeCloseTo(0.5, 12);
    // Full travel is 40 world units (±20 either side of centre), so +10 is a
    // quarter turn regardless of where on the body the drag started.
    expect(draggedWiper(pot("10k"), 0.5, 10, 0)).toBeCloseTo(0.75, 12);
    expect(draggedWiper(pot("10k"), 0.2, 10, 0)).toBeCloseTo(0.45, 12);
    expect(draggedWiper(pot("10k"), 0.5, -20, 0)).toBeCloseTo(0, 12);
  });

  it("follows the arrow, not the screen, on a rotated or mirrored part", () => {
    // Rotated 90°, the track runs down the screen: dragging DOWN raises the tap.
    expect(draggedWiper(pot("10k", 90), 0.5, 0, 10)).toBeCloseTo(0.75, 12);
    expect(draggedWiper(pot("10k", 90), 0.5, 10, 0)).toBeCloseTo(0.5, 12);
    // Rotated 180° / mirrored, pin A is on the right, so right lowers the tap.
    expect(draggedWiper(pot("10k", 180), 0.5, 10, 0)).toBeCloseTo(0.25, 12);
    expect(draggedWiper(pot("10k", 0, true), 0.5, 10, 0)).toBeCloseTo(0.25, 12);
    expect(draggedWiper(pot("10k", 270), 0.5, 0, 10)).toBeCloseTo(0.25, 12);
  });

  it("accumulates past an end stop without hysteresis on the way back", () => {
    // The travel is only 40 units wide, so a reader overshoots constantly. The
    // fraction stays unclamped here and clamps on the way into the value, so
    // dragging 200 units past the end and back returns the tap to the pointer.
    const overshot = draggedWiper(pot("10k"), 0.5, 200, 0);
    expect(overshot).toBeGreaterThan(1);
    expect(wiperValue(pot("10k"), overshot)).toBe("10k Wiper=1");
    expect(wiperValue(pot("10k"), draggedWiper(pot("10k"), 0.5, 200 - 10, 0))).toBe("10k Wiper=1");
    // …and coming back inside the travel resumes exactly where the pointer is.
    expect(wiperValue(pot("10k"), draggedWiper(pot("10k"), 0.5, 8, 0))).toBe("10k Wiper=0.7");
  });

  it("clamps and quantises into a value the netlist parser reads back", () => {
    expect(wiperValue(pot("10k"), -3)).toBe("10k Wiper=0");
    expect(wiperValue(pot("10k"), 7)).toBe("10k Wiper=1");
    // 1 % steps: a value string on the sheet stays short and readable.
    expect(wiperValue(pot("10k"), 0.123456)).toBe("10k Wiper=0.12");
    expect(parsePotentiometerSpec(wiperValue(pot("10k"), 0.123456)!).wiper).toBeCloseTo(0.12, 12);
    expect(parsePotentiometerSpec(wiperValue(pot("10k"), 0.123456)!).resistanceText).toBe("10k");
  });

  it("leaves a centred wiper spelled the way every saved schematic spells it", () => {
    // `omitWhenFallback` again: re-encoding 0.5 as "10k Wiper=0.5" would rewrite
    // the value of every potentiometer already on disk.
    expect(wiperValue(pot("10k"), 0.5)).toBeNull();
    expect(wiperValue(pot("10k Wiper=0.8"), 0.5)).toBe("10k");
    expect(wiperFraction(pot("10k"))).toBe(0.5);
    expect(wiperFraction(pot("10k Wiper=0.8"))).toBe(0.8);
  });

  it("reports no change when the tap has not moved a whole step", () => {
    expect(wiperValue(pot("10k Wiper=0.25"), 0.2501)).toBeNull();
    expect(wiperValue(pot("10k Wiper=0.25"), 0.26)).toBe("10k Wiper=0.26");
  });

  it("keeps the rest of the value string through a drag", () => {
    expect(wiperValue(pot("4k7 Wiper=0.25"), 0.9)).toBe("4k7 Wiper=0.9");
  });
});
