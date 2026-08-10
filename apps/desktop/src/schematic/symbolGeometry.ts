/**
 * The numbers a symbol's terminals live on, with no artwork attached.
 *
 * `pins.ts` and `symbols.tsx` are two readings of one geometry - where a
 * terminal sits and where the lead that reaches it is drawn have to agree, or
 * a wire lands a few pixels off the thing it looks connected to. That shared
 * truth used to live in `symbols.tsx` and `pins.ts` imported it from there,
 * which quietly made every consumer of the pin table a consumer of a React
 * module: `netlist.ts` needs `getComponentPins`, so extracting a netlist
 * dragged in the entire SVG symbol library and, transitively, React.
 *
 * That was merely wasteful until the preview solvers moved into a Web Worker.
 * A worker has no `window`, and Vite's dev-mode React Fast Refresh runtime -
 * which `@vitejs/plugin-react` appends to every `.tsx` module it sees -
 * dereferences `window` at module scope. The worker's very first import chain
 * therefore threw `ReferenceError: window is not defined` before a single
 * matrix was stamped, and because the pool is designed to degrade quietly to
 * the main thread, it did exactly that: no error, no worker, no benefit, in
 * every dev session. Only a production build (no Fast Refresh) would have
 * worked, which is the worst possible split.
 *
 * So the shared geometry lives here, in a module with no JSX and no UI
 * dependency, and `symbols.tsx` re-exports every name it used to own so no
 * existing import site had to move. The rule this file encodes: **the
 * simulation layer may depend on geometry, never on artwork.**
 */

/** World pixels per grid cell. Components span a few cells; pins land on grid. */
export const GRID = 16;

/**
 * Shared independent-source pin extent. DC (vsource), AC (vac), pulse, and
 * current sources MUST use the same pin extent so they snap onto the same grid
 * lines and read as the same size side-by-side. LTspice `voltage.asy` puts its
 * pins 80 apart; Tau keeps them on the 16-unit grid at ±`SOURCE_PIN_Y`.
 */
export const SOURCE_PIN_Y = 32;

/**
 * The natively placed gate's single output row: the body centreline, which is
 * where the nose points and where a one-input buffer's own input already sits.
 */
export const GATE_OUT_Y = 0;

/**
 * Rows LTspice's complementary output PAIR sits on (`Q` above, `_Q` below).
 *
 * Only an imported `.asy` has both, and only it is drawn with them. This is
 * also the body's minimum vertical reach, so a one-input gate keeps the same
 * nose as a two-input one instead of collapsing to a 16-unit blob.
 */
export const GATE_PAIR_Y = 16;

/** Row the `com` reference sits on, whatever the gate's height. */
export const GATE_COM_Y = 32;

/** Where a short gate's reference drops from the floor. The floor runs from the
 *  back to `GATE_NOSE_TIP_X - halfHeight`, so x = 0 would hang off the end of a
 *  tall gate's floor; -16 is on the grid and on the floor of a short one. */
const GATE_COM_FLOOR_X = -16;

/**
 * Input rows for an N-input gate: symmetric about the body centre, every row on
 * a multiple of {@link GRID}.
 *
 * At a 16-unit pitch an even bank would straddle the centre at ±8, which is off
 * the connection grid, so an even bank skips the centre row instead — the
 * classic gate layout, and the same "keep every terminal on the grid" rule
 * `subcircuitGeometry.verticalOffsets` applies to a subcircuit's pin bank.
 */
export function gateInputRows(inputs: number): number[] {
  const count = Math.max(1, Math.round(inputs));
  if (count === 1) return [0];
  const even = count % 2 === 0;
  return Array.from({ length: count }, (_, index) => {
    const step = index - (count - 1) / 2;
    return (even ? (step > 0 ? Math.ceil(step) : Math.floor(step)) : step) * GRID;
  });
}

/** Body half-height: enough to clear the input bank and LTspice's output pair. */
export function gateBodyHalfHeight(inputs: number): number {
  const reach = Math.max(GATE_PAIR_Y, ...gateInputRows(inputs).map(Math.abs));
  return reach + 8;
}

/**
 * Where the `com` reference terminal sits — on an IMPORTED gate only.
 *
 * A natively placed gate has no `com`: the deck refers every comparison and
 * every output to ground when the pin is absent, so the reference was a stub
 * off the bottom edge that read as a stray input and could not change any
 * result. What remains is the imported `.asy`, whose own symbol really does
 * carry the terminal, plus the kind's dictionary entry the importer maps
 * through (`schematic/pins.ts`).
 *
 * It follows the body, because the body grows with the input count and the
 * terminal has to stay on it AND inside the ±42 × ±40 preview. A short gate
 * (up to three inputs) drops its reference from the floor; a tall one has no
 * floor left under y = 32, so the reference leaves the nose on that row
 * instead. Both are on the 16 grid and both fit the preview - pinning the
 * reference at y = 48, as it was, put every gate 8 units outside it.
 */
export function gateComPoint(inputs: number): { x: number; y: number } {
  const half = gateBodyHalfHeight(inputs);
  return half > GATE_COM_Y
    ? { x: 32, y: GATE_COM_Y }
    : { x: GATE_COM_FLOOR_X, y: GATE_COM_Y };
}
