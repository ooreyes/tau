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

type PrimaryAnalysis = "none" | "op" | "tran" | "ac";

const PRIMARY_RE = /^\s*\.?(?:op|tran|ac)\b/i;

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
  const [analysis, setAnalysis] = useState<PrimaryAnalysis>("none");
  const [tranStop, setTranStop] = useState("10m");
  const [tranInterval, setTranInterval] = useState("");
  const [acSweep, setAcSweep] = useState("dec");
  const [acPoints, setAcPoints] = useState("40");
  const [acStart, setAcStart] = useState("10");
  const [acStop, setAcStop] = useState("1Meg");
  const [advanced, setAdvanced] = useState("");
  const [error, setError] = useState("");

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
    setAdvanced(directives.filter((line) => !PRIMARY_RE.test(line)).join("\n"));
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
    const advancedDirectives = advanced
      .split(/\r?\n/)
      .map(normalizedDirective)
      .filter(Boolean);
    setDirectives([...(primaryDirective ? [primaryDirective] : []), ...advancedDirectives]);
    onOpenChange(false);
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

          <details className="simulation-setup-advanced">
            <summary>Advanced directives</summary>
            <p>One directive per line, such as <code>.param</code>, <code>.step</code>, <code>.meas</code>, <code>.model</code>, or <code>.include</code>.</p>
            <textarea
              aria-label="Advanced SPICE directives"
              value={advanced}
              onChange={(event) => setAdvanced(event.currentTarget.value)}
              placeholder=".param Rload=10k&#10;.meas tran peak MAX V(out)"
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
