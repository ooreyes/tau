import { useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  checkBehavioral,
  formatBehavioral,
  parseBehavioral,
  type BehavioralType,
} from "../simulation/behavioral";

/**
 * The behavioral source `B` used to reach the reader as one box labelled
 * "Value" holding `V=1`, with nothing in the app saying that the string is an
 * expression, which quantities it may mention, or that dropping the `V=` head
 * makes the run fail. This editor is the mode-plus-conditional-fields shape
 * `IndependentSourceEditor` established, with two additions the B source needs
 * and a waveform picker does not: the expression is judged against the engine's
 * own parser as it is typed, and the vocabulary is written down beside the box.
 *
 * Nothing here re-implements the grammar. `parseBehavioral` splits the stored
 * value, `formatBehavioral` puts it back together, and `checkBehavioral` is the
 * deck's own `behavioralSpecText` plus `expr.ts`'s parser.
 */

const OUTPUT_MODES: readonly { value: BehavioralType; label: string; meaning: string }[] = [
  {
    value: "V",
    label: "Voltage (V=)",
    meaning: "The expression is the voltage forced between the + and - pins, in volts, whatever current that takes.",
  },
  {
    value: "I",
    label: "Current (I=)",
    meaning: "The expression is the current in amps, flowing from the + pin through the source to the - pin, whatever voltage that takes.",
  },
];

/** What may appear in the expression. Each row is one thing to know. */
export const BEHAVIORAL_TERMS: readonly { token: string; meaning: string }[] = [
  { token: "V(a)", meaning: "voltage at node a, against ground" },
  { token: "V(a,b)", meaning: "voltage from node a to node b" },
  { token: "I(R1)", meaning: "current through the part labelled R1" },
  { token: "time", meaning: "seconds since the run started" },
  { token: "pi, e", meaning: "the usual constants" },
  { token: "1k, 4.7u", meaning: "SI suffixes, as everywhere else in Tau" },
  { token: "+ - * / **", meaning: "arithmetic, ** raises to a power" },
  { token: "> < >= <= == !=", meaning: "comparisons, worth 1 or 0" },
  { token: "if(c, a, b)", meaning: "a while c holds, b otherwise" },
];

/**
 * The functions the expression may call. `probe` is a call of that exact
 * signature over plain numbers: `behavioral.test.ts` evaluates every one of
 * them through the engine, so this list cannot drift into teaching a function
 * the engine does not have.
 */
export const BEHAVIORAL_FUNCTIONS: readonly { signature: string; probe: string }[] = [
  { signature: "abs(x)", probe: "abs(-2)" },
  { signature: "sqrt(x)", probe: "sqrt(4)" },
  { signature: "exp(x)", probe: "exp(1)" },
  { signature: "ln(x)", probe: "ln(2)" },
  { signature: "log10(x)", probe: "log10(10)" },
  { signature: "sin(x)", probe: "sin(1)" },
  { signature: "cos(x)", probe: "cos(1)" },
  { signature: "tan(x)", probe: "tan(1)" },
  { signature: "atan(x)", probe: "atan(1)" },
  { signature: "atan2(y, x)", probe: "atan2(1, 2)" },
  { signature: "tanh(x)", probe: "tanh(1)" },
  { signature: "floor(x)", probe: "floor(1.5)" },
  { signature: "ceil(x)", probe: "ceil(1.5)" },
  { signature: "round(x)", probe: "round(1.5)" },
  { signature: "sgn(x)", probe: "sgn(-3)" },
  { signature: "min(a, b)", probe: "min(1, 2)" },
  { signature: "max(a, b)", probe: "max(1, 2)" },
  { signature: "pow(x, y)", probe: "pow(2, 3)" },
  { signature: "limit(x, lo, hi)", probe: "limit(9, 0, 5)" },
  { signature: "uramp(x)", probe: "uramp(-1)" },
  { signature: "table(x, x1, y1, ...)", probe: "table(1, 0, 0, 2, 4)" },
];

/** Whole expressions worth starting from. Each is proved valid by the tests. */
export const BEHAVIORAL_EXAMPLES: readonly { expr: string; what: string }[] = [
  { expr: "V(a)-V(b)", what: "Difference of two nodes" },
  { expr: "10*V(in)", what: "Gain of ten" },
  { expr: "V(a)*V(b)", what: "Multiplier" },
  { expr: "if(V(in)>2.5, 5, 0)", what: "Comparator against 2.5 V" },
  { expr: "sin(2*pi*1k*time)", what: "1 kHz oscillator" },
  { expr: "I(R1)*100", what: "100 V for every amp in R1" },
];

export function BehavioralSourceEditor({
  value,
  onBeginChange,
  onValueChange,
}: {
  value: string;
  onBeginChange: (key: string) => void;
  onValueChange: (value: string) => void;
}) {
  const [referenceOpen, setReferenceOpen] = useState(false);
  const { type, expr } = parseBehavioral(value);
  const mode = OUTPUT_MODES.find((option) => option.value === type) ?? OUTPUT_MODES[0];
  const check = checkBehavioral(value);

  const commit = (key: string, nextType: BehavioralType, nextExpr: string) => {
    onBeginChange(key);
    onValueChange(formatBehavioral(nextType, nextExpr));
  };

  return (
    <div className="behavioral-editor">
      <label className="property-field">
        <span>Output</span>
        <Select
          value={type}
          onValueChange={(next) => commit("behavioral-type", next as BehavioralType, expr)}
        >
          <SelectTrigger
            size="sm"
            className="property-select mono-num w-full max-w-[168px]"
            aria-label="Behavioral output"
          >
            <SelectValue placeholder="Output" />
          </SelectTrigger>
          <SelectContent>
            {OUTPUT_MODES.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <p className="property-hint">{mode.meaning}</p>

      {/* The expression is the subject of this panel and routinely longer than
          the 168px a `.property-field` value column allows, so it gets its own
          stacked row rather than being clipped into the label grid. */}
      <label className="behavioral-expression">
        <span>Expression</span>
        <input
          className="mono-num"
          value={expr}
          aria-label="Expression"
          aria-invalid={check.ok ? undefined : true}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => commit("behavioral-expression", type, event.currentTarget.value)}
        />
      </label>
      {check.ok ? (
        <p className="property-hint">
          Writes an arbitrary function of the rest of the circuit. Node names are the net labels on your sheet.
        </p>
      ) : (
        <p className="property-hint behavioral-invalid" role="alert">
          <span className="behavioral-lamp" aria-hidden="true" />
          {check.reason}
        </p>
      )}

      <div className="advanced-settings behavioral-reference">
        <button
          type="button"
          className="disclosure-header"
          onClick={() => setReferenceOpen((open) => !open)}
          aria-expanded={referenceOpen}
          aria-label="Toggle expression reference"
        >
          <span className="disclosure-label">Expression reference</span>
          <span className="disclosure-rule" aria-hidden="true" />
          <span className={`disclosure-chevron${referenceOpen ? " open" : ""}`}>›</span>
        </button>
        {referenceOpen && (
          <div className="advanced-body">
            <dl className="behavioral-terms" aria-label="Expression vocabulary">
              {BEHAVIORAL_TERMS.map((term) => (
                <div className="behavioral-term" key={term.token}>
                  <dt className="mono-num">{term.token}</dt>
                  <dd>{term.meaning}</dd>
                </div>
              ))}
            </dl>
            <p className="behavioral-functions-label">Functions</p>
            <p className="behavioral-functions mono-num" aria-label="Available functions">
              {BEHAVIORAL_FUNCTIONS.map((fn) => fn.signature).join("  ")}
            </p>
            <p className="behavioral-functions-label">Start from</p>
            <ul className="behavioral-examples">
              {BEHAVIORAL_EXAMPLES.map((example) => (
                <li key={example.expr}>
                  <button
                    type="button"
                    className="behavioral-example"
                    onClick={() => commit("behavioral-expression", type, example.expr)}
                  >
                    <code className="mono-num">{example.expr}</code>
                    <span>{example.what}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
