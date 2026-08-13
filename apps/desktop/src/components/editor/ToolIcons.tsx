import type { ComponentPropsWithoutRef } from "react";
import { Redo2, Undo2 } from "lucide-react";
import { TAG_CURSOR_ART, TAG_CURSOR_BODY_PATH, TAG_CURSOR_EYELET } from "./tagCursorGeometry";

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
 * product) or emoji-scale illustrations that turn to mush at tool-strip size. So
 * these are fresh geometry, authored in a 16-unit grid rather than scaled down
 * from artwork, and NO lucide path data is copied - copying and editing it would
 * make this a derivative work and require a new THIRD_PARTY_NOTICES section.
 * Rendering the lucide components does not, since lucide-react is already
 * attributed under ISC - which is why Undo/Redo below ARE lucide (see the note
 * there; hand-drawn arrowheads did not meet their arcs) and why Select and
 * Simulation setup in the strip still render it directly.
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
 * Rendered size of a tool glyph in the strip.
 *
 * 18, not 16: the review asked for slightly bigger icons, and at 16 the detail
 * that makes a glyph read as an object - the probe's collar, the tag's eyelet,
 * the eraser's ferrule - was landing on one or two pixels. One number so all
 * nine tools stay the same size; the two cross-lane call sites pass their own
 * (13 in the simulator's button, 20 in the scope empty state) and are unaffected.
 */
export const TOOL_ICON_SIZE = 18;

/**
 * Every svg prop passes through, because the three call sites outside this
 * lane spell the same thing differently: the strip renders `<ProbeIcon />`,
 * App.tsx's simulator button `<ProbeIcon size={13} aria-hidden="true" />`, and
 * the scope empty state `size={20}`. Narrowing this to {size, className} would
 * turn a caller's `aria-hidden` into a type error in a file this lane may not
 * edit.
 */
type IconProps = ComponentPropsWithoutRef<"svg"> & {
  /** Rendered edge length in px. `TOOL_ICON_SIZE` in the strip; 13 and 20 at
   *  the two cross-lane sites. The viewBox stays 16x16 either way - these are
   *  authored in a 16-unit grid and scaled by the renderer, not redrawn. */
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
/**
 * The meter itself, for the Probe TOOL button.
 *
 * The button and the cursor say different things and should not share a glyph.
 * The button is the instrument you are picking up - a digital multimeter, and
 * that is what makes it recognisable in a strip of nine. The cursor is the red
 * lead you touch to a node, and that is `probeCursor()` below. A probe glyph on
 * the button was doing neither job well: at 18 px a lone lead reads as a
 * coloured tick.
 *
 * Two paint slots only, so the case is drawn as an ORANGE BEZEL with the
 * button's own background showing through as the meter's body. That is why there
 * is no third "case" token: an outline plus a pale LCD band plus a dial is the
 * whole silhouette, and it survives 18 px where a filled navy body with an
 * orange rim does not.
 */
export function MultimeterIcon({ size = TOOL_ICON_SIZE, ...rest }: IconProps) {
  return (
    <svg {...frame(size)} {...rest} data-tool-icon="multimeter">
      {/* Case: rounded bezel. Stroked, not filled, so the button's own surface
          reads as the meter's body and only two paint slots are needed. 1.35 and
          not 1.5: at the shipping size every tenth of a stroke is interior room
          the LCD and dial need to stay separable. */}
      <rect
        x="2.9" y="1.4" width="10.2" height="13.2"
        rx="1.9" fill="none" stroke={INK} strokeWidth={1.35}
      />
      {/* LCD: the pale readout band. */}
      <rect x="4.6" y="3.1" width="6.8" height="3.5" rx="0.5" fill={METAL} stroke="none" />
      {/* Range dial: a filled disc with a pointer notch at 11 o'clock. The notch
          is what separates a meter from a phone or a playing card, so it is cut
          in the surface colour at a width that survives 18px rather than being a
          hairline that disappears. */}
      <circle cx="8" cy="10.4" r="2.75" fill={INK} stroke="none" />
      <path d="M8 10.4 L6.5 8.7" stroke="var(--panel-3)" strokeWidth={1.2} strokeLinecap="round" />
      {/* No input jacks: at the shipping size they are sub-pixel and only muddy
          the bottom edge, which is worse than their absence. */}
    </svg>
  );
}

export function ProbeIcon({ size = TOOL_ICON_SIZE, ...rest }: IconProps) {
  return (
    <svg {...frame(size)} {...rest} data-tool-icon="probe">
      {/*
        Built from six parts, in paint order, because the first version was four
        plain strokes of uniform width and read as a red bar with a grey tick.
        A probe is recognisable by its silhouette: a TAPERED needle, a bright
        collar, a barrel that is widest at the finger guard and narrows into the
        lead. Uniform-width strokes throw all three of those away.

        Everything sits on the 45deg diagonal so the art fills the 16px box and
        the tip lands top-left, where a cursor hotspot belongs - the canvas
        cursor reuses this geometry.
      */}
      {/* 1. Needle, as a tapered polygon rather than a stroke: 0.5px at the
             point, 1.9px where it enters the collar. */}
      <path d="M2.1 2.1 L3.05 2.6 L6.5 6.05 L6.05 6.5 L2.6 3.05 Z" fill={METAL} stroke="none" />
      {/* 2. Chrome collar - the bright band between needle and barrel. */}
      <path d="M5.75 7.15 L7.15 5.75 L8.45 7.05 L7.05 8.45 Z" fill={METAL} stroke="none" />
      {/* 3. Barrel: a hexagonal body, fattest at the finger guard, tapering
             toward the lead. Drawn as one closed path so the silhouette is a
             shape and not a thick line with round caps. */}
      <path
        d="M7.35 8.75 L8.75 7.35 L11.15 9.05 L12.25 10.15 L11.35 12.35 L10.15 12.25 L9.05 11.15 Z"
        fill={INK}
        stroke="none"
      />
      {/* 4. Finger guard: the raised ridge that stops your hand sliding onto the
             needle. One darker notch across the barrel's waist. */}
      <path d="M8.15 10.75 L10.75 8.15" stroke={METAL} strokeWidth={1.15} strokeLinecap="round" opacity={0.85} />
      {/* 5. Specular highlight along the barrel's upper edge - what makes it
             read as a moulded body rather than a flat wedge. */}
      <path d="M8.5 8.35 L11.1 10.05" stroke="var(--panel-3)" strokeWidth={0.75} strokeLinecap="round" opacity={0.5} />
      {/* 6. Lead, leaving the boot at the corner. */}
      <path d="M11.85 12.5 L14.3 14.3" stroke={METAL} strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

/**
 * Hookup wire: the existing dogleg geometry, kept verbatim because schematic
 * wires are axis-aligned and the shape was already right - only the ink is new.
 * The endpoints are metal, not insulation: they are stripped/tinned ends, which
 * is what makes the red read as insulation rather than as a warning colour.
 */
export function WireIcon({ size = TOOL_ICON_SIZE, ...rest }: IconProps) {
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
export function TagIcon({ size = TOOL_ICON_SIZE, ...rest }: IconProps) {
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
export function EraserIcon({ size = TOOL_ICON_SIZE, ...rest }: IconProps) {
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
export function TrashIcon({ size = TOOL_ICON_SIZE, ...rest }: IconProps) {
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

/*
 * History back / forward.
 *
 * These two are lucide's `Undo2` / `Redo2`, NOT hand-authored - and that is a
 * correction. The first version drew an arc plus a two-segment corner bracket
 * for the head, and the head did not meet the arc's tangent: at 16 px it read as
 * a detached tick beside a curve, which is exactly the "misaligned arrows" the
 * review called out. An arrowhead that meets a curve cleanly is a solved
 * problem and lucide has solved it; re-deriving that geometry to keep the file
 * uniform would be vanity.
 *
 * Rendering the lucide COMPONENT is licence-clean and the note at the top of
 * this file already says so: lucide-react is a dependency, attributed under ISC,
 * and Select / Simulation setup in the strip render it directly. What would
 * require a new THIRD_PARTY_NOTICES section is copying its path data into our
 * own `<path>`, which is precisely what is NOT happening here.
 *
 * Tinting works through `color`, not the two paint slots: lucide strokes
 * `currentColor`, so setting `color: var(--ti-1)` on the svg makes the tone
 * feed reach it unchanged, and the same `currentColor` fallback keeps these
 * monochrome outside the tool strip.
 */
const historyStyle = { color: INK } as const;

/** History back. Direction AND hue separate it from Redo. */
export function UndoIcon({ size = TOOL_ICON_SIZE, style, ...rest }: IconProps) {
  return <Undo2 width={size} height={size} strokeWidth={1.9} aria-hidden style={{ ...historyStyle, ...style }} {...rest} />;
}

/** History forward: the mirror, in the opposing hue. */
export function RedoIcon({ size = TOOL_ICON_SIZE, style, ...rest }: IconProps) {
  return <Redo2 width={size} height={size} strokeWidth={1.9} aria-hidden style={{ ...historyStyle, ...style }} {...rest} />;
}

/**
 * The red probe LEAD as a CSS `cursor` value, for Canvas.tsx's inline
 * `style={{ cursor }}` (a stylesheet cannot override an inline style without
 * !important, so the value has to be produced here).
 *
 * Deliberately a different object from the tool button, which draws the meter
 * (`MultimeterIcon`): you pick up the instrument, then you touch its lead to a
 * node. The cursor is the end of the lead.
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
    /*
     * The red lead, at 1:1 in a 28px box - NOT the button's glyph scaled up.
     *
     * Authored directly in device pixels because a cursor has one job the button
     * does not: the hotspot must sit exactly on the metal tip, or the point you
     * click is not the point the needle is touching. Every coordinate below is
     * therefore a real pixel, the tip is at (3, 3), and the hotspot is declared
     * `3 3` - one number, in one unit, verifiable by reading the path.
     *
     * The previous version drew the 16-unit art at width=24 and declared a
     * hotspot of `4 4` against a tip that actually landed at 4.35 - a third of a
     * pixel adrift, and adrift by a DIFFERENT amount at any other scale, because
     * the offset was a scaling artefact rather than a stated position.
     *
     * The tip is `metal`, per the review: a probe's needle is steel, and a red
     * point on a red-heavy schematic is also the one colour that could be
     * mistaken for a trace.
     */
    /*
     * Every vertex below is DERIVED, not drawn by eye.
     *
     * One axis runs from the tip at (3,3) along 45deg; each feature is placed by
     * its distance `s` along that axis with a half-width perpendicular to it, so
     * needle, collar, barrel, guard and lead are collinear by construction and
     * symmetric about the same centre line. The previous version placed each
     * part by hand and the review's verdict was that the drawing was "a bit
     * mismatched" - it was, because five independently-typed coordinate pairs do
     * not share an axis unless someone does the trigonometry.
     *
     * 32px, up from 28, per the review's "slightly bigger".
     */
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">`
      // Needle: a triangle whose apex IS the hotspot, so they cannot drift.
      + `<path d="M3 3 L8.80 9.93 L9.93 8.80 Z" fill="${metal}"/>`
      // Collar: the chromed band where needle meets barrel.
      + `<path d="M10.35 8.37 L8.37 10.35 L11.06 13.04 L13.04 11.06 Z" fill="${metal}"/>`
      // Barrel: fattest at the guard (4.6 wide), tapering to the boot (3.5).
      + `<path d="M13.68 10.42 L10.42 13.68 L17.67 20.15 L20.15 17.67 Z" fill="${ink}"`
      + ` stroke="${ink}" stroke-width="1.1" stroke-linejoin="round"/>`
      // Finger guard: a ridge across the barrel, perpendicular to the axis.
      + `<path d="M15.16 12.62 L12.62 15.16" stroke="${metal}" stroke-width="1.3"`
      + ` stroke-linecap="round" opacity="0.75"/>`
      // Lead, running out along the same axis to the far corner.
      + `<path d="M18.91 18.91 L29.87 29.87" stroke="${ink}" stroke-width="2.4"`
      + ` stroke-linecap="round"/>`
      + `</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 3 3, ${FALLBACK}`;
  } catch {
    return FALLBACK;
  }
}

/**
 * The kraft tag as a CSS `cursor` value for Canvas.tsx's label tool.
 *
 * The card's short pointed attachment end, not its visual centre or eyelet,
 * is the hotspot. A label therefore starts at the point the cursor visibly
 * touches, exactly as a probe starts at its needle tip. The art is authored in
 * the same fixed device-pixel box as `probeCursor()`: canvas zoom transforms
 * world geometry behind the pointer, never the cursor bitmap, so placement is
 * stable at every supported zoom.
 */
export function tagCursor(): string {
  const FALLBACK = "crosshair";
  if (typeof document === "undefined" || !document.documentElement) return FALLBACK;
  try {
    const style = getComputedStyle(document.documentElement);
    const ink = style.getPropertyValue("--tool-tag-ink").trim();
    const metal = style.getPropertyValue("--tool-steel-ink").trim();
    if (!ink || !metal) return FALLBACK;

    /*
     * 1:1 device-pixel art in a shared box. The attachment point is the first
     * path coordinate and the cursor declaration below repeats that exact
     * coordinate as its hotspot. `TAG_CURSOR_ART` also positions Canvas's
     * snapped preview, so browser and in-canvas representations cannot drift.
     */
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${TAG_CURSOR_ART.width}" height="${TAG_CURSOR_ART.height}" viewBox="0 0 ${TAG_CURSOR_ART.width} ${TAG_CURSOR_ART.height}" fill="none">`
      // The left point is the short attachment end and therefore the hotspot.
      + `<path d="${TAG_CURSOR_BODY_PATH}" fill="${ink}"/>`
      // Steel eyelet confirms that this is a tag rather than a generic arrow.
      + `<circle cx="${TAG_CURSOR_EYELET.cx}" cy="${TAG_CURSOR_EYELET.cy}" r="${TAG_CURSOR_EYELET.r}" fill="${metal}"/>`
      + `</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${TAG_CURSOR_ART.hotspot.x} ${TAG_CURSOR_ART.hotspot.y}, ${FALLBACK}`;
  } catch {
    return FALLBACK;
  }
}
