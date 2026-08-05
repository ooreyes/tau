import { useEffect, useMemo, useState } from "react";
import { useSchematic } from "../store/useSchematic";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  blankEditableMeasurement,
  editableMeasurementFromDirective,
  measurementAuthoringContext,
  serializeEditableMeasurement,
  validateEditableMeasurements,
  type EditableMeasurement,
  type EditableMeasurementCalculation,
  type EditableMeasurementQuantity,
} from "../simulation/measurementAuthoring";

type PrimaryAnalysis = "none" | "op" | "tran" | "ac";

const PRIMARY_RE = /^\s*\.?(?:op|tran|ac)\b/i;
let measurementSequence = 0;

function nextMeasurementId(): string {
  measurementSequence += 1;
  return `measurement-${measurementSequence}`;
}


/** Radix Select forbids empty-string item values; map UI "unset" through this. */
const SELECT_UNSET = "__tau_unset__";

const PRIMARY_ANALYSIS_ITEMS: readonly { value: PrimaryAnalysis; label: string }[] = [
  { value: "none", label: "None / advanced only" },
  { value: "op", label: "Operating point (.op)" },
  { value: "tran", label: "Transient (.tran)" },
  { value: "ac", label: "AC sweep (.ac)" },
];

const AC_SWEEP_ITEMS: readonly { value: string; label: string }[] = [
  { value: "dec", label: "Decade" },
  { value: "oct", label: "Octave" },
  { value: "lin", label: "Linear" },
];

const MEASUREMENT_ANALYSIS_ITEMS: readonly { value: EditableMeasurement["analysis"]; label: string }[] = [
  { value: "tran", label: "Transient" },
  { value: "ac", label: "AC sweep" },
  { value: "dc", label: "DC sweep" },
  { value: "noise", label: "Noise" },
];

const MEASUREMENT_CALCULATION_ITEMS: readonly { value: EditableMeasurementCalculation; label: string }[] = [
  { value: "AVG", label: "Average" },
  { value: "RMS", label: "RMS" },
  { value: "MAX", label: "Maximum" },
  { value: "MIN", label: "Minimum" },
  { value: "PP", label: "Peak to peak" },
  { value: "INTEG", label: "Integral" },
  { value: "PARAM", label: "Derived result" },
];

const MEASUREMENT_QUANTITY_ITEMS: readonly { value: EditableMeasurementQuantity; label: string }[] = [
  { value: "node-voltage", label: "Node voltage" },
  { value: "component-current", label: "Component current" },
  { value: "component-power", label: "Power absorbed by component" },
  { value: "component-power-delivered", label: "Power delivered by source" },
  { value: "formula", label: "Formula" },
];

function SetupSelect({
  label,
  value,
  onValueChange,
  items,
  placeholder,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  items: readonly { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        size="sm"
        className="simulation-setup-select w-full"
        aria-label={label}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function normalizedDirective(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return "";
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

function primaryFromDirectives(directives: readonly string[]): PrimaryAnalysis {
  if (directives.some((line) => /^\s*\.?tran\b/i.test(line))) return "tran";
  if (directives.some((line) => /^\s*\.?ac\b/i.test(line))) return "ac";
  if (directives.some((line) => /^\s*\.?op\b/i.test(line))) return "op";
  return "none";
}

function tokensFor(directives: readonly string[], kind: PrimaryAnalysis): string[] {
  if (kind === "none") return [];
  const line = directives.find((candidate) => new RegExp(`^\\s*\\.?${kind}\\b`, "i").test(candidate));
  return line?.trim().replace(/^\./, "").split(/\s+/).slice(1) ?? [];
}

export function SimulationSetupDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const directives = useSchematic((state) => state.directives);
  const setDirectives = useSchematic((state) => state.setDirectives);
  const components = useSchematic((state) => state.components);
  const wires = useSchematic((state) => state.wires);
  const netLabels = useSchematic((state) => state.netLabels);
  const [analysis, setAnalysis] = useState<PrimaryAnalysis>("none");
  const [tranStop, setTranStop] = useState("10m");
  const [tranInterval, setTranInterval] = useState("");
  const [acSweep, setAcSweep] = useState("dec");
  const [acPoints, setAcPoints] = useState("40");
  const [acStart, setAcStart] = useState("10");
  const [acStop, setAcStop] = useState("1Meg");
  const [advanced, setAdvanced] = useState("");
  const [measurements, setMeasurements] = useState<EditableMeasurement[]>([]);
  const [error, setError] = useState("");
  const measurementContext = useMemo(
    () => measurementAuthoringContext(components, wires, netLabels),
    [components, netLabels, wires],
  );

  useEffect(() => {
    if (!open) return;
    const nextAnalysis = primaryFromDirectives(directives);
    const primaryTokens = tokensFor(directives, nextAnalysis);
    setAnalysis(nextAnalysis);
    if (nextAnalysis === "tran") {
      if (primaryTokens.length >= 2) {
        setTranInterval(primaryTokens[0]);
        setTranStop(primaryTokens[1]);
      } else {
        setTranInterval("");
        setTranStop(primaryTokens[0] ?? "10m");
      }
    }
    if (nextAnalysis === "ac") {
      setAcSweep(primaryTokens[0]?.toLowerCase() ?? "dec");
      setAcPoints(primaryTokens[1] ?? "40");
      setAcStart(primaryTokens[2] ?? "10");
      setAcStop(primaryTokens[3] ?? "1Meg");
    }
    const editableMeasurements: EditableMeasurement[] = [];
    const expertDirectives: string[] = [];
    for (const line of directives) {
      if (PRIMARY_RE.test(line)) continue;
      const measurement = editableMeasurementFromDirective(line, nextMeasurementId());
      if (measurement) editableMeasurements.push(measurement);
      else expertDirectives.push(line);
    }
    setMeasurements(editableMeasurements);
    setAdvanced(expertDirectives.join("\n"));
    setError("");
  }, [directives, open]);

  const primaryDirective = useMemo(() => {
    if (analysis === "none") return "";
    if (analysis === "op") return ".op";
    if (analysis === "tran") {
      const stop = tranStop.trim();
      if (!stop) return "";
      const interval = tranInterval.trim();
      return interval ? `.tran ${interval} ${stop}` : `.tran ${stop}`;
    }
    const parts = [acSweep, acPoints.trim(), acStart.trim(), acStop.trim()];
    return parts.every(Boolean) ? `.ac ${parts.join(" ")}` : "";
  }, [acPoints, acStart, acStop, acSweep, analysis, tranInterval, tranStop]);

  const apply = () => {
    if ((analysis === "tran" || analysis === "ac") && !primaryDirective) {
      setError("Complete the highlighted analysis fields before applying.");
      return;
    }
    const measurementError = validateEditableMeasurements(measurements, measurementContext);
    if (measurementError) {
      setError(measurementError);
      return;
    }
    const advancedDirectives = advanced
      .split(/\r?\n/)
      .map(normalizedDirective)
      .filter(Boolean);
    const measurementDirectives = measurements.map((measurement) => (
      serializeEditableMeasurement(measurement, measurementContext)
    ));
    setDirectives([
      ...(primaryDirective ? [primaryDirective] : []),
      ...measurementDirectives,
      ...advancedDirectives,
    ]);
    onOpenChange(false);
  };

  const updateMeasurement = (id: string, update: Partial<EditableMeasurement>) => {
    setMeasurements((current) => current.map((row) => (row.id === id ? { ...row, ...update } : row)));
    setError("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="simulation-setup-dialog">
        <DialogHeader>
          <DialogTitle>Simulation setup</DialogTitle>
          <DialogDescription>
            Choose a common analysis with engineering fields. SPICE text stays available under Advanced.
          </DialogDescription>
        </DialogHeader>

        <div className="simulation-setup-body">
          <label className="simulation-setup-field">
            <span>Primary analysis</span>
            <SetupSelect
              label="Primary analysis"
              value={analysis}
              onValueChange={(next) => {
                setAnalysis(next as PrimaryAnalysis);
                setError("");
              }}
              items={PRIMARY_ANALYSIS_ITEMS}
            />
          </label>

          {analysis === "op" && (
            <p className="simulation-setup-hint">
              Computes the circuit’s DC bias point. No additional values are required.
            </p>
          )}

          {analysis === "tran" && (
            <div className="simulation-setup-grid">
              <label className="simulation-setup-field">
                <span>Stop time</span>
                <Input aria-label="Transient stop time" value={tranStop} onChange={(event) => setTranStop(event.currentTarget.value)} placeholder="10m" />
              </label>
              <label className="simulation-setup-field">
                <span>Output interval <small>optional</small></span>
                <Input aria-label="Transient output interval" value={tranInterval} onChange={(event) => setTranInterval(event.currentTarget.value)} placeholder="auto" />
              </label>
            </div>
          )}

          {analysis === "ac" && (
            <div className="simulation-setup-grid simulation-setup-grid--ac">
              <label className="simulation-setup-field">
                <span>Sweep</span>
                <SetupSelect
                  label="AC sweep type"
                  value={acSweep}
                  onValueChange={setAcSweep}
                  items={AC_SWEEP_ITEMS}
                />
              </label>
              <label className="simulation-setup-field">
                <span>Points</span>
                <Input aria-label="AC sweep points" value={acPoints} onChange={(event) => setAcPoints(event.currentTarget.value)} />
              </label>
              <label className="simulation-setup-field">
                <span>Start frequency</span>
                <Input aria-label="AC start frequency" value={acStart} onChange={(event) => setAcStart(event.currentTarget.value)} placeholder="10" />
              </label>
              <label className="simulation-setup-field">
                <span>Stop frequency</span>
                <Input aria-label="AC stop frequency" value={acStop} onChange={(event) => setAcStop(event.currentTarget.value)} placeholder="1Meg" />
              </label>
            </div>
          )}

          <div className="simulation-setup-source-note">
            <strong>Need a source waveform?</strong>
            Place <em>Pulse Voltage</em> or <em>AC Voltage</em> from Sources, then edit its named fields in Properties—no <code>PULSE(...)</code> syntax is required.
          </div>

          <section className="measurement-builder" aria-labelledby="measurement-builder-title">
            <div className="measurement-builder-header">
              <div>
                <h3 id="measurement-builder-title">Measurements</h3>
                <p>Save averages, extrema, power, and derived efficiency as named results.</p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setMeasurements((current) => [
                  ...current,
                  {
                    ...blankEditableMeasurement(nextMeasurementId()),
                    analysis: analysis === "ac" ? "ac" : "tran",
                    target: measurementContext.nodeNames[0] ?? "",
                  },
                ])}
              >
                Add measurement
              </Button>
            </div>

            {measurements.length === 0 ? (
              <p className="measurement-builder-empty">No saved measurements. Simulation results still show live trace readouts.</p>
            ) : (
              <div className="measurement-builder-rows">
                {measurements.map((measurement, index) => {
                  const derived = measurement.calculation === "PARAM";
                  const quantity = derived ? "formula" : measurement.quantity;
                  const componentTargets = quantity === "component-power"
                    ? [...measurementContext.powerExpressionByRef.keys()]
                    : quantity === "component-power-delivered"
                      ? measurementContext.sourcePowerRefs
                      : measurementContext.currentRefs;
                  return (
                    <article className="measurement-builder-row" key={measurement.id}>
                      <div className="measurement-builder-row-heading">
                        <span>Result {index + 1}</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={`Remove measurement ${index + 1}`}
                          onClick={() => setMeasurements((current) => current.filter((row) => row.id !== measurement.id))}
                        >
                          Remove
                        </Button>
                      </div>
                      <div className="measurement-builder-grid">
                        <label className="simulation-setup-field">
                          <span>Name</span>
                          <Input
                            aria-label={`Measurement ${index + 1} name`}
                            value={measurement.name}
                            onChange={(event) => updateMeasurement(measurement.id, { name: event.currentTarget.value })}
                          />
                        </label>
                        <label className="simulation-setup-field">
                          <span>Analysis</span>
                          <SetupSelect
                            label={`Measurement ${index + 1} analysis`}
                            value={measurement.analysis}
                            onValueChange={(next) => updateMeasurement(measurement.id, { analysis: next as EditableMeasurement["analysis"] })}
                            items={MEASUREMENT_ANALYSIS_ITEMS}
                          />
                        </label>
                        <label className="simulation-setup-field">
                          <span>Calculation</span>
                          <SetupSelect
                            label={`Measurement ${index + 1} calculation`}
                            value={measurement.calculation}
                            onValueChange={(next) => {
                              const calculation = next as EditableMeasurementCalculation;
                              updateMeasurement(measurement.id, {
                                calculation,
                                ...(calculation === "PARAM" ? { quantity: "formula" as const } : {}),
                              });
                            }}
                            items={MEASUREMENT_CALCULATION_ITEMS}
                          />
                        </label>
                        {!derived && (
                          <label className="simulation-setup-field">
                            <span>Quantity</span>
                            <SetupSelect
                              label={`Measurement ${index + 1} quantity`}
                              value={measurement.quantity}
                              onValueChange={(next) => {
                                const nextQuantity = next as EditableMeasurementQuantity;
                                const target = nextQuantity === "node-voltage"
                                  ? measurementContext.nodeNames[0] ?? ""
                                  : nextQuantity === "component-current"
                                    ? measurementContext.currentRefs[0] ?? ""
                                    : nextQuantity === "component-power"
                                      ? [...measurementContext.powerExpressionByRef.keys()][0] ?? ""
                                      : nextQuantity === "component-power-delivered"
                                        ? measurementContext.sourcePowerRefs[0] ?? ""
                                      : "";
                                updateMeasurement(measurement.id, { quantity: nextQuantity, target });
                              }}
                              items={MEASUREMENT_QUANTITY_ITEMS}
                            />
                          </label>
                        )}
                      </div>

                      {quantity === "node-voltage" && (
                        <label className="simulation-setup-field">
                          <span>Node</span>
                          <SetupSelect
                            label={`Measurement ${index + 1} node`}
                            value={measurement.target || SELECT_UNSET}
                            onValueChange={(next) => updateMeasurement(measurement.id, { target: next === SELECT_UNSET ? "" : next })}
                            placeholder="Choose node…"
                            items={[
                              { value: SELECT_UNSET, label: "Choose node…" },
                              ...measurementContext.nodeNames.map((node) => ({ value: node, label: node })),
                            ]}
                          />
                        </label>
                      )}
                      {(quantity === "component-current" || quantity === "component-power" || quantity === "component-power-delivered") && (
                        <label className="simulation-setup-field">
                          <span>Component</span>
                          <SetupSelect
                            label={`Measurement ${index + 1} component`}
                            value={measurement.target || SELECT_UNSET}
                            onValueChange={(next) => updateMeasurement(measurement.id, { target: next === SELECT_UNSET ? "" : next })}
                            placeholder="Choose component…"
                            items={[
                              { value: SELECT_UNSET, label: "Choose component…" },
                              ...componentTargets.map((ref) => ({ value: ref, label: ref })),
                            ]}
                          />
                        </label>
                      )}
                      {quantity === "formula" && (
                        <label className="simulation-setup-field">
                          <span>{derived ? "Formula using earlier result names" : "Quantity formula"}</span>
                          <Input
                            aria-label={`Measurement ${index + 1} formula`}
                            value={measurement.formula}
                            onChange={(event) => updateMeasurement(measurement.id, { formula: event.currentTarget.value })}
                            placeholder={derived ? "PL / PS" : "V(out) * I(R1)"}
                          />
                        </label>
                      )}
                      {!derived && (
                        <details className="measurement-builder-window">
                          <summary>Measurement window</summary>
                          <div className="simulation-setup-grid">
                            <label className="simulation-setup-field">
                              <span>Start <small>seconds, optional</small></span>
                              <Input
                                aria-label={`Measurement ${index + 1} start time`}
                                inputMode="decimal"
                                value={measurement.from}
                                onChange={(event) => updateMeasurement(measurement.id, { from: event.currentTarget.value })}
                              />
                            </label>
                            <label className="simulation-setup-field">
                              <span>End <small>seconds, optional</small></span>
                              <Input
                                aria-label={`Measurement ${index + 1} end time`}
                                inputMode="decimal"
                                value={measurement.to}
                                onChange={(event) => updateMeasurement(measurement.id, { to: event.currentTarget.value })}
                              />
                            </label>
                          </div>
                        </details>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <details className="simulation-setup-advanced">
            <summary>Advanced directives</summary>
            <p>Exact imported or unsupported expert syntax only, such as custom <code>.param</code>, <code>.step</code>, <code>.model</code>, or <code>.include</code> lines.</p>
            <textarea
              aria-label="Advanced SPICE directives"
              value={advanced}
              onChange={(event) => setAdvanced(event.currentTarget.value)}
              placeholder=".param Rload=10k"
              spellCheck={false}
            />
          </details>
          {error && <p className="simulation-setup-error" role="alert">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={apply}>Apply setup</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
