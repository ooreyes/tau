/**
 * Decide which analysis (if any) an assistant-confirmed circuit's directives
 * request, so App.tsx's confirm handlers can auto-start it - the flow is
 * "ask -> confirm -> data appears" instead of leaving the run to be
 * configured by hand.
 *
 * Pure decision logic only - no engine calls, no React state. The actual run
 * (pre-run guards, abort, progress, dashboards) stays in App.tsx's existing
 * per-mode run callbacks; this module only picks which one to invoke.
 */
import { analysesFromDirectives, type DirectiveAnalyses } from "../io/directiveAnalysis";

/** Analysis kinds App.tsx already exposes a dedicated run callback for. */
export type AutoRunAnalysisKind = "tran" | "ac" | "dc" | "tf" | "noise" | "op";

export interface AutoRunAnalysis {
  kind: AutoRunAnalysisKind;
  /** The raw directive line that triggered this pick, for the "Running …" notice. */
  directive: string;
}

// Keyword sniff used only to recover *document order* across kinds -
// analysesFromDirectives (below) keeps just the first successfully-parsed
// value per kind, discarding which line it came from and how that line
// compares against other kinds' lines. Order here otherwise mirrors
// DirectiveAnalyses's fields; `.four`/`.temp` have no dedicated run callback
// in App.tsx so they're intentionally not candidates.
const KIND_KEYWORDS: ReadonlyArray<{ kind: Exclude<AutoRunAnalysisKind, "op">; pattern: RegExp }> = [
  { kind: "tran", pattern: /^[.!]?tran\b/i },
  { kind: "ac", pattern: /^[.!]?ac\b/i },
  { kind: "dc", pattern: /^[.!]?dc\b/i },
  { kind: "tf", pattern: /^[.!]?tf\b/i },
  { kind: "noise", pattern: /^[.!]?noise\b/i },
];

/**
 * Scan `directives` in document order and return the first line whose
 * keyword names a recognized, successfully-parsed analysis - "first
 * recognized analysis directive wins". `null` when nothing in the document
 * requests a runnable analysis.
 *
 * Edge case: if the *same* kind appears twice with the first occurrence
 * malformed and a later one valid, `analysesFromDirectives` still resolves
 * the kind (from the later, valid line), but this returns the first line's
 * (malformed) text for the notice. Duplicate directives of the same kind are
 * not a realistic assistant output, so a second parse pass to disambiguate
 * isn't worth the added coupling here.
 */
export function pickAutoRunAnalysis(directives: string[]): AutoRunAnalysis | null {
  const analyses: DirectiveAnalyses = analysesFromDirectives(directives);
  for (const raw of directives) {
    const directive = raw.trim();
    const match = KIND_KEYWORDS.find(({ pattern }) => pattern.test(directive));
    if (match && analyses[match.kind] !== undefined) {
      return { kind: match.kind, directive };
    }
    // .op has no analysesFromDirectives entry (it takes no arguments), but
    // App.tsx does expose a dedicated operating-point run callback for it.
    if (/^[.!]?op\b/i.test(directive)) return { kind: "op", directive };
  }
  return null;
}
