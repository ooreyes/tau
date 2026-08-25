/**
 * The schematic editor's diagnostics strip, moved out of ShellPanels.tsx.
 *
 * Filed under `drawer/` rather than `shell/` because that is where it is
 * going: REDESIGN.md stage 4 folds `BottomPanel`, `TelemetryDock` and the
 * analysis panel's chrome into one bottom drawer with four tabs, and this
 * becomes its Errors tab. Moving it now, with no change to what it renders,
 * keeps that stage's diff about the drawer rather than about relocation.
 *
 * Its `role="region"` and "Simulation diagnostics" accessible name are part
 * of the frozen shell contract and must survive the fold.
 */
import { Fragment, useEffect, useState } from "react";
import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleX,
  LoaderCircle,
  Minus,
  TriangleAlert,
} from "lucide-react";
import type { RunOutcome } from "../../App";
import type { DiagnosticFocusTarget, LiveDiagnostic } from "../../schematic/documentValidation";
import {
  diagnosticsSuppressedCount,
  diagnosticsVisibleCount,
  useDiagnosticsSeverityPolicy,
  type DiagnosticsSeverityPolicy,
} from "../../lib/diagnosticsHealth";
import "../../styles/diagnosticsResults.css";

/** Treat formatting-only engine/live wording changes as one diagnosis.
 * Engine output is authoritative and rendered first, so the document row is
 * the one suppressed when the two say the same thing. Exported for shells
 * that maintain their own badge count alongside this panel. */
export function diagnosticMessageKey(message: string): string {
  return message.trim().replace(/\s+/g, " ").replace(/[A-Z]/g, (letter) =>
    String.fromCharCode(letter.charCodeAt(0) + 32));
}

/**
 * Where a row came from, which is the closest thing this app has to a
 * compiler's "syntax vs semantics" split (the standing PDF-5 item 17).
 *
 * - `run`     - the engine's own output for the analysis that just ran.
 * - `import`  - what reading the file reported, before any run.
 * - `circuit` - the live document linter, recomputed as the schematic is edited.
 *
 * It is rendered, not just recorded: "R2 shorted by wire" means something
 * different coming back from ngspice than it does from a linter that has not
 * simulated anything.
 */
export type DiagnosticOrigin = "run" | "import" | "circuit";

/** One line of the problem list, with its severity already decided. */
export interface DiagnosticRow {
  /** Stable within a render pass; used as the React key. */
  id: string;
  /**
   * `error` means the deck will not run, and nothing else may claim it - the
   * whole traffic light hangs off this field.
   */
  severity: "error" | "warning";
  message: string;
  origin: DiagnosticOrigin;
  /** The live diagnostic behind this row, when there is one. */
  issue?: LiveDiagnostic;
  /**
   * The run's own failure message, which is the one row that should interrupt a
   * screen reader: it describes something that just happened. Live linter rows
   * deliberately do not, or every keystroke would interrupt.
   */
  announce?: boolean;
}

export interface MergedDiagnostics {
  /** Engine/import messages that do not have a structured live counterpart. */
  messages: string[];
  /** One live row per normalized diagnosis, retaining its focus metadata. */
  liveIssues: LiveDiagnostic[];
  /** Live rows whose underlying engine result was a hard failure. */
  liveErrorKeys: Set<string>;
  /**
   * Every row, errors first, then warnings, each side in producer order.
   *
   * Added for PDF-6 item 6 so the severity split has exactly one owner. Before
   * this, the panel re-derived "is this row an error?" inline while App counted
   * rows without asking - which is how a red badge could open a window with
   * nothing red in it.
   */
  rows: DiagnosticRow[];
  /** Rows that stop the simulation. Drives red, and only red. */
  errorCount: number;
  /** Advisory rows. Never enough for red, however many there are. */
  warningCount: number;
  /** `errorCount + warningCount`; unchanged from before `rows` existed. */
  count: number;
  hasError: boolean;
}

/**
 * Merge engine/import strings with structured document diagnostics once. The
 * live row wins on a duplicate because it carries component/net focus; the
 * engine failure still marks that row as an error through `liveErrorKeys`.
 * App's badge and BottomPanel both consume this exact result so their counts
 * cannot drift.
 */
export function mergeDiagnostics(
  result: RunOutcome | null,
  notices: readonly string[] = [],
  issues: readonly LiveDiagnostic[] = [],
  isRunning = false,
): MergedDiagnostics {
  if (isRunning) {
    return {
      messages: [], liveIssues: [], liveErrorKeys: new Set(),
      rows: [], errorCount: 0, warningCount: 0, count: 0, hasError: false,
    };
  }
  // Carried as tuples rather than bare strings so a row can say where it came
  // from without re-guessing later by comparing prose against `result.message`.
  const rawMessages: { message: string; origin: DiagnosticOrigin; isFailure: boolean }[] = [
    ...(result && !result.ok && result.message
      ? [{ message: result.message, origin: "run" as const, isFailure: true }]
      : []),
    ...(result?.warnings ?? []).map((message) => ({
      message, origin: "run" as const, isFailure: false,
    })),
    ...notices.map((message) => ({ message, origin: "import" as const, isFailure: false })),
  ];
  const messages: string[] = [];
  const messageOrigins = new Map<string, { origin: DiagnosticOrigin; isFailure: boolean }>();
  const messageKeys = new Set<string>();
  for (const entry of rawMessages) {
    const key = diagnosticMessageKey(entry.message);
    if (!key || messageKeys.has(key)) continue;
    messageKeys.add(key);
    messages.push(entry.message);
    messageOrigins.set(key, { origin: entry.origin, isFailure: entry.isFailure });
  }

  const liveIssues: LiveDiagnostic[] = [];
  const liveByKey = new Map<string, LiveDiagnostic>();
  for (const issue of issues) {
    const key = diagnosticMessageKey(issue.message);
    if (!key) continue;
    const previous = liveByKey.get(key);
    if (previous) {
      // Keep the first stable row/id, but do not throw away a richer focus
      // target when another producer supplied it.
      const merged = {
        ...previous,
        ...(previous.componentId || !issue.componentId ? {} : { componentId: issue.componentId }),
        ...(previous.reference || !issue.reference ? {} : { reference: issue.reference }),
        ...(previous.net || !issue.net ? {} : { net: issue.net }),
        ...(previous.focus || !issue.focus ? {} : { focus: issue.focus }),
      };
      liveByKey.set(key, merged);
      const rowIndex = liveIssues.findIndex((candidate) => diagnosticMessageKey(candidate.message) === key);
      if (rowIndex >= 0) liveIssues[rowIndex] = merged;
      continue;
    }
    liveByKey.set(key, issue);
    liveIssues.push(issue);
  }
  const liveKeys = new Set(liveByKey.keys());
  const visibleMessages = messages.filter((message) => !liveKeys.has(diagnosticMessageKey(message)));
  const liveErrorKeys = new Set<string>();
  if (result && !result.ok && result.message) {
    const failureKey = diagnosticMessageKey(result.message);
    if (liveKeys.has(failureKey)) liveErrorKeys.add(failureKey);
  }
  for (const issue of liveIssues) {
    if (issue.severity === "error") liveErrorKeys.add(diagnosticMessageKey(issue.message));
  }

  /**
   * One pass to decide severity, then a stable partition so errors come first.
   *
   * The order within each half is the producer's: the run's failure, then its
   * warnings, then the import's, then the live linter's. That keeps the engine's
   * own verdict at the top of the list - where it was before this function grew
   * a row model - and keeps the list from reshuffling under the reader as the
   * live linter re-runs on every edit.
   */
  const errorRows: DiagnosticRow[] = [];
  const warningRows: DiagnosticRow[] = [];
  visibleMessages.forEach((message, index) => {
    const key = diagnosticMessageKey(message);
    const source = messageOrigins.get(key);
    const isFailure = Boolean(source?.isFailure);
    (isFailure ? errorRows : warningRows).push({
      id: `message:${key}:${index}`,
      severity: isFailure ? "error" : "warning",
      message,
      origin: source?.origin ?? "run",
      ...(isFailure ? { announce: true } : {}),
    });
  });
  for (const issue of liveIssues) {
    const isError = issue.severity === "error"
      || liveErrorKeys.has(diagnosticMessageKey(issue.message));
    (isError ? errorRows : warningRows).push({
      id: issue.id,
      severity: isError ? "error" : "warning",
      message: issue.message,
      origin: "circuit",
      issue,
    });
  }
  const rows = [...errorRows, ...warningRows];

  return {
    messages: visibleMessages,
    liveIssues,
    liveErrorKeys,
    rows,
    errorCount: errorRows.length,
    warningCount: warningRows.length,
    count: visibleMessages.length + liveIssues.length,
    hasError: Boolean(result && !result.ok) || liveErrorKeys.size > 0,
  };
}

function focusTargetFor(issue: LiveDiagnostic): DiagnosticFocusTarget | undefined {
  if (issue.focus) return issue.focus;
  if (issue.componentId) {
    const reference = issue.reference ?? issue.componentId;
    return { kind: "component", componentId: issue.componentId, reference };
  }
  if (issue.net) {
    return {
      kind: "net",
      netId: issue.net.id,
      x: issue.net.x,
      y: issue.net.y,
      ...(issue.net.label ? { label: issue.net.label } : {}),
    };
  }
  return undefined;
}

function focusActionLabel(target: DiagnosticFocusTarget): string {
  return target.kind === "component"
    ? `Focus ${target.reference}`
    : `Focus net ${target.label ?? target.netId}`;
}

const ORIGIN_LABEL: Record<DiagnosticOrigin, string> = {
  run: "Run",
  import: "Import",
  circuit: "Circuit",
};

/**
 * The "where" a compiler puts after the colon, in the terms this app has.
 *
 * A file and a line number do not exist here, so the most specific true answer
 * is the part or the net; failing that, which stage reported it. Never blank,
 * because a problem list where some rows say where they are and others say
 * nothing reads as broken rather than as terse.
 */
function rowLocation(row: DiagnosticRow): string {
  const target = row.issue ? focusTargetFor(row.issue) : undefined;
  if (target?.kind === "component") return target.reference;
  if (target?.kind === "net") return `net ${target.label ?? target.netId}`;
  if (row.issue?.reference) return row.issue.reference;
  return ORIGIN_LABEL[row.origin];
}

/** A short situation title turns raw engine prose into a glanceable card. */
export function diagnosticSituationTitle(row: DiagnosticRow): string {
  const message = row.message.trim();
  if (/timestep too small|singular matrix|convergence/i.test(message)) {
    return "The solver could not complete the analysis";
  }
  if (/no ground|ground reference/i.test(message)) {
    return "The circuit has no ground reference";
  }
  if (/model .*not found|missing .*model|unknown model/i.test(message)) {
    return "A device model is missing";
  }
  if (/subcircuit.*not imported|unresolved subcircuit|unknown subckt/i.test(message)) {
    return "A referenced subcircuit is unavailable";
  }
  if (/project hierarchy|sheet .*linked|linked .*sheet/i.test(message)) {
    return "The project hierarchy needs attention";
  }
  const subject = row.issue?.reference ?? row.issue?.net?.label;
  if (subject) return `${subject} needs attention`;
  const sentence = message.split(/[.!?](?:\s|$)/, 1)[0]?.trim() || "The circuit needs attention";
  const concise = sentence.length > 72 ? `${sentence.slice(0, 69).trimEnd()}…` : sentence;
  // Keep the source wording recognizable without repeating it verbatim in the
  // collapsed card and technical disclosure.
  return concise.endsWith(".") ? `${concise} Review required` : `${concise}.`;
}

/** One concrete next step keeps a diagnostic from becoming a dead-end card. */
export function diagnosticNextStep(row: DiagnosticRow): string {
  const target = row.issue ? focusTargetFor(row.issue) : undefined;
  if (target?.kind === "component") return `Inspect ${target.reference}.`;
  if (target?.kind === "net") return `Inspect net ${target.label ?? target.netId}.`;
  if (/no ground|ground reference/i.test(row.message)) {
    return "Add a ground reference, then run again.";
  }
  if (/timestep too small|singular matrix|convergence/i.test(row.message)) {
    return "Check the affected source and component values, then run again.";
  }
  return "Review the reported source, then run again.";
}

export function BottomPanel({
  result,
  isRunning = false,
  notices = [],
  issues = [],
  onSelectComponent,
  onFocusDiagnostic,
  open,
  onOpenChange,
  severityPolicy,
}: {
  mode?: "schematic" | "simulator";
  /**
   * The last run's outcome, whichever analysis produced it.
   *
   * Typed as the shape all seven share rather than as `AnalysisResult`: this
   * used to take the transient specifically, so a failed AC sweep or noise run
   * left the Errors tab reporting "No issues" next to its own failure. Nothing
   * here ever needed more than `ok`, the message and the warnings.
   */
  result: RunOutcome | null;
  isRunning?: boolean;
  /** Document-level warnings independent of a run (e.g. ASC import warnings -
   *  previously console-only, so "Opened with 2 warning(s)" was a dead end). */
  notices?: string[];
  /**
   * What is wrong with the DOCUMENT, recomputed live as it is edited (P3-14).
   *
   * Everything above describes a run that has already happened, which is why
   * this panel read "No analysis yet" over a schematic with no ground, no
   * source and two stranded terminals. These rows need no run at all.
   *
   * Additive by design, and that is a constraint rather than a preference:
   * `ShellPanels.test.tsx` renders this component prop-less and pins its markup
   * class by class, so every state expression below has to collapse to exactly
   * its previous value when this array is empty.
   */
  issues?: readonly LiveDiagnostic[];
  /** Click-through for a row that names a part: the row selects it on the
   *  canvas. Rows with no `componentId` (no ground, no source) stay inert. */
  onSelectComponent?: (componentId: string) => void;
  /** Rich focus seam for component and net rows. The editor shell owns the
   * actual select/pan action; keeping this callback data-only avoids a drawer
   * dependency on Canvas. `onSelectComponent` remains the compatibility
   * fallback while callers migrate. */
  onFocusDiagnostic?: (target: DiagnosticFocusTarget) => void;
  /**
   * Controlled disclosure, so the rail's `!` button is the authority the report
   * asks for: "when selected will bring up the error window below. If clicked
   * again it should hide it."
   *
   * Optional, and that is load-bearing. `ShellPanels.test.tsx` and the results
   * drawer both render this component with neither prop, and the uncontrolled
   * behaviour below (auto-open on a new diagnosis, collapse when clear) is what
   * they still get. Pass `open` and the shell owns the state instead; the
   * internal header toggle then reports through `onOpenChange` rather than
   * mutating a second copy, so the two affordances cannot disagree.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Overrides the user's stored severity policy. Only tests and previews should
   * pass this: left alone, this panel and every other reader subscribe to the
   * same store, which is what stops the badge and the window from disagreeing
   * about how many rows there are.
   */
  severityPolicy?: DiagnosticsSeverityPolicy;
}) {
  const merged = mergeDiagnostics(result, notices, issues, isRunning);
  const storedPolicy = useDiagnosticsSeverityPolicy();
  const policy = severityPolicy ?? storedPolicy;
  // Errors are never filtered - the policy only decides whether warnings
  // register at all, which is the whole of "remove warning and just have red or
  // green" in the report.
  const rows = policy === "errors-only"
    ? merged.rows.filter((row) => row.severity === "error")
    : merged.rows;
  const visibleCount = diagnosticsVisibleCount(merged, policy);
  const suppressedCount = diagnosticsSuppressedCount(merged, policy);
  const hasIssues = visibleCount > 0;
  const hasError = merged.hasError;
  // Import notices must surface even before the first run - "idle" only when
  // there is genuinely nothing to show.
  const isIdle = !isRunning && result === null && !hasIssues;
  const isClean = !isRunning && Boolean(result?.ok) && !hasIssues;
  const issueSignature = rows.map((row) => row.message).join("\u0000");
  const [uncontrolledOpen, setUncontrolledOpen] = useState(hasIssues);
  const isControlled = open !== undefined;

  // New issues must never remain hidden; returning to all-clear collapses the
  // panel back to its quiet one-line status rather than keeping empty chrome.
  // Skipped when the shell drives `open`: a component that accepts a value and
  // then overwrites it on its own schedule is not controlled, and the rail
  // button would appear to un-press itself the moment a row changed.
  useEffect(() => {
    if (isControlled) return;
    setUncontrolledOpen(Boolean(issueSignature));
  }, [isControlled, issueSignature]);

  const setOpen = (next: boolean) => {
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  // `open ?? uncontrolledOpen` rather than a branch on `isControlled`: the two
  // are the same condition, and one expression cannot drift from the other.
  const panelExpanded = hasIssues && (open ?? uncontrolledOpen);

  return (
    <section
      className={`bottom-panel${isRunning ? " is-running" : ""}${hasIssues ? " has-issues" : ""}${hasError ? " has-error" : ""}${hasIssues && !hasError ? " has-warning" : ""}${isClean ? " is-clean" : ""}${isIdle ? " is-idle" : ""}${panelExpanded ? "" : " is-collapsed"}`}
      aria-label="Simulation diagnostics"
    >
      {isRunning || isIdle || isClean ? (
        <div className="bottom-panel-head bottom-panel-head--static">
          <span className="bottom-panel-state" aria-hidden="true">
            {isRunning
              ? <LoaderCircle size={12} strokeWidth={1.8} aria-hidden="true" />
              : isIdle
                ? <Minus size={12} strokeWidth={1.8} aria-hidden="true" />
                : <CircleCheck size={12} strokeWidth={1.8} aria-hidden="true" />}
          </span>
          <span className="bottom-panel-title">Diagnostics</span>
          <span className="bottom-panel-clear" role="status">
            {/* The suppressed-count branch outranks both all-clear strings:
                "No issues" (or "No analysis yet") would be a lie when the
                policy is the only reason the list is empty. The light is still
                green, which is what the user asked for; what it must not do is
                pretend the warnings were never found. */}
            {isRunning
              ? "Running"
              : suppressedCount > 0
                ? `No errors · ${suppressedCount} ${suppressedCount === 1 ? "warning" : "warnings"} hidden`
                : isIdle
                  ? "No analysis yet"
                  : "No issues"}
          </span>
        </div>
      ) : (
        <button
          type="button"
          className="bottom-panel-head"
          aria-expanded={panelExpanded}
          onClick={() => setOpen(!panelExpanded)}
        >
          <ChevronDown className="bottom-panel-chevron" size={13} strokeWidth={1.8} aria-hidden="true" />
          <span className="bottom-panel-state" aria-hidden="true">
            {hasError
              ? <CircleX size={12} strokeWidth={1.8} aria-hidden="true" />
              : <TriangleAlert size={12} strokeWidth={1.8} aria-hidden="true" />}
          </span>
          <span className="bottom-panel-title">{hasError ? "Errors" : "Warnings"}</span>
          <span
            className={`bottom-panel-count${hasError ? "" : " warnings-only"}`}
            aria-live="polite"
          >
            {visibleCount}
          </span>
          {suppressedCount > 0 && (
            <span className="bottom-panel-suppressed">
              {suppressedCount} {suppressedCount === 1 ? "warning" : "warnings"} hidden
            </span>
          )}
        </button>
      )}
      {panelExpanded && <div className="bottom-errors">
        {/* One list, errors first, built from `merged.rows` rather than from two
            separate arrays. That ordering is decided in `mergeDiagnostics` so the
            count and the list are derived from the same partition - a red badge
            can no longer open a window with nothing red in it. */}
        {rows.map((row) => {
          const isError = row.severity === "error";
          const title = diagnosticSituationTitle(row);
          const nextStep = diagnosticNextStep(row);
          const Icon = isError ? CircleAlert : TriangleAlert;
          const technicalDetails = (
            <details className={`bottom-error-details bottom-error-details--${row.severity}`}>
              <summary>Technical details</summary>
              <code className="bottom-error-message">{row.message}</code>
            </details>
          );
          const body = (
            <>
              <span className="bottom-error-glyph" aria-hidden="true">
                <Icon size={12} strokeWidth={1.8} aria-hidden="true" />
              </span>
              {/* Severity in words next to the glyph, because the colour is not
                  allowed to be the only carrier (DESIGN_SYSTEM.md) and because a
                  problem list the reader has to decode by hue is not a problem
                  list. Errors say so; warnings say so. */}
              <span className="bottom-error-severity">{isError ? "Error" : "Warning"}</span>
              <span className="bottom-error-title">{title}</span>
              {/* Where, in the terms this app has: the part, the net, or the
                  stage that reported it. A compiler's `file:line`. */}
              <span className="bottom-error-where mono-num">{rowLocation(row)}</span>
              <span className="bottom-error-next-step">Next: {nextStep}</span>
            </>
          );
          const target = row.issue ? focusTargetFor(row.issue) : undefined;
          const actionLabel = target ? focusActionLabel(target) : undefined;
          // A row with an explicit target is a button, so it is reachable by
          // keyboard and announces what it will focus. Document-level rows
          // (no ground, no source) stay plain text rather than buttons that
          // would do nothing when pressed. The old component callback still
          // works for callers that have not installed the richer focus seam.
          const onClick = target && onFocusDiagnostic
            ? () => onFocusDiagnostic(target)
            : target?.kind === "component" && onSelectComponent
              ? () => onSelectComponent(target.componentId)
              : undefined;
          if (onClick) {
            return (
              <Fragment
                key={row.id}
              >
                <button
                  type="button"
                  className={`${isError ? "error" : "warning"} bottom-error-row bottom-error-row--actionable`}
                  aria-label={`${actionLabel}: ${row.message}`}
                  title={actionLabel}
                  onClick={onClick}
                >
                  {body}
                </button>
                {technicalDetails}
              </Fragment>
            );
          }
          return (
            <div
              key={row.id}
              className={`${isError ? "error" : "warning"} bottom-error-row`}
              // Only the run's own failure interrupts a screen reader. The live
              // linter re-runs on every keystroke, and an alert per keystroke is
              // hostile; that row is read when the user reaches it instead.
              role={row.announce ? "alert" : undefined}
            >
              {body}
              {technicalDetails}
            </div>
          );
        })}
      </div>}
    </section>
  );
}

/**
 * The ideal model this part will really run, reproducing the deck's own
 * precedence: a `.model` this schematic defines under the same name beats the
 * ideal part, because the user named a card (`spiceNetlist.ts`, the
 * diode/led/zener case, which reads `definedModelNames` from the directives).
 * Returns null whenever the part takes the real path, so the panel can never
 * call something ideal that the engine will not run as ideal.
 */
