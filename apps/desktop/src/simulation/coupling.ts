/**
 * Mutual-inductance (`K` coupling) support for the interim TS MNA solvers
 * (FEATURE_PARITY §3 coupled inductors `K` — the browser/test-engine half).
 *
 * The native ngspice deck already carries `K` directives verbatim
 * (`engine/couplingDirectives.ts`). This module is the analogous support for the
 * in-repo linear solvers (`acSweep`, `linearTransient`): it parses a document's
 * `K` directives into coupling specs and turns those, together with the circuit's
 * inductor set, into pairwise mutual-inductance terms the solvers stamp.
 *
 * Without it a coupled transformer simulates in the TS engine as independent,
 * uncoupled inductors (no voltage transfers between windings) — the wrong answer.
 *
 * Pure functions. A K line names inductors by their instance label and ends with
 * a coupling coefficient (possibly a braced parameter expression), e.g.
 * `K1 L1 L2 1`, `K3 L1 L2 .95`, the all-windings `K1 L1 L2 L3 L4 1`, or
 * `Kcup1 L2 L3 {Kcup}`. A line listing N inductors couples all C(N,2) pairs with
 * the same coefficient (SPICE/LTspice semantics).
 */

import { substituteBraces, EMPTY_SCOPE, type ParamScope } from "./paramScope";

/** A parsed `K` coupling line: the inductor labels it couples + the coefficient. */
export interface CouplingSpec {
  /** Inductor instance labels (original case as written; matched case-insensitively). */
  labels: string[];
  /** Coupling coefficient k (resolved; sign preserved, magnitude clamped to ≤1 at use). */
  k: number;
}

/** A directive is a `K` coupling line when its first token is `K` + a name. */
function isCouplingLine(line: string): boolean {
  return /^k\w+\s+\S/i.test(line.trim());
}

/**
 * Parse a document's `K` coupling directives into specs, resolving any braced
 * parameter coefficient against the supplied scope. Lines that are not coupling
 * lines, or that lack at least two inductors and a numeric coefficient, are
 * skipped. Multi-line TEXT blocks are split on LTspice's `\n` escape.
 */
export function parseCouplingSpecs(
  directives: ReadonlyArray<string>,
  params: ParamScope = EMPTY_SCOPE,
): CouplingSpec[] {
  const specs: CouplingSpec[] = [];
  for (const raw of directives) {
    for (const physical of raw.replace(/\\n/g, "\n").split("\n")) {
      const line = physical.trim();
      if (!line || !isCouplingLine(line)) continue;
      const toks = substituteBraces(line, params).replace(/\s+/g, " ").trim().split(" ");
      // K-name + ≥2 inductor labels + coefficient ⇒ at least 4 tokens.
      if (toks.length < 4) continue;
      const k = Number(toks[toks.length - 1]);
      if (!Number.isFinite(k)) continue;
      const labels = toks.slice(1, toks.length - 1);
      if (labels.length < 2) continue;
      specs.push({ labels, k });
    }
  }
  return specs;
}

/** A pairwise mutual-inductance term between two inductors in a solver's set. */
export interface MutualTerm {
  /** Index of the first inductor in the supplied array (a < b). */
  a: number;
  /** Index of the second inductor in the supplied array. */
  b: number;
  /** Mutual inductance M = k·√(La·Lb), Henries (sign from k). */
  m: number;
}

/** One inductor as the solver knows it: its instance label and inductance (H). */
export interface CoupledInductor {
  label: string;
  inductance: number;
}

/**
 * Build the pairwise mutual-inductance terms for a solver's inductor array given
 * the parsed coupling specs. Indices in the returned terms index `inductors`
 * directly (so a caller maps them to branch unknowns by adding its inductor
 * offset). A K line listing N inductors couples all C(N,2) pairs with the same
 * coefficient; the first spec to mention a given pair wins (later duplicates are
 * ignored). |k| is clamped to 1 — a physical coupling coefficient cannot exceed
 * unity, and k>1 makes the inductance matrix non-positive-definite (singular /
 * unstable solve). Labels not present among `inductors` are ignored.
 */
export function mutualTerms(
  inductors: ReadonlyArray<CoupledInductor>,
  specs: ReadonlyArray<CouplingSpec>,
): MutualTerm[] {
  if (inductors.length < 2 || specs.length === 0) return [];
  const indexByLabel = new Map<string, number>();
  inductors.forEach((l, i) => {
    // First inductor with a given label wins (labels should be unique anyway).
    const key = l.label.toLowerCase();
    if (!indexByLabel.has(key)) indexByLabel.set(key, i);
  });

  const terms: MutualTerm[] = [];
  const seen = new Set<string>();
  for (const spec of specs) {
    const k = Math.max(-1, Math.min(1, spec.k));
    if (k === 0) continue;
    const idxs: number[] = [];
    for (const label of spec.labels) {
      const idx = indexByLabel.get(label.toLowerCase());
      if (idx !== undefined && !idxs.includes(idx)) idxs.push(idx);
    }
    for (let p = 0; p < idxs.length; p += 1) {
      for (let q = p + 1; q < idxs.length; q += 1) {
        let a = idxs[p];
        let b = idxs[q];
        if (a > b) [a, b] = [b, a];
        const key = `${a}-${b}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const m = k * Math.sqrt(inductors[a].inductance * inductors[b].inductance);
        if (m !== 0) terms.push({ a, b, m });
      }
    }
  }
  return terms;
}
