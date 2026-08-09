/**
 * Simulation: the page that can change a number.
 *
 * Justification for its existence, since a settings window that lists
 * everything is useless: these are the four controls a user coming from
 * LTspice looks for on day one and cannot currently reach anywhere in Tau.
 * Every one of them is wired to a real chokepoint rather than stored and
 * ignored, and each says which engine it reaches, because a tolerance that
 * silently applies to only one of two solvers is worse than no control.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEFAULT_OPTIONS } from "../../engine/spiceOptions";
import {
  TOLERANCE_KEYS,
  TRANSIENT_DETAIL_LABELS,
  hasToleranceOverrides,
  isValidToleranceValue,
  simulationPreferences,
  useSimulationPreferences,
  type ToleranceKey,
  type TransientDetailPreference,
} from "../../lib/simulationPreferences";
import { ENGINE_DESCRIPTIONS, ENGINE_LABELS } from "../../simulation/engineProvenance";
import {
  SegmentedControl,
  SettingsGroup,
  SettingsPage,
  SettingsRow,
  SettingsToggle,
} from "../SettingsPrimitives";

const TOLERANCE_HELP: Record<ToleranceKey, string> = {
  reltol:
    "Relative accuracy each node has to converge to. Lower is more accurate and slower. Raise it if a stiff circuit will not converge.",
  abstol: "Absolute current floor, in amps. Currents below this are treated as zero.",
  vntol: "Absolute voltage floor, in volts. Voltages below this are treated as zero.",
  gmin: "Conductance added across every junction to help the solver find a solution, in siemens.",
};

const DETAIL_OPTIONS: readonly { value: TransientDetailPreference; label: string }[] = [
  { value: "quick", label: TRANSIENT_DETAIL_LABELS.quick },
  { value: "balanced", label: TRANSIENT_DETAIL_LABELS.balanced },
  { value: "precision", label: TRANSIENT_DETAIL_LABELS.precision },
];

/**
 * A single tolerance override input.
 *
 * Draft state plus a resync effect, same shape as `OutputPointsControl` in
 * `SimulationPanel.tsx`. The field has to be controlled: with an uncontrolled
 * `defaultValue`, clicking Restore updates the store and the state label next
 * to it but leaves whatever the user typed sitting in the box, because React
 * never re-applies `defaultValue` to a mounted input.
 */
function ToleranceField({
  id,
  name,
  override,
  placeholder,
  onCommit,
}: {
  id: string;
  name: string;
  override: string | null;
  placeholder: string;
  onCommit: (raw: string) => string | null;
}) {
  const [draft, setDraft] = useState(override ?? "");
  useEffect(() => setDraft(override ?? ""), [override]);

  return (
    <div className="tau-tolerance-control">
      <Input
        id={id}
        aria-label={`${name} override`}
        variant="mono"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={(event) => setDraft(onCommit(event.currentTarget.value) ?? "")}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      <span className="tau-tolerance-state">
        {override ? "overridden" : `default ${placeholder}`}
      </span>
    </div>
  );
}

export function SimulationPage({ onNotice }: { onNotice: (message: string) => void }) {
  const preferences = useSimulationPreferences();
  const overridden = hasToleranceOverrides(preferences);

  // Returns the value that actually ended up in the store, so the field can
  // snap to what is really persisted rather than trusting the keystroke that
  // triggered the commit.
  const setTolerance = (key: ToleranceKey, raw: string): string | null => {
    const trimmed = raw.trim();
    const resolved =
      trimmed === ""
        ? null
        : isValidToleranceValue(trimmed)
          ? trimmed
          : preferences.tolerances[key];
    simulationPreferences.update({
      tolerances: {
        ...preferences.tolerances,
        // Empty means "no override": the field goes back to showing Tau's
        // default rather than pinning the default as if the user chose it.
        [key]: resolved,
      },
    });
    return resolved;
  };

  return (
    <SettingsPage
      title="Simulation"
      summary="Engine behaviour, solver tolerances, and how much resolution a new run starts with."
    >
      {/* No engine selector. Tau does not have two engines a user chooses
          between: ngspice runs whenever it can, and the preview solver only
          appears where ngspice is absent or declined the analysis. Presenting a
          picker would imply a choice that does not exist, so the page states
          the rule and every result carries the engine that produced it. */}
      <SettingsGroup
        title="Engine"
        note="Not a preference. Tau always uses the bundled ngspice build when it can, and every result is labelled with the engine that produced it."
      >
        <SettingsRow label={ENGINE_LABELS.ngspice} hint={ENGINE_DESCRIPTIONS.ngspice}>
          <span className="tau-settings-value">Preferred</span>
        </SettingsRow>
        <SettingsRow label={ENGINE_LABELS.preview} hint={ENGINE_DESCRIPTIONS.preview}>
          <span className="tau-settings-value">Fallback</span>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        title="Solver tolerances"
        note="These become the baseline for every deck. A schematic that carries its own .options directives still wins, so opening someone else's circuit does not silently simulate it your way. Applies to ngspice only: the preview solver does not accept .options."
      >
        {TOLERANCE_KEYS.map((key) => (
          <SettingsRow
            key={key}
            label={key}
            hint={TOLERANCE_HELP[key]}
            htmlFor={`tolerance-${key}`}
          >
            <ToleranceField
              id={`tolerance-${key}`}
              name={key}
              override={preferences.tolerances[key]}
              placeholder={DEFAULT_OPTIONS[key]}
              onCommit={(raw) => setTolerance(key, raw)}
            />
          </SettingsRow>
        ))}
        <SettingsRow
          label="Tau's defaults"
          hint={
            overridden
              ? "One or more tolerances differ from the shipped baseline"
              : "Every tolerance is at Tau's shipped baseline"
          }
        >
          <Button
            size="sm"
            variant="outline"
            disabled={!overridden}
            onClick={() => {
              simulationPreferences.update({
                tolerances: { reltol: null, abstol: null, vntol: null, gmin: null },
              });
              onNotice("Solver tolerances restored to Tau's defaults.");
            }}
          >
            Restore
          </Button>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        title="Output resolution"
        note="How dense Tau makes a new transient run when it sizes the run itself. The length of the window still comes from the circuit's own time constants and source frequencies. A schematic that carries its own .tran directive is unaffected, and the Waveform detail control in the simulator overrides this for the run in front of you."
      >
        <SettingsRow
          label="Default waveform detail"
          hint="Precision costs run time and memory. Quick is for a first look at a slow circuit."
        >
          <SegmentedControl
            label="Default waveform detail"
            value={preferences.transientDetail}
            options={DETAIL_OPTIONS}
            onChange={(next) => simulationPreferences.update({ transientDetail: next })}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        title="Deck inspection"
        note="The netlist Tau hands to ngspice is generated from your schematic. Reading it is the fastest way to find out why a run did something unexpected."
      >
        <SettingsToggle
          id="simulation-technical-details"
          label="Expand technical details automatically"
          hint="Shows the engine transcript under a failed run without a click. This is the same setting as Expand technical details on the General page."
          checked={preferences.alwaysShowTechnicalDetails}
          onChange={(next) =>
            simulationPreferences.update({ alwaysShowTechnicalDetails: next })
          }
        />
        <SettingsRow
          label="Export the generated netlist"
          hint="In the simulator, open Advanced and choose Netlist to save the deck as a .cir file"
        >
          <span className="tau-settings-value">Simulator, Advanced</span>
        </SettingsRow>
      </SettingsGroup>
    </SettingsPage>
  );
}
