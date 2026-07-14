import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type AnalysisMode = "tran" | "op" | "ac" | "dc" | "tf" | "noise" | "step";

const ANALYSIS_MODES: ReadonlyArray<{
  value: AnalysisMode;
  abbreviation: string;
  name: string;
  directive: string;
  description: string;
}> = [
  { value: "tran", abbreviation: "TRAN", name: "Transient analysis", directive: ".tran", description: "Voltage and current over time." },
  { value: "op", abbreviation: "OP", name: "Operating point", directive: ".op", description: "DC starting voltages and currents." },
  { value: "ac", abbreviation: "AC", name: "AC sweep", directive: ".ac", description: "Small-signal frequency response: gain and phase." },
  { value: "dc", abbreviation: "DC", name: "DC sweep", directive: ".dc", description: "Circuit response while a source value is swept." },
  { value: "tf", abbreviation: "TF", name: "Transfer function", directive: ".tf", description: "Small-signal gain plus input and output resistance." },
  { value: "noise", abbreviation: "NOISE", name: "Noise analysis", directive: ".noise", description: "Output and input-referred noise across frequency." },
  { value: "step", abbreviation: "STEP", name: "Step sweep", directive: ".step", description: "Repeat an analysis across parameter values." },
];

interface AnalysisModeRailProps {
  value: AnalysisMode;
  onValueChange: (value: AnalysisMode) => void;
  disabled?: boolean;
}

/**
 * Compact simulator analysis navigation. The visible SPICE abbreviations keep
 * the rail instrument-dense while the full analysis names remain available to
 * assistive technology and as native pointer tooltips.
 */
export function AnalysisModeRail({ value, onValueChange, disabled = false }: AnalysisModeRailProps) {
  const selectedMode = ANALYSIS_MODES.find((mode) => mode.value === value) ?? ANALYSIS_MODES[0];
  return (
    <Tabs value={value} onValueChange={(next) => onValueChange(next as AnalysisMode)}>
      <TabsList aria-label="Analysis modes" className="analysis-mode-rail">
        {ANALYSIS_MODES.map((mode) => {
          const label = `${mode.name} (${mode.directive})`;
          return (
            <TabsTrigger
              key={mode.value}
              className="plotter-tab"
              value={mode.value}
              disabled={disabled}
              aria-label={label}
              title={label}
            >
              {mode.abbreviation}
            </TabsTrigger>
          );
        })}
      </TabsList>
      <p className="m-0 min-h-4 text-[11px] leading-4 text-muted-foreground" aria-live="polite">
        {selectedMode.description}
      </p>
    </Tabs>
  );
}
