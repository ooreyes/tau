/**
 * EveryCircuit-style live schematic current mode: map wall-clock progress onto
 * a real `.tran` time axis so V/I/flow labels scrub through engine samples.
 * Never invents currents — callers still use `tranComponentCurrents` /
 * `tranAnnotations` at the returned time.
 */

/** Default wall-clock loop for one full t0→tstop scrub (ms). */
export const LIVE_SCHEMATIC_LOOP_MS = 3200;

/**
 * Continuous readout time along `[times[0], times[last]]`, looping every
 * `loopDurationMs` of wall clock. Returns null when there is no waveform.
 */
export function liveReadoutTime(
  times: readonly number[],
  wallElapsedMs: number,
  loopDurationMs = LIVE_SCHEMATIC_LOOP_MS,
): number | null {
  if (times.length === 0) return null;
  if (times.length === 1) return times[0]!;
  const t0 = times[0]!;
  const t1 = times[times.length - 1]!;
  const span = t1 - t0;
  if (!(span > 0) || !(loopDurationMs > 0) || !Number.isFinite(wallElapsedMs)) {
    return t1;
  }
  const phase = ((wallElapsedMs % loopDurationMs) + loopDurationMs) % loopDurationMs;
  return t0 + (phase / loopDurationMs) * span;
}

/** Whether live scrubbing should drive schematic readout (cursors win). */
export function shouldDriveLiveSchematicReadout(opts: {
  liveEnabled: boolean;
  cursorsOpen: boolean;
  hasOkTransient: boolean;
}): boolean {
  return opts.liveEnabled && !opts.cursorsOpen && opts.hasOkTransient;
}
