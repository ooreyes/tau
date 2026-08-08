/**
 * Y-axis limit entry for a scope pane.
 *
 * This replaces a two-field form with an "Apply Y" submit and an "Autoscale Y"
 * reset. Three things were wrong with that:
 *
 *  - **Apply was ceremony.** A scope has knobs, not forms. Typing a limit and
 *    then having to press a second control to mean it is a web-form habit.
 *  - **Autoscale duplicated Fit.** Every pane already carries a fit button in
 *    its zoom cluster, which is where a reader looks for it.
 *  - **"Enter both Y min and Y max" was a self-inflicted error.** Pinning only
 *    the top and letting the bottom follow the data is an ordinary thing to
 *    want; the all-or-nothing pair turned it into a failure.
 *
 * So: each edge commits on Enter or blur, and an empty field autoranges that
 * edge. The placeholder shows the value autorange is currently choosing, which
 * is what makes "empty means auto" legible without a word of explanation.
 */
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { parseManualYLimits, type ManualAxisLimits } from "../simulation/manualAxisLimits";

export function AxisLimitFields({
  label,
  value,
  autoBounds,
  disabled = false,
  validate,
  onChange,
}: {
  /** Names the pane in accessible labels, e.g. "transient" or "Bode magnitude". */
  label: string;
  value: ManualAxisLimits | null;
  /** What autorange currently picks, shown as the placeholder. */
  autoBounds: { min: number; max: number } | null;
  disabled?: boolean;
  /** Extra per-pane rule, e.g. a log axis rejecting non-positive limits. */
  validate?: (limits: ManualAxisLimits) => string | null;
  onChange: (limits: ManualAxisLimits | null) => void;
}) {
  const [minDraft, setMinDraft] = useState(value?.yMin?.toString() ?? "");
  const [maxDraft, setMaxDraft] = useState(value?.yMax?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);

  // Follow external resets (a fit button, a new run) without stamping on a
  // half-typed value.
  useEffect(() => {
    if (value === null) {
      setMinDraft("");
      setMaxDraft("");
      setError(null);
    }
  }, [value]);

  const commit = (nextMin: string, nextMax: string) => {
    const parsed = parseManualYLimits(nextMin, nextMax);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    const extra = parsed.limits && validate ? validate(parsed.limits) : null;
    if (extra) {
      setError(extra);
      return;
    }
    setError(null);
    onChange(parsed.limits);
  };

  const field = (
    which: "min" | "max",
    draft: string,
    setDraft: (v: string) => void,
    auto: number | undefined,
  ) => (
    <label className="axis-limit-field">
      {which === "min" ? "Ymin" : "Ymax"}
      <Input
        variant="mono"
        size="sm"
        className="w-20"
        value={draft}
        disabled={disabled}
        aria-label={`${label} Y ${which}`}
        // The placeholder is the autorange value, so an empty box reads as
        // "this edge is following the data" rather than as missing input.
        placeholder={auto !== undefined ? String(Number(auto.toPrecision(4))) : "auto"}
        onChange={(e) => {
          setDraft(e.currentTarget.value);
          if (error) setError(null);
        }}
        onBlur={() => commit(which === "min" ? draft : minDraft, which === "max" ? draft : maxDraft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setDraft(which === "min" ? value?.yMin?.toString() ?? "" : value?.yMax?.toString() ?? "");
            setError(null);
          }
        }}
      />
    </label>
  );

  return (
    <>
      <div className="meter-row analysis-meter axis-limits" aria-label={`${label} Y limits`}>
        {field("min", minDraft, setMinDraft, autoBounds?.min)}
        {field("max", maxDraft, setMaxDraft, autoBounds?.max)}
        <span className="axis-limit-hint">empty = auto</span>
      </div>
      {error && <div className="expr-error" role="alert">{error}</div>}
    </>
  );
}
