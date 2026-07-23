# Circuit_testing_v1

Repository-owned LTspice-compatible circuits for repeatable Tau product
validation. The first tier contains compact, hand-checkable analysis cases; the
second tier deliberately combines switching power, mixed-signal logic,
multi-stage analog, and three-phase systems. Together they test whether Tau
produces an engineering result—not merely whether a schematic opens.

Run the automated matrix from the repository root:

```bash
Circuit_testing_v1/run.sh
```

The runner imports each unmodified `.asc`, validates Tau's document model,
builds the same SPICE decks Tau uses, exercises ngspice for native
OP/TRAN/AC/DC paths, and checks Tau's interim analysis implementations for
measurements, stepped families, noise, and transfer function. The report has
55 independently named checks across 19 fixtures.

| File | Engineering question |
| --- | --- |
| `01_op_voltage_divider.asc` | Does the DC bias point match a hand-calculated 5 V divider? |
| `02_tran_rc_pulse_meas.asc` | Does an RC step settle correctly and produce useful `.meas` results? |
| `03_ac_rc_lowpass.asc` | Is the Bode corner near 1/(2πRC), with sensible magnitude and phase? |
| `04_dc_diode_curve.asc` | Does a nonlinear diode sweep remain finite and monotonic? |
| `05_step_loaded_divider.asc` | Do parameter steps produce distinct, ordered transfer curves? |
| `06_tf_voltage_divider.asc` | Does `.tf` report gain and input/output resistance? |
| `07_noise_rc_lowpass.asc` | Does `.noise` report finite output/input-referred spectra? |
| `08_tran_rlc_ringing.asc` | Does a second-order transient remain stable while ringing? |
| `09_error_missing_ground.asc` | Is a missing reference node rejected with an actionable message? |
| `10_error_duplicate_refdes.asc` | Are duplicate reference designators rejected by name? |
| `11_stress_rc_ladder.asc` | Can a larger multi-node circuit run OP, TRAN, and AC without warnings? |
| `12_buck_converter.asc` | Does a 100 kHz MOSFET buck settle near duty × input with bounded ripple? |
| `13_boost_converter.asc` | Does a nonlinear MOSFET boost raise 5 V above 8 V under load without runaway ripple? |
| `14_logic_gate_matrix.asc` | Do AND/NAND, OR/NOR, and XOR/XNOR reproduce the complete two-input truth table? |
| `15_dflop_register.asc` | Do cascaded D flip-flops sample the expected 01 → 11 → 10 sequence on rising clock edges? |
| `16_active_fourth_order_filter.asc` | Do four buffered poles produce approximately −12 dB at the common corner and −80 dB/decade rolloff? |
| `17_three_phase_power_grid.asc` | Does a compensated three-phase feeder preserve RMS phase balance through line impedance and a grounded-wye load? |
| `18_full_bridge_power_supply.asc` | Does a four-diode bridge and reservoir capacitor produce the expected loaded DC rail and ripple? |
| `19_instrumentation_amplifier.asc` | Does a three-op-amp INA deliver approximately 21× differential gain around a 2.5 V common mode? |

The two `09_`/`10_` files are expected failures. A passing run means Tau
rejects them clearly; silently accepting either is a failure.

## What this proves

The automated assertions check converter regulation and ripple, complete
combinational truth tables, sequential edge state, AC corner and asymptotic
slope, three-phase RMS balance, rectified DC quality, and closed-loop
instrumentation gain. These are reproducible qualification cases, not a claim
that every proprietary LTspice macro-model or every research workflow is
already supported. The broader acceptance corpus and `FEATURE_PARITY.md`
remain the authority for general LTspice replacement status.
