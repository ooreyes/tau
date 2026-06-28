/**
 * A curated bundle of LTspice's **standard device models** (FEATURE_PARITY §3 /
 * §7 "ship a real device-model set"). Real circuits reference common parts by
 * name — `1N4148`, `2N2222`, … — with no inline `.model`, expecting LTspice's
 * shipped `standard.dio` / `standard.bjt` definitions. Without them Tau falls
 * back to a generic `TAU_*` starter and the waveforms don't match LTspice.
 *
 * The parameter values below are taken verbatim from the LTspice 17.2.4 library
 * (`lib/cmp/standard.*`), with LTspice-only annotation keys that ngspice rejects
 * (`mfg`, `Iave`, `Vpk`, `Vceo`, `Icrating`, `type`, …) removed so every line is
 * a clean ngspice `.model`. Only parts a Tau component kind can actually
 * instantiate are bundled: diodes/Schottky (→ `diode`), zeners (→ `zener`),
 * and BJTs (→ `npn`/`pnp`). JFET/VDMOS parts await their component kinds.
 *
 * Lookup is case-insensitive (ngspice treats model names case-insensitively).
 */

// Each entry: the exact `.model` line. The map key is the lower-cased model name.
const MODEL_LINES: readonly string[] = [
  // --- Small-signal / switching diodes (standard.dio) ---
  ".model 1N4148 D(Is=2.52n Rs=.568 N=1.752 Cjo=4p M=.4 tt=20n)",
  ".model 1N914 D(Is=2.52n Rs=.568 N=1.752 Cjo=4p M=.4 tt=20n)",
  ".model MMSD4148 D(Is=2.52n Rs=.568 N=1.752 Cjo=.64p M=.4 tt=5n)",
  // --- Power rectifier (standard.dio) ---
  ".model 1N4007 D(Is=90p Rs=40m Cjo=30p N=1.4 TT=5u)",
  // --- Schottky rectifiers (standard.dio) ---
  ".model 1N5817 D(Is=31.7u Rs=.051 N=1.373 Cjo=190p M=.3 Eg=.69 Xti=2)",
  ".model 1N5818 D(Is=31.7u Rs=.051 N=1.373 Cjo=160p M=.32 Eg=.69 Xti=2)",
  ".model 1N5819 D(Is=31.7u Rs=.051 N=1.373 Cjo=110p M=.35 Eg=.69 Xti=2)",
  ".model BAT54 D(Is=200u Rs=2 N=1.1 Cjo=10p M=.333 Eg=.69 Xti=2)",
  // --- Zeners (standard.dio) — reverse breakdown via Bv/Ibv ---
  ".model 1N750 D(Is=.88f Rs=.25 Cjo=175p M=.55 Bv=4.7 Ibv=20.245m)",
  ".model 1N751 D(Is=.88f Rs=.25 Cjo=170p M=.55 Bv=5.1 Ibv=20m)",
  ".model 1N4733 D(Is=.88f Rs=.21 Cjo=400p M=.55 Bv=5.1 Ibv=49m)",
  ".model 1N5231 D(Is=.88f Rs=.5 Cjo=120p M=.55 Bv=5.1 Ibv=20m)",
  // --- NPN BJTs (standard.bjt) ---
  ".model 2N2222 NPN(IS=1E-14 VAF=100 BF=200 IKF=0.3 XTB=1.5 BR=3 CJC=8E-12 CJE=25E-12 TR=100E-9 TF=400E-12 ITF=1 VTF=2 XTF=3 RB=10 RC=.3 RE=.2)",
  ".model 2N3904 NPN(IS=1E-14 VAF=100 BF=300 IKF=0.4 XTB=1.5 BR=4 CJC=4E-12 CJE=8E-12 RB=20 RC=0.1 RE=0.1 TR=250E-9 TF=350E-12 ITF=1 VTF=2 XTF=3)",
  ".model BC547 NPN(IS=1E-14 VAF=100 BF=300 IKF=0.3 XTB=1.5 BR=5 CJC=6E-12 CJE=12E-12 RB=10 RC=.3 RE=.2 TR=100E-9 TF=400E-12 ITF=1 VTF=2 XTF=3)",
  // --- PNP BJTs (standard.bjt) ---
  ".model 2N2907 PNP(IS=1E-14 VAF=120 BF=250 IKF=0.3 XTB=1.5 BR=3 CJC=8E-12 CJE=30E-12 TR=100E-9 TF=400E-12 ITF=1 VTF=2 XTF=3 RB=10 RC=.3 RE=.2)",
  ".model 2N3906 PNP(IS=1E-14 VAF=100 BF=200 IKF=0.4 XTB=1.5 BR=4 CJC=4.5E-12 CJE=10E-12 RB=20 RC=0.1 RE=0.1 TR=250E-9 TF=350E-12 ITF=1 VTF=2 XTF=3)",
  ".model BC557 PNP(IS=1E-14 VAF=100 BF=250 IKF=0.3 XTB=1.5 BR=5 CJC=6E-12 CJE=12E-12 RB=10 RC=.3 RE=.2 TR=100E-9 TF=400E-12 ITF=1 VTF=2 XTF=3)",
];

/** name (lower-cased) → `.model` line. */
const STANDARD_MODELS = new Map<string, string>(
  MODEL_LINES.map((line) => {
    const name = /^\.model\s+(\S+)/i.exec(line)?.[1]?.toLowerCase() ?? "";
    return [name, line] as const;
  }),
);

/** The set of bundled standard model names (lower-cased). */
export function standardModelNames(): ReadonlySet<string> {
  return new Set(STANDARD_MODELS.keys());
}

/**
 * Return the `.model` line for a bundled LTspice standard part, or `null` if the
 * name is not one we ship. Case-insensitive; tolerates a value that carries
 * trailing tokens (only the first whitespace-delimited token is the model name).
 */
export function standardModelLine(name: string): string | null {
  const key = name.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return STANDARD_MODELS.get(key) ?? null;
}
