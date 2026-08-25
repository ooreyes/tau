import { Activity, Crosshair, Gauge, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import "./LiveInstrumentActions.css";

export interface LiveInstrumentActionsProps {
  onProbeNode: () => void;
  onMeasureCurrent: () => void;
  onInspectPower: () => void;
  powerUnavailableReason?: string;
}

/** Prepared-instrument entry points backed by the real schematic tools. */
export function LiveInstrumentActions({
  onProbeNode,
  onMeasureCurrent,
  onInspectPower,
  powerUnavailableReason,
}: LiveInstrumentActionsProps) {
  return (
    <section className="live-instrument-actions" aria-label="Live instrument actions">
      <div className="live-instrument-actions__heading">
        <Activity size={15} aria-hidden="true" />
        <div>
          <h2>Ready to measure</h2>
          <p>Choose a real circuit interaction, then Run. Live follows solved samples; Window reviews the authored span.</p>
        </div>
      </div>
      <div className="live-instrument-actions__buttons">
        <Button type="button" variant="outline" size="sm" onClick={onProbeNode}>
          <Crosshair size={14} aria-hidden="true" />
          Probe node voltage
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onMeasureCurrent}>
          <Gauge size={14} aria-hidden="true" />
          Measure component current
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onInspectPower}
          disabled={Boolean(powerUnavailableReason)}
          title={powerUnavailableReason}
        >
          <Zap size={14} aria-hidden="true" />
          {powerUnavailableReason ? "Component power unavailable" : "Inspect component power"}
        </Button>
      </div>
    </section>
  );
}
