/**
 * A curated bundle of LTspice's **standard device models** (LTspice parity). Real circuits reference common parts by
 * name - `1N4148`, `2N2222`, … - with no inline `.model`, expecting LTspice's
 * shipped `standard.dio` / `standard.bjt` definitions. Without them Tau falls
 * back to a generic `TAU_*` starter and the waveforms don't match LTspice.
 *
 * The parameter values below are taken verbatim from the LTspice 17.2.4 library
 * (`lib/cmp/standard.*`), with LTspice-only annotation keys that ngspice rejects
 * (`mfg`, `Iave`, `Vpk`, `Vceo`, `Icrating`, `type`, …) removed so every line is
 * a clean ngspice `.model`. Only parts a Tau component kind can actually
 * instantiate are bundled: diodes/Schottky (→ `diode`), zeners (→ `zener`),
 * BJTs (→ `npn`/`pnp`), JFETs (→ `njf`/`pjf`), and power VDMOS MOSFETs
 * (→ `nmos`/`pmos`; the deck builder emits them 3-terminal, bulk dropped).
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
  // --- Zeners (standard.dio) - reverse breakdown via Bv/Ibv ---
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
  // --- N-channel JFETs (standard.jft). LTspice's Alpha/Vk extension is
  // unsupported by ngspice and was already ignored there, so omit it instead
  // of surfacing a model warning on every otherwise-valid imported circuit. ---
  ".model 2N3819 NJF(Beta=1.304m Betatce=-.5 Rd=1 Rs=1 Lambda=2.25m Vto=-3 Vtotc=-2.5m Is=33.57f Isr=322.4f N=1 Nr=2 Xti=3 Cgd=1.6p M=.3622 Pb=1 Fc=.5 Cgs=2.414p Kf=9.882E-18 Af=1)",
  ".model J309 NJF(Beta=4.682m Betatce=-0.5 Vto=-2.075 Vtotc=-2.5m Lambda=14.5m Is=193.9f Xti=3 Isr=1881f Nr=2 N=1 Rd=1 Rs=1 Cgd=6.2p Cgs=6.2p Fc=0.5 M=465m Pb=1 Kf=64120f Af=1)",
  ".model J310 NJF(Beta=3.384m Betatce=-0.5 Vto=-3.409 Vtotc=-2.5m Lambda=17m Is=193.9f Xti=3 Isr=1881f Nr=2 N=1 Rd=1 Rs=1 Cgd=6.2p Cgs=6.2p Fc=0.5 M=465m Pb=1 Kf=46340f Af=1)",
  ".model 2N5484 NJF(Is=.25p Vto=-1.5 Vtotc=-3m Beta=3.0m Lambda=10m Betatce=-.5 Rd=10 Rs=10 Cgs=4p Cgd=4p Kf=3e-17)",
  ".model 2N5486 NJF(Is=.25p Vto=-4.0 Vtotc=-3m Beta=4.0m Lambda=10m Betatce=-.5 Rd=10 Rs=10 Cgs=4p Cgd=4p Kf=3e-17)",
  // --- Power MOSFETs (standard.mos, VDMOS) - class-d_starter's half bridge.
  // LTspice's `Cgso` is ngspice's `Cgs` (renamed; ngspice warns "unrecognized
  // parameter (cgso)" otherwise); mfg/Vds/Ron/Qg annotation keys stripped. ---
  ".model QS6K1 VDMOS(Rg=45 Vto=1.179 Rd=19.2m Rs=100m Rb=60m Kp=6.084 Lambda=50m Cgdmin=9p Cgdmax=75p A=0.6 Cgs=62p Is=1.7898p N=1.127 Cjo=15.057p M=235.72m Vj=617.76m TT=20n ksubthres=.1)",
  ".model RSR015P06 VDMOS(pchan Rg=39 Vto=-2.072 Rd=153.3m Rs=30m Rb=35m Kp=7.507 Lambda=50m Cgdmin=18p Cgdmax=75p A=0.2 Cgs=470p Is=716.43f N=1.039 Cjo=129.74p M=445.93m Vj=769.5m TT=43.5n)",
  // --- P-channel JFETs (standard.jft) ---
  ".model 2N5460 PJF(Is=1.5p Vto=-3.4 Vtotc=-3m Beta=1.0m Lambda=10m Betatce=-.5 Rd=10 Rs=10 Cgs=5p Cgd=5p Kf=3e-17)",
  ".model J175 PJF(Beta=1.031m Betatce=-0.5 Vto=-3.762 Vtotc=-2.5m Lambda=28m Is=461.5f Xti=3 Isr=4402f Nr=2 N=1 Rd=1 Rs=1 Cgd=6.5p Cgs=9p Fc=0.5 M=279m Pb=1 Kf=66610f Af=1)",
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

/**
 * The ngspice model *type* of a bundled standard part (e.g. `d`, `npn`, `njf`,
 * `vdmos`), lower-cased, or `null` if the name isn't one we ship. Lets the deck
 * builder pick the right device-line node count (a `vdmos` power MOSFET drops
 * the bulk node) without re-parsing the model line at the call site.
 */
export function standardModelType(name: string): string | null {
  const line = standardModelLine(name);
  if (!line) return null;
  return /^\.model\s+\S+\s+([A-Za-z][\w-]*)/i.exec(line)?.[1]?.toLowerCase() ?? null;
}
