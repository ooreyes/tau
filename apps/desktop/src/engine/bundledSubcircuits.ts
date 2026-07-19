/**
 * Bundled LTspice **library subcircuits** (LTspice parity). Five LTspice-library symbols in the acceptance
 * corpus (`Misc\\TowTom2`, `SpecialFunctions\\capmeter`, `ISO16750-2`,
 * `ISO7637-2`, `Opamps\\opamp`) instantiate subcircuits whose bodies ship
 * with LTspice 17.2.4 in `lib/sub/*.{sub,lib}`. Real `.asc` files reference
 * them with either an explicit `.include <file>` directive (1563.asc,
 * opamp.asc's `.include opamp.sub`) or implicitly through the symbol's
 * `ModelFile` attribute (the ISO transient generators), so Tau bundles the
 * bodies the same way `standardModels.ts` bundles `.model` lines.
 *
 * The text below is taken from the LTspice library with the minimal edits
 * ngspice requires (each rejected form live-verified against ngspice-46):
 * - **Subcircuit names are sanitized** (`4-6-3_12V_StartingProfile` →
 *   `4_6_3_12V_StartingProfile`): a dash anywhere in the name makes ngspice
 *   fail the X-line lookup ("unknown subckt"). {@link sanitizeSubcktName}
 *   applies the same mapping to instance references so both sides agree.
 * - `µ` → `u` (LTspice writes the Windows-1252 micro sign; ngspice rejects it).
 * - capometer only: the B-source `Rpar=1G` shorthand becomes an explicit
 *   parallel resistor ("Undefined parameter [rpar]" otherwise), and its two
 *   `if(cond, a, b)` expressions become ngspice ternaries ("no such function
 *   'if'" outside compat mode, which cannot be set per-deck).
 * - Comment lines between blocks (including LTspice's own commented-out
 *   4-2/4-3 constant-voltage blocks in ISO16750-2.lib) are dropped.
 *
 * Lookup is case-insensitive; ngspice treats subckt names case-insensitively.
 */

/**
 * Map an LTspice subcircuit name onto the ngspice-safe name the bundled text
 * uses: every character outside `[A-Za-z0-9_]` becomes `_`. A dash in a
 * subckt name is fatal to ngspice's X-line lookup (live-verified), and the
 * ISO 16750-2 profile names are full of them.
 */
export function sanitizeSubcktName(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "_");
}

// --- lib/sub/opamp.sub (ideal single-pole op-amp; Opamps\opamp.asy) ---
// LTspice keeps the Aol/GBW defaults on the SYMBOL's SpiceLine attributes, not
// in the .sub file; ngspice rejects X-line params the .subckt line doesn't
// declare, so the defaults are moved onto the .subckt line (live-verified:
// follower and −10× inverting amp solve exactly, with and without X-line
// params). Port order is 1=invin, 2=noninvin, 3=out (G1 senses V(2)−V(1)).
const OPAMP_SUB = `.subckt opamp 1 2 3 Aol=100K GBW=10Meg
G1 0 3 2 1 {Aol}
R3 3 0 1.
C3 3 0 {Aol/GBW/6.28318530717959}
.ends opamp`;

// --- lib/sub/TowTom2.sub (2nd-order Tow-Thomas filter block; Misc\TowTom2.asy) ---
const TOWTOM2_SUB = `.subckt TowTom2 1 2 3
C1 1 3 {C}
C3 N001 1 3p
C4 N002 N001 .3p
C7 2 N003 {C}
C6 2 3 .25p
R2 N001 1 10K
R3 N002 N001 10K
R5 N003 N002 {R}
R1 1 0 1.
C2 1 0 {Aol/GBW1/6.28318530717959}
G1 0 1 0 N005 {Aol}
R6 2 0 1.
C8 2 0 {Aol/GBW1/6.28318530717959}
G3 0 2 0 N007 {Aol}
R4 N002 0 1.
C5 N002 0 {Aol/GBW2/6.28318530717959}
G2 0 N002 0 N006 {Aol}
R10 N005 3 {RN1}
R11 N006 N001 {RN2}
R12 N007 N003 {RN3}
.params R=10K C=160p GBW1=10Meg GBW2=15Meg
.params Aol=100K
.param RN1=1 RN2=1 RN3=1
.ends TowTom2`;

// --- lib/sub/capometer.sub (vector impedance meter; SpecialFunctions\capmeter.asy) ---
const CAPOMETER_SUB = `.subckt capometer 1 2 3 4 5
B1 2 1 I={current}*cos(2*pi*{freq}*time)*min(time*2e5, 1.)
RparB1 2 1 1G
R1 N001 0 1.
C2 N001 0 {C}
B2 0 N001 I=sin(2*pi*{freq}*time)*V(x)*min(time*2e5, 1.)
G1 0 N002 N001 0 1.
G2 0 im N002 0 1.
R4 N002 0 1.
C5 N002 0 {C}
R5 im 0 1.
C6 im 0 {C}
R2 N003 0 1.
C3 N003 0 {C}
B3 0 N003 I=cos(2*pi*{freq}*time)*V(x)*min(time*2e5, 1.)
G3 0 N004 N003 0 1.
G4 0 re N004 0 1.
R6 N004 0 1.
C7 N004 0 {C}
R7 re 0 1.
C8 re 0 {C}
R3 5 0 1.
C4 5 0 {C}
B4 0 5 I=(time<10u) ? 0 : max(0.,.5*V(im)*{current}/(2*pi*{freq})/(V(im)*V(im)+V(re)*V(re)))
R10 4 0 1.
C10 4 0 {C}
B6 0 4 I=(time<10u) ? 0 : 2./{current}*(V(re)+V(im)*V(im)/V(re))
G5 0 x N005 2 1.
R8 x 0 1.
R9 3 0 1G
G6 N005 1 3 0 1.
R12 1 N005 1.
*C9 x 0 {1/(4*pi*freq/Q)}
*L1 0 x {1/(Q*pi*freq)}
.param current=10u freq=3Meg C=1u Q=.25
.ends capometer`;

// --- lib/sub/ISO7637-2.lib (automotive transient pulses; ISO7637-2.asy) ---
const ISO7637_LIB = `.subckt Pulse1_12V + -
.param  Ua = 13.5
.param  Us = -150
.param  Ri = 10
.param  td = 2m
.param  tr = 1u
.param  t1 = 0.5
.param  t2  = 200m
.param  t3 = 50us
.param  t0 = 1m
R2 + - {Ri}
I1 - + EXP(0 {Us/Ri} {t0+t3} {tr/2.2} {t0+t3+(5*tr)} {td/2.305} {t1})
I2 - + PULSE({Ua/Ri} 0 {t0} 1u 1u {t2} {t1})
.ends Pulse1_12V

.subckt Pulse1_24V + -
.param  Ua = 27
.param  Us = -600
.param  Ri = 50
.param  td = 1m
.param  tr = 3u
.param  t1 = 0.5
.param  t2  = 200m
.param  t3 = 50us
.param  t0 = 1m
R2 + - {Ri}
I1 - + EXP(0 {Us/Ri} {t0+t3} {tr/2.2} {t0+t3+(5*tr)} {td/2.305} {t1})
I2 - + PULSE({Ua/Ri} 0 {t0} 1u 1u {t2} {t1})
.ends Pulse1_24V

.subckt Pulse2a_12V + -
.param Ua = 13.5
.param Us = 112
.param Ri = 2
.param td = 50u
.param tr = 1u
.param t1 = 0.2
.param t0 = 1m
R1 + - {Ri}
I3 - + EXP({Ua/Ri} {(Ua+Us)/Ri} {t0} {tr/2.2} {t0+(2*tr)} {td/2.305} {t1})
.ends Pulse2a_12V

.subckt Pulse2a_24V + -
.param Ua = 27
.param Us = 112
.param Ri = 2
.param td = 50u
.param tr = 1u
.param t1 = 0.2
.param t0 = 1m
R1 + - {Ri}
I3 - + EXP({Ua/Ri} {(Ua+Us)/Ri} {t0} {tr/2.2} {t0+(2*tr)} {td/2.305} {t1})
.ends Pulse2a_24V

.subckt Pulse2b_12V + -
.param Ua = 13.5
.param Us = 10
.param Ri = 0.05
.param td = 0.2
.param tr = 1m
.param t12 = 1m
.param t6=1m
.param t0 = 1m
.param ton=1
.param trep = 5
R1 + - {Ri}
I3 - + EXP(0 {Us/Ri} {t0+t12+t6} {tr/2.2} {t0+t12+(2*tr)} {td/2.305} {trep})
I1 - + PULSE({Ua/Ri} 0 {t0} {t12} {t12} {trep-ton} {trep})
.ends Pulse2b_12V

.subckt Pulse2b_24V + -
.param Ua = 27
.param Us = 20
.param Ri = 0.05
.param td = 0.2
.param tr = 1m
.param t12 = 1m
.param t6=1m
.param t0 = 1m
.param ton=1
.param trep = 5
R1 + - {Ri}
I3 - + EXP(0 {Us/Ri} {t0+t12+t6} {tr/2.2} {t0+t12+(2*tr)} {td/2.305} {trep})
I1 - + PULSE({Ua/Ri} 0 {t0} {t12} {t12} {trep-ton} {trep})
.ends Pulse2b_24V

.subckt Pulse3a_12V + -
.param  Ua = 13.5V
.param  Us = -220V
.param  Ri = 50
.param  td = 150ns
.param  tr = 5ns
.param  t1 = 100u
.param  t4 = 10ms
.param  t5 = 90ms
.param  t0 =  1ms
R2 + - {Ri}
I1 - + EXP({Ua/Ri} {(Us+Ua)/Ri} {t0} {tr/2.2} {t0+(2*tr)} {td/2.305} {t1} {t4/t1} {(t4+t5)})
.ends Pulse3a_12V

.subckt Pulse3a_24V + -
.param  Ua = 27V
.param  Us = -300V
.param  Ri = 50
.param  td = 150ns
.param  tr = 5ns
.param  t1 = 100u
.param  t4 = 10ms
.param  t5 = 90ms
.param  t0 =  1ms
R2 + - {Ri}
I1 - + EXP({Ua/Ri} {(Us+Ua)/Ri} {t0} {tr/2.2} {t0+(2*tr)} {td/2.305} {t1} {t4/t1} {(t4+t5)})
.ends Pulse3a_24V

.subckt Pulse3b_12V + -
.param  Ua = 13.5
.param  Us = 150
.param  Ri = 50
.param  td = 150n
.param  tr = 5n
.param  t1 = 100u
.param  t4 = 10m
.param  t5 = 90m
.param  t0 =  1m
R1 + - {Ri}
I2 - + EXP({Ua/Ri} {(Us+Ua)/Ri} {t0} {tr/2.2} {t0+(2*tr)} {td/2.305} {t1} {t4/t1} {(t4+t5)})
.ends Pulse3b_12V

.subckt Pulse3b_24V + -
.param  Ua = 27
.param  Us = 300
.param  Ri = 50
.param  td = 150n
.param  tr = 5n
.param  t1 = 100u
.param  t4 = 10m
.param  t5 = 90m
.param  t0 =  1m
R1 + - {Ri}
I2 - + EXP({Ua/Ri} {(Us+Ua)/Ri} {t0} {tr/2.2} {t0+(2*tr)} {td/2.305} {t1} {t4/t1} {(t4+t5)})
.ends Pulse3b_24V`;

// --- lib/sub/ISO16750-2.lib (automotive supply profiles; ISO16750-2.asy) ---
const ISO16750_LIB = `.subckt 4_4_12V_SuperimposedAlternatingVoltage + -
.param Umax = 16
.param Upp=4
.param Ri=50m
A1 N001 N004 0 0 0 0 N002 0 MODULATOR mark=25k space=0
V1 N005 - PWL(0 0 10u {Umax-(Upp/2)}) Rser=1m
B1 N001 0 V=2e-3*exp(v(t1)/9.654)
V2 N004 0 PWL(0 0 1u 0 +1u {Upp/2}) Rser=1m
R1 + N003 {Ri}
E1 N003 N005 N002 0 1
V3 t1 0 PWL(0 0 60 60 120 0 180 60 240 0 300 60 360 0 420 60 480 0 540 60 600 0) Rser=1m
.ends 4_4_12V_SuperimposedAlternatingVoltage

.subckt 4_4_24V_SuperimposedAlternatingVoltage + -
.param Umax = 32
.param Upp=10
.param Ri=50m
A1 N001 N004 0 0 0 0 N002 0 MODULATOR mark=25k space=0
V1 N005 - PWL(0 0 10u {Umax-(Upp/2)}) Rser=1m
B1 N001 0 V=2e-3*exp(v(t1)/9.654)
V2 N004 0 PWL(0 0 1u 0 +1u {Upp/2}) Rser=1m
R1 + N003 {Ri}
E1 N003 N005 N002 0 1
V3 t1 0 PWL(0 0 60 60 120 0 180 60 240 0 300 60 360 0 420 60 480 0 540 60 600 0) Rser=1m
.ends 4_4_24V_SuperimposedAlternatingVoltage

.subckt 4_5_12V_SlowDecreaseAndIncreaseOfSupplyVoltage + -
.param Usmin = 6
.param t0=1m
V1 + - PWL(0 0 {t0} 0 +1u {Usmin} {Usmin*60/0.5} 0 {2*Usmin*60/0.5} {Usmin})
.ends 4_5_12V_SlowDecreaseAndIncreaseOfSupplyVoltage

.subckt 4_5_24V_SlowDecreaseAndIncreaseOfSupplyVoltage + -
.param Usmin = 10
.param t0=1m
V1 + - PWL(0 0 {t0} 0 +1u {Usmin} {Usmin*60/0.5} 0 {2*Usmin*60/0.5} {Usmin})
.ends 4_5_24V_SlowDecreaseAndIncreaseOfSupplyVoltage

.subckt 4_6_1_12V_MomentaryDropInSupplyVoltage + -
.param Usmin = 6
V2 + - PWL(0 0 +1u {Usmin} 10 {Usmin} +1m 4.5 10.1 4.5 +1m {Usmin})
.ends 4_6_1_12V_MomentaryDropInSupplyVoltage

.subckt 4_6_1_24V_MomentaryDropInSupplyVoltage + -
.param Usmin = 10
V2 + - PWL(0 0 +1u {Usmin} 10 {Usmin} +1m 9 10.1 9 +1m {Usmin})
.ends 4_6_1_24V_MomentaryDropInSupplyVoltage

.subckt 4_6_2_12V_ResetBehaviourAtVoltageDrop + -
.param Usmin = 6
V1 + - PWL(0 0 +1u {Usmin} 20 {Usmin} +1m {Usmin*0.95} +5 {Usmin*0.95} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.90} +5 {Usmin*0.90} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.85} +5 {Usmin*0.85} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.8} +5 {Usmin*0.8} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.75} +5 {Usmin*0.75} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.7} +5 {Usmin*0.7} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.65} +5 {Usmin*0.65} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.6} +5 {Usmin*0.6} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.55} +5 {Usmin*0.55} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.5} +5 {Usmin*0.5} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.45} +5 {Usmin*0.45} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.4} +5 {Usmin*0.4} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.35} +5 {Usmin*0.35} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.3} +5 {Usmin*0.3} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.25} +5 {Usmin*0.25} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.2} +5 {Usmin*0.2} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.15} +5 {Usmin*0.15} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.1} +5 {Usmin*0.1} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.05} +5 {Usmin*0.05} +1m {Usmin} +10 {Usmin} +1m {Usmin*0} +5 {Usmin*0} +1m {Usmin} +40 {Usmin})
.ends 4_6_2_12V_ResetBehaviourAtVoltageDrop

.subckt 4_6_2_24V_ResetBehaviourAtVoltageDrop + -
.param Usmin = 10
V1 + - PWL(0 0 +1u {Usmin} 20 {Usmin} +1m {Usmin*0.95} +5 {Usmin*0.95} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.90} +5 {Usmin*0.90} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.85} +5 {Usmin*0.85} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.8} +5 {Usmin*0.8} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.75} +5 {Usmin*0.75} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.7} +5 {Usmin*0.7} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.65} +5 {Usmin*0.65} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.6} +5 {Usmin*0.6} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.55} +5 {Usmin*0.55} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.5} +5 {Usmin*0.5} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.45} +5 {Usmin*0.45} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.4} +5 {Usmin*0.4} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.35} +5 {Usmin*0.35} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.3} +5 {Usmin*0.3} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.25} +5 {Usmin*0.25} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.2} +5 {Usmin*0.2} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.15} +5 {Usmin*0.15} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.1} +5 {Usmin*0.1} +1m {Usmin} +10 {Usmin} +1m {Usmin*0.05} +5 {Usmin*0.05} +1m {Usmin} +10 {Usmin} +1m {Usmin*0} +5 {Usmin*0} +1m {Usmin} +40 {Usmin})
.ends 4_6_2_24V_ResetBehaviourAtVoltageDrop

.subckt 4_6_3_12V_StartingProfile + -
.param Ub = 13.5
.param Us6 = 6
.param Us = 6.5
.param tf = 5m
.param t6 = 15m
.param t7 = 50m
.param t8 = 10000m
.param tr = 100m
.param Ri = 10m
.param t0 = 1
R1 + - {Ri}
I3 - + PWL(0 0 +1u {Ub/Ri} {t0} {Ub/Ri} {t0+tf} {Us6/Ri} {t0+tf+t6} {Us6/Ri} {t0+tf+t6+t7} {(Us+1)/Ri} {t0+tf+t6+t7+t8} {(Us+1)/Ri} {t0+tf+t6+t7+t8+tr} {Ub/Ri})
I1 - + SINE(0 {1/Ri} 2 {t0+tf+t6+t7} 0 180 {t8*2})
.ends 4_6_3_12V_StartingProfile

.subckt 4_6_3_24V_StartingProfile + -
.param Ub = 27
.param Us6 = 6
.param Us = 10
.param tf = 10m
.param t6 = 50m
.param t7 = 50m
.param t8 = 1000m
.param tr = 40m
.param Ri = 10m
.param t0 = 1
R1 + - {Ri}
I3 - + PWL(0 0 +1u {Ub/Ri} {t0} {Ub/Ri} {t0+tf} {Us6/Ri} {t0+tf+t6} {Us6/Ri} {t0+tf+t6+t7} {(Us+1)/Ri} {t0+tf+t6+t7+t8} {(Us+1)/Ri} {t0+tf+t6+t7+t8+tr} {Ub/Ri})
I1 - + SINE(0 {1/Ri} 2 {t0+tf+t6+t7} 0 180 {t8*2})
.ends 4_6_3_24V_StartingProfile

.subckt 4_6_4_12V_LoadDumpWithoutSuppressionTestA + -
.param Ua=14
.param Us=101
.param UsClamp={Us}
.param Ri=0.5
.param t0=1
.param Creservoir=0.15 Rshunt=1.55
.param Vua=-59
L1 N004 N005 2m
D1 N007 + Dideal
V2 N007 - PWL(0 0 1m {Vua})
R1 N005 - {Rshunt}
D2 N006 + Dideal
C1 N003 - {Creservoir}
R2 N003 N002 100
V3 N002 - PWL(0 0 1m {Us})
S1 N004 N003 N001 0 Sideal
V4 N001 0 PULSE(0 1 {t0} +1n +1n 1 60 10)
R3 N006 N005 {Ri}
D3 + N008 Dideal
V5 N008 - PWL(0 0 1m {Usclamp})
.model Sideal SW(Ron=1m Roff=100MEG Vt=0.5 Vh=-0.1)
.model Dideal D(Ron=1m Roff=1MEG Vfwd=1m epsilon=10m)
.ic V(n003)={Us}
.ends 4_6_4_12V_LoadDumpWithoutSuppressionTestA

.subckt 4_6_4_24V_LoadDumpWithoutSuppressionTestA + -
.param Ua=28
.param Us=202
.param UsClamp={Us}
.param Ri=1
.param t0=1
.param Creservoir=0.15 Rshunt=1.55
.param Vua=-118
L1 N004 N005 2m
D1 N007 + Dideal
V2 N007 - PWL(0 0 1m {Vua})
R1 N005 - {Rshunt}
D2 N006 + Dideal
C1 N003 - {Creservoir}
R2 N003 N002 100
V3 N002 - PWL(0 0 1m {Us})
S1 N004 N003 N001 0 Sideal
V4 N001 0 PULSE(0 1 {t0} +1n +1n 1 60 10)
R3 N006 N005 {Ri}
D3 + N008 Dideal
V5 N008 - PWL(0 0 1m {Usclamp})
.model Sideal SW(Ron=1m Roff=100MEG Vt=0.5 Vh=-0.1)
.model Dideal D(Ron=1m Roff=1MEG Vfwd=1m epsilon=10m)
.ic V(n003)={Us}
.ends 4_6_4_24V_LoadDumpWithoutSuppressionTestA

.subckt 4_6_4_12V_LoadDumpWithSuppressionTestB + -
.param Ua=14
.param Us=101
.param UsClamp=35
.param Ri=0.5
.param t0=1
.param Creservoir=0.15 Rshunt=1.55
.param Vua=7
L1 N004 N005 2m
D1 N007 + Dideal
V2 N007 - PWL(0 0 1m {Vua})
R1 N005 - {Rshunt}
D2 N006 + Dideal
C1 N003 - {Creservoir}
R2 N003 N002 100
V3 N002 - PWL(0 0 1m {Us})
S1 N004 N003 N001 0 Sideal
V4 N001 0 PULSE(0 1 {t0} +1n +1n 1 60 10)
R3 N006 N005 {Ri}
D3 + N008 Dideal
V5 N008 - PWL(0 0 1m {Usclamp})
.model Sideal SW(Ron=1m Roff=100MEG Vt=0.5 Vh=-0.1)
.model Dideal D(Ron=1m Roff=1MEG Vfwd=1m epsilon=10m)
.ic V(n003)={Us}
.ends 4_6_4_12V_LoadDumpWithSuppressionTestB

.subckt 4_6_4_24V_LoadDumpWithSuppressionTestB + -
.param Ua=28
.param Us=202
.param UsClamp=58
.param Ri=1
.param t0=1
.param Creservoir=0.15 Rshunt=1.55
.param Vua=26
L1 N004 N005 2m
D1 N007 + Dideal
V2 N007 - PWL(0 0 1m {Vua})
R1 N005 - {Rshunt}
D2 N006 + Dideal
C1 N003 - {Creservoir}
R2 N003 N002 100
V3 N002 - PWL(0 0 1m {Us})
S1 N004 N003 N001 0 Sideal
V4 N001 0 PULSE(0 1 {t0} +1n +1n 1 60 10)
R3 N006 N005 {Ri}
D3 + N008 Dideal
V5 N008 - PWL(0 0 1m {Usclamp})
.model Sideal SW(Ron=1m Roff=100MEG Vt=0.5 Vh=-0.1)
.model Dideal D(Ron=1m Roff=1MEG Vfwd=1m epsilon=10m)
.ic V(n003)={Us}
.ends 4_6_4_24V_LoadDumpWithSuppressionTestB

.subckt 4_7_12V_ReversedVoltageCase2 + -
V1 + - PWL(0 0 1m {Ua} 100m {Ua} +1u {-1*Ua})
.param Ua=14
.ends 4_7_12V_ReversedVoltageCase2

.subckt 4_9_1_12V_SingleLineInterruption + -
V3 N002 0 PWL(0 -1 {t0} -1 +1u 1 +10 1 +1u -1)
.param Ua=14
.param t0=1
V2 N001 - PWL(0 0 1u {Ua})
S1 N001 + N002 0 SHORT
.model SHORT SW(Ron=1m Roff=10MEG Vt=0 Vh=-.5)
.ends 4_9_1_12V_SingleLineInterruption

.subckt 4_7_24V_ReversedVoltageCase2 + -
V1 + - PWL(0 0 1m {Ua} 100m {Ua} +1u {-1*Ua})
.param Ua=28
.ends 4_7_24V_ReversedVoltageCase2

.subckt 4_9_1_24V_SingleLineInterruption + -
.param Ua=28
.param t0=1
V2 N001 - PWL(0 0 1u {Ua})
S1 N001 + N002 0 SHORT
V3 N002 0 PWL(0 -1 {t0} -1 +1u 1 +10 1 +1u -1)
.model SHORT SW(Ron=1m Roff=10MEG Vt=0 Vh=-.5)
.ends 4_9_1_24V_SingleLineInterruption`;

/** Library file basename (lower-cased) → bundled ngspice-ready text. Keys are
 *  the names real `.asc` directives / `.asy` ModelFile attributes use. */
const LIBRARY_FILES = new Map<string, string>([
  ["tau-native.sub", `.subckt tau_passthrough 1 2
Rpass 1 2 1m
.ends tau_passthrough`],
  ["opamp.sub", OPAMP_SUB],
  ["towtom2.sub", TOWTOM2_SUB],
  ["capometer.sub", CAPOMETER_SUB],
  ["iso7637-2.lib", ISO7637_LIB],
  ["iso16750-2.lib", ISO16750_LIB],
]);

/** Sanitized subckt name (lower-cased) → its `.subckt … .ends` block. */
const BLOCKS = new Map<string, string>();
for (const text of LIBRARY_FILES.values()) {
  for (const match of text.matchAll(/^\.subckt\s+(\S+)[\s\S]*?^\.ends[^\n]*/gim)) {
    BLOCKS.set(match[1].toLowerCase(), match[0]);
  }
}

/** The set of bundled subcircuit names (sanitized, lower-cased). */
export function bundledSubcircuitNames(): ReadonlySet<string> {
  return new Set(BLOCKS.keys());
}

/**
 * Return the bundled `.subckt … .ends` block for an LTspice subcircuit name
 * (raw or sanitized), or `null` when we don't ship it. Only the first
 * whitespace-delimited token is treated as the name, so a value that carries
 * instance params (`capometer current=1m …`) resolves too.
 */
export function bundledSubcircuitBlock(name: string): string | null {
  const first = name.trim().split(/\s+/)[0] ?? "";
  if (!first) return null;
  return BLOCKS.get(sanitizeSubcktName(first).toLowerCase()) ?? null;
}

/**
 * Return the bundled text for a library *file* reference (a `.include` /
 * `.lib` directive or an `.asy` `ModelFile`), matching on the basename
 * case-insensitively, or `null` when the file isn't one we bundle.
 */
export function bundledLibraryText(fileName: string): string | null {
  const base = fileName.trim().replace(/^["']|["']$/g, "").split(/[\\/]/).pop() ?? "";
  return LIBRARY_FILES.get(base.toLowerCase()) ?? null;
}
