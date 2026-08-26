/**
 * EveryCircuit-like animated current-flow dots on schematic wires, driven only
 * by a real current map (OP MNA + derived R, or a `.tran` sample).
 *
 * ## Why this draws a dashed stroke instead of moving circles
 *
 * It used to own a `requestAnimationFrame` loop that recomputed every dot's
 * position and pushed the result through `useState`. That coupled the motion to
 * React's render cycle, and the coupling did not merely cost frames — it stopped
 * the animation dead. `Canvas.tsx` rebuilds the currents/terminals Maps on every
 * schematic-readout publish, the readout publishes thirty times a second while
 * Current Mode is on, and those Maps were effect dependencies. So the loop was
 * torn down and rebuilt ~30x/second, each rebuild reset the elapsed-time clock,
 * and the loop never survived the 33 ms its own cadence gate required before it
 * would advance the phase. Measured on the switched-divider fixture: the dots
 * travelled 3.4 px/s against an intended 46, repainting about six times a
 * second, while the app paid for thirty full field rebuilds and thirty React
 * reconciliations every second to render a still picture.
 *
 * A dash pattern inverts the whole arrangement. One stroked `<path>` per flow
 * segment, `stroke-dasharray` of a zero-length dash plus a gap and a round
 * linecap, is a train of dots along the wire; sliding `stroke-dashoffset` by one
 * gap moves the train by exactly one dot spacing and lands on an identical
 * picture, so a single linear keyframe loops seamlessly. That means:
 *
 * - **No JS runs per frame.** The compositor animates it, at the display's own
 *   refresh rate rather than a hand-rolled 30 Hz gate that measured 20.3 Hz
 *   because its threshold sat exactly two vsync intervals apart.
 * - **The motion survives a busy main thread.** A React render storm elsewhere
 *   in the app no longer freezes the dots; that decoupling is the actual fix.
 * - **`prefers-reduced-motion` becomes declarative.** The old comment here said
 *   a media query could not help because the movement was a JS loop. It is not
 *   one any more, so honouring the preference is one property.
 *
 * `pathLength` is what lets every segment share one keyframe: a path that
 * declares its own length as its dot-gap count measures one gap as exactly 1
 * unit, so the dash pattern is `0 1` and the travel is 0 → -1 regardless of how
 * long the wire is. Speed is carried entirely by `animation-duration`.
 *
 * The numbers are unchanged. `flowStreamsForWires` runs the same
 * `segmentFlowCurrents` solve; nothing here invents or normalises a current.
 */
import { useMemo, useSyncExternalStore } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Live subscription to the OS reduced-motion preference. */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mq = window.matchMedia(REDUCED_MOTION_QUERY);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => typeof window !== "undefined" && Boolean(window.matchMedia?.(REDUCED_MOTION_QUERY).matches),
    () => false,
  );
}
import type { SchematicWire } from "../schematic/types";
import {
  flowSegments,
  flowStreamsForWires,
  type PinIndex,
  type TerminalCurrents,
} from "../simulation/wireCurrentFlow";

export function OpCurrentFlowLayer({
  currents,
  terminals,
  labelPoints,
  wires,
  pinIndex,
  active,
}: {
  /** Component-id → amps (a→b / MNA). Null/empty clears the layer. */
  currents: ReadonlyMap<string, number> | null;
  /** Per-terminal currents, so a transistor's base/emitter wires can animate. */
  terminals?: TerminalCurrents;
  /** Net-label anchors: boundaries where current leaves the drawn geometry. */
  labelPoints?: readonly { x: number; y: number }[];
  wires: SchematicWire[];
  pinIndex: PinIndex;
  /** When false, clear dots (no bias readout / empty current map). */
  active: boolean;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const live = active && currents && currents.size > 0 ? currents : null;

  // The structural split depends only on the drawing, so it survives every one
  // of the thirty readout publishes a second that a live scrub produces. It was
  // previously rebuilt on each of them, along with the union-find net solve —
  // together 72% of the per-frame cost, spent to redraw an unchanged picture.
  const segments = useMemo(() => flowSegments(wires, pinIndex), [wires, pinIndex]);

  const streams = useMemo(
    () => (live ? flowStreamsForWires(segments, pinIndex, live, terminals, labelPoints) : []),
    [segments, pinIndex, live, terminals, labelPoints],
  );

  if (streams.length === 0) return null;
  return (
    <g className="flow-layer" aria-hidden="true">
      {/* Direction markers first, so the moving dots read on top of them. */}
      {streams.map((stream) => (
        <path
          key={`arrow-${stream.id}`}
          className="flow-arrow"
          d="M -3.4 -3 L 3.4 0 L -3.4 3 Z"
          transform={`translate(${stream.arrow.x} ${stream.arrow.y}) rotate(${stream.arrow.angle})`}
          opacity={stream.arrow.opacity * 0.55}
        />
      ))}
      {streams.map((stream) => (
        <path
          key={stream.id}
          className="flow-dot"
          d={stream.d}
          // Declaring the path's length as its gap count makes one gap 1 unit,
          // which is what `stroke-dasharray: 0 1` and the shared keyframe below
          // are written against.
          pathLength={stream.dotGaps}
          style={{
            opacity: stream.opacity,
            // Reduced motion still draws the dots — hiding the reading would
            // punish the preference — but does not move them. Direction stays
            // legible from the arrowheads above.
            ...(reducedMotion
              ? { animation: "none" }
              : {
                  animationDuration: `${stream.periodSeconds.toFixed(3)}s`,
                  animationDirection: stream.direction > 0 ? "normal" : "reverse",
                }),
          }}
        />
      ))}
    </g>
  );
}
