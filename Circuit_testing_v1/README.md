# Circuit_testing_v1

Repository-owned LTspice-compatible circuits for repeatable Tau product
validation. These files are deliberately small enough to inspect by hand while
covering the analysis and failure surfaces an engineer expects to reach without
rewriting a schematic.

Run the automated matrix from the repository root:

```bash
Circuit_testing_v1/run.sh
```

The runner imports each unmodified `.asc`, validates Tau's document model,
builds the same SPICE decks Tau uses, exercises ngspice for native OP/TRAN/AC/DC
paths, and checks Tau's interim analysis implementations for measurements,
stepped families, noise, and transfer function.

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

The two `09_`/`10_` files are expected failures. A passing run means Tau
rejects them clearly; silently accepting either is a failure.
