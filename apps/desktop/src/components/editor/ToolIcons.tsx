import type { ComponentPropsWithoutRef } from "react";

/**
 * Tool-object glyphs for the editor tool strip (P3-12, P3-13).
 *
 * WHY HAND-AUTHORED, given the contract's sourcing order (lucide first, then
 * another permissive set, hand-authored last): every set the contract names is
 * monochrome single-path by construction. Lucide's `eraser` is two strokes with
 * no fill and its `tag` is a path plus a `currentColor` circle; neither can
 * express "a rose rubber body with a grey metal ferrule" or "a kraft card with
 * a steel eyelet", which is the whole of what the report asked for. There is no
 * probe glyph at all - the nearest is `pipette`, an eyedropper. Multi-colour
 * sets are either share-alike (OpenMoji, CC BY-SA 4.0 - wrong for a proprietary
 * product) or emoji-scale illustrations that turn to mush at 16 px. So these
 * are fresh geometry, authored at 16x16 rather than scaled down from artwork,
 * and NO lucide path data is copied - copying and editing it would make this a
 * derivative work and require a new THIRD_PARTY_NOTICES section. Rendering the
 * lucide components (as Select and Simulation setup still do) does not, since
 * lucide-react is already attributed there under ISC.
 *
 * WHY TWO PAINT SLOTS. Each glyph paints from `--ti-1` (the object's own ink)
 * and `--ti-2` (its metal), both falling back to `currentColor`. The fallback
 * is what makes these safe to render outside the tool strip - the simulator's
 * probe button and the scope empty state get a monochrome probe that follows
 * whatever colour that surface already sets. styles/editorToolbarIcons.css
 * feeds the two slots per tone, and resets both to the neutral ink when the
 * button is disabled, because DESIGN_SYSTEM 0.1 requires a disabled tool to
 * desaturate rather than merely dim.
 *
 * The presentation attributes beat App.css:6134's `.editor-icon-btn svg { fill:
 * none }`: that rule matches the ROOT svg only, so children see `fill: none` as
 * an inherited value, which loses to an attribute of their own.
 */

/** The object's own ink - red barrel, kraft card, rose rubber. */
const INK = "var(--ti-1, currentColor)";
/** The object's metal - probe tip, tag eyelet, eraser ferrule, bin body. */
const METAL = "var(--ti-2, currentColor)";

/**
 * Every svg prop passes through, because the three call sites outside this
 * lane spell the same thing differently: the strip renders `<ProbeIcon />`,
 * App.tsx's simulator button `<ProbeIcon size={13} aria-hidden="true" />`, and
 * the scope empty state `size={20}`. Narrowing this to {size, className} would
 * turn a caller's `aria-hidden` into a type error in a file this lane may not
 * edit.
 */
type IconProps = ComponentPropsWithoutRef<"svg"> & {
  /** Rendered edge length in px. 16 in the strip; 13 and 20 at the two cross-lane sites. */
  size?: number;
};

function frame(size: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    // aria-hidden by default: these glyphs sit inside a button that already
    // carries the accessible name. A caller may still override it.
    "aria-hidden": true,
  };
}

/**
 * Multimeter probe: chromed needle, collar, red barrel, lead running off the
 * bottom-right corner. Drawn on the diagonal rather than upright like the
 * reference photo, for two reasons: a 45deg composition uses the whole 16 px
 * box (an upright probe is 4 px wide and reads as a stray tick), and the tip
 * lands in the top-left where a cursor hotspot belongs, so the same art can be
 * reused as the canvas cursor.
 */
export function ProbeIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...frame(size)} {...rest} data-tool-icon="probe">
      {/* Needle first so the collar overlaps its base rather than butting it. */}
      <path d="M2.9 2.9 L6.4 6.4" stroke={METAL} strokeWidth={1.4} strokeLinecap="round" />
      <path d="M6.1 6.1 L7.5 7.5" stroke={METAL} strokeWidth={3.4} strokeLinecap="butt" />
      <path d="M7.9 7.9 L11.5 11.5" stroke={INK} strokeWidth={5} strokeLinecap="round" />
      <path d="M12.4 12.4 L14.4 14.4" stroke={METAL} strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  );
}

/**
 * Hookup wire: the existing dogleg geometry, kept verbatim because schematic
 * wires are axis-aligned and the shape was already right - only the ink is new.
 * The endpoints are metal, not insulation: they are stripped/tinned ends, which
 * is what makes the red read as insulation rather than as a warning colour.
 */
export function WireIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...frame(size)} {...rest} data-tool-icon="wire">
      <path
        d="M3.2 12.2 H8 V3.8 H12.8"
        stroke={INK}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="3.2" cy="12.2" r="1.7" fill={METAL} stroke="none" />
      <circle cx="12.8" cy="3.8" r="1.7" fill={METAL} stroke="none" />
    </svg>
  );
}

/** Manila luggage tag: kraft card with a pointed left end and a steel eyelet. */
export function TagIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...frame(size)} {...rest} data-tool-icon="tag">
      <path
        d="M5.4 3.2 H12.6 A1.4 1.4 0 0 1 14 4.6 V11.4 A1.4 1.4 0 0 1 12.6 12.8 H5.4 L1.9 8 Z"
        fill={INK}
        stroke="none"
      />
      <circle cx="5.4" cy="8" r="1.15" fill={METAL} stroke="none" />
    </svg>
  );
}

/**
 * Rubber eraser: rose block, grey metal ferrule across the top edge, tilted so
 * it reads as an object lying on the sheet rather than as a filled rectangle.
 * The ferrule is the "pink/grey metal" half of the report's wording, and it is
 * also why the eraser still registers as an accent - the dominant (most
 * saturated) paint is the rose body, the ferrule only qualifies it.
 */
export function EraserIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...frame(size)} {...rest} data-tool-icon="eraser">
      <g transform="rotate(-22 8 8)">
        <rect x="1.6" y="5.6" width="12.8" height="5.6" rx="1.1" fill={INK} stroke="none" />
        <rect x="1.6" y="5.6" width="4.4" height="5.6" rx="1.1" fill={METAL} stroke="none" />
      </g>
    </svg>
  );
}

/**
 * Waste bin in brushed steel. Deliberately the ONLY glyph with no colour of its
 * own: the report asked for "a gray trascan", and DESIGN_SYSTEM 0.1 keeps tools
 * whose real counterpart is neutral neutral. It is still a tone (a near-neutral
 * steel with the cool undertone section 1.1 mandates) rather than the default
 * ink, so the destructive control does not read as identical to Select.
 */
export function TrashIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...frame(size)} {...rest} data-tool-icon="trash">
      <path d="M2.6 4.3 H13.4" stroke={METAL} strokeWidth={1.5} strokeLinecap="round" />
      <path d="M6.2 4.3 V3 A0.9 0.9 0 0 1 7.1 2.1 H8.9 A0.9 0.9 0 0 1 9.8 3 V4.3" stroke={METAL} strokeWidth={1.3} />
      <path
        d="M4.1 5.9 H11.9 L11.3 13.1 A1 1 0 0 1 10.3 14 H5.7 A1 1 0 0 1 4.7 13.1 Z"
        fill={INK}
        stroke="none"
      />
      {/* Two flutes, cut in the button's background colour so the bin reads as
          a pressed-steel object instead of a solid blob at 16 px. */}
      <path d="M6.7 7.9 V11.9 M9.3 7.9 V11.9" stroke="var(--panel-3)" strokeWidth={1.1} strokeLinecap="round" />
    </svg>
  );
}

/** History back: a counter-clockwise arrow. Direction AND hue separate it from Redo. */
export function UndoIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...frame(size)} {...rest} data-tool-icon="undo">
      <path
        d="M3 8.4 A5.2 5.2 0 1 1 8.2 13.6"
        stroke={INK}
        strokeWidth={1.8}
        strokeLinecap="round"
        fill="none"
      />
      <path d="M3 4.4 V8.6 H7.2" stroke={INK} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

/** History forward: the mirror of UndoIcon, in the opposing hue. */
export function RedoIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...frame(size)} {...rest} data-tool-icon="redo">
      <path
        d="M13 8.4 A5.2 5.2 0 1 0 7.8 13.6"
        stroke={INK}
        strokeWidth={1.8}
        strokeLinecap="round"
        fill="none"
      />
      <path d="M13 4.4 V8.6 H8.8" stroke={INK} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

/**
 * The probe glyph as a CSS `cursor` value, for Canvas.tsx's inline
 * `style={{ cursor }}` (a stylesheet cannot override an inline style without
 * !important, so the value has to be produced here).
 *
 * Colours are read off the live document at call time rather than baked in, so
 * the cursor follows the theme and no raw colour is added to Canvas.tsx. Every
 * failure path - no document, unreadable tokens, a browser that rejects the
 * data URL - returns the plain "crosshair" literal that probe mode uses today,
 * so jsdom and any headless path keep exactly the current behaviour.
 */
export function probeCursor(): string {
  const FALLBACK = "crosshair";
  if (typeof document === "undefined" || !document.documentElement) return FALLBACK;
  try {
    const style = getComputedStyle(document.documentElement);
    const ink = style.getPropertyValue("--tool-probe-ink").trim();
    const metal = style.getPropertyValue("--tool-steel-ink").trim();
    if (!ink || !metal) return FALLBACK;
    // A 24px cursor with the hotspot on the needle tip. The art is the same
    // diagonal probe as ProbeIcon, scaled 16 -> 24 (factor 1.5), so the tip at
    // (2.9, 2.9) lands at (4, 4).
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 16 16" fill="none">`
      + `<path d="M2.9 2.9 L6.4 6.4" stroke="${metal}" stroke-width="1.4" stroke-linecap="round"/>`
      + `<path d="M6.1 6.1 L7.5 7.5" stroke="${metal}" stroke-width="3.4"/>`
      + `<path d="M7.9 7.9 L11.5 11.5" stroke="${ink}" stroke-width="5" stroke-linecap="round"/>`
      + `<path d="M12.4 12.4 L14.4 14.4" stroke="${metal}" stroke-width="1.6" stroke-linecap="round"/>`
      + `</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 4 4, ${FALLBACK}`;
  } catch {
    return FALLBACK;
  }
}
