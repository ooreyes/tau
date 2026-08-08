import { describe, expect, it } from "vitest";
import { actuatedValue, actuationLabel, isActuable, NON_ACTUABLE } from "./actuation";
import { isSpdtThrowToNo, isStaticContactClosed } from "./kindGroups";
import type { ComponentKind } from "./types";

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
    expect(actuationLabel(part("resistor", "1k", "R1"))).toBeNull();
  });
});
