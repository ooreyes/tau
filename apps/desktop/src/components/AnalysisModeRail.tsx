import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type AnalysisMode = "tran" | "op" | "ac" | "dc" | "tf" | "noise" | "step";

const ANALYSIS_MODES: ReadonlyArray<{
  value: AnalysisMode;
  abbreviation: string;
  name: string;
  directive: string;
}> = [
  { value: "tran", abbreviation: "TRAN", name: "Transient analysis", directive: ".tran" },
  { value: "op", abbreviation: "OP", name: "Operating point", directive: ".op" },
  { value: "ac", abbreviation: "AC", name: "AC sweep", directive: ".ac" },
  { value: "dc", abbreviation: "DC", name: "DC sweep", directive: ".dc" },
  { value: "tf", abbreviation: "TF", name: "Transfer function", directive: ".tf" },
  { value: "noise", abbreviation: "NOISE", name: "Noise analysis", directive: ".noise" },
  { value: "step", abbreviation: "STEP", name: "Step sweep", directive: ".step" },
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
    </Tabs>
  );
}
