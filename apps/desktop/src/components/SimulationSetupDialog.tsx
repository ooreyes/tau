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
            <select
              aria-label="Primary analysis"
              value={analysis}
              onChange={(event) => {
                setAnalysis(event.currentTarget.value as PrimaryAnalysis);
                setError("");
              }}
            >
              <option value="none">None / advanced only</option>
              <option value="op">Operating point (.op)</option>
              <option value="tran">Transient (.tran)</option>
              <option value="ac">AC sweep (.ac)</option>
            </select>
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
                <select aria-label="AC sweep type" value={acSweep} onChange={(event) => setAcSweep(event.currentTarget.value)}>
                  <option value="dec">Decade</option>
                  <option value="oct">Octave</option>
                  <option value="lin">Linear</option>
                </select>
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
                          <select
                            aria-label={`Measurement ${index + 1} analysis`}
                            value={measurement.analysis}
                            onChange={(event) => updateMeasurement(measurement.id, { analysis: event.currentTarget.value as EditableMeasurement["analysis"] })}
                          >
                            <option value="tran">Transient</option>
                            <option value="ac">AC sweep</option>
                            <option value="dc">DC sweep</option>
                            <option value="noise">Noise</option>
                          </select>
                        </label>
                        <label className="simulation-setup-field">
                          <span>Calculation</span>
                          <select
                            aria-label={`Measurement ${index + 1} calculation`}
                            value={measurement.calculation}
                            onChange={(event) => {
                              const calculation = event.currentTarget.value as EditableMeasurementCalculation;
                              updateMeasurement(measurement.id, {
                                calculation,
                                ...(calculation === "PARAM" ? { quantity: "formula" as const } : {}),
                              });
                            }}
                          >
                            <option value="AVG">Average</option>
                            <option value="RMS">RMS</option>
                            <option value="MAX">Maximum</option>
                            <option value="MIN">Minimum</option>
                            <option value="PP">Peak to peak</option>
                            <option value="INTEG">Integral</option>
                            <option value="PARAM">Derived result</option>
                          </select>
                        </label>
                        {!derived && (
                          <label className="simulation-setup-field">
                            <span>Quantity</span>
                            <select
                              aria-label={`Measurement ${index + 1} quantity`}
                              value={measurement.quantity}
                              onChange={(event) => {
                                const nextQuantity = event.currentTarget.value as EditableMeasurementQuantity;
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
                            >
                              <option value="node-voltage">Node voltage</option>
                              <option value="component-current">Component current</option>
                              <option value="component-power">Power absorbed by component</option>
                              <option value="component-power-delivered">Power delivered by source</option>
                              <option value="formula">Formula</option>
                            </select>
                          </label>
                        )}
                      </div>

                      {quantity === "node-voltage" && (
                        <label className="simulation-setup-field">
                          <span>Node</span>
                          <select
                            aria-label={`Measurement ${index + 1} node`}
                            value={measurement.target}
                            onChange={(event) => updateMeasurement(measurement.id, { target: event.currentTarget.value })}
                          >
                            <option value="">Choose node…</option>
                            {measurementContext.nodeNames.map((node) => <option value={node} key={node}>{node}</option>)}
                          </select>
                        </label>
                      )}
                      {(quantity === "component-current" || quantity === "component-power" || quantity === "component-power-delivered") && (
                        <label className="simulation-setup-field">
                          <span>Component</span>
                          <select
                            aria-label={`Measurement ${index + 1} component`}
                            value={measurement.target}
                            onChange={(event) => updateMeasurement(measurement.id, { target: event.currentTarget.value })}
                          >
                            <option value="">Choose component…</option>
                            {componentTargets.map((ref) => <option value={ref} key={ref}>{ref}</option>)}
                          </select>
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
