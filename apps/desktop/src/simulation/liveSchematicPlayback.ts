/**
 * Scrubbing a FINISHED `.tran`: EveryCircuit-style current mode, which maps
 * wall-clock progress onto the completed result's own time axis so the
 * schematic's V/I/flow labels replay samples that already exist. Never invents
 * currents — callers still use `tranComponentCurrents` / `tranAnnotations` at
 * the returned time.
 *
 * NOT the live run. `simulation/liveRun.ts` + `engine/nativeLive.ts` are a
 * different feature: a solver actually running now, whose samples do not exist
 * until the engine produces them. This module never talks to an engine and
 * cannot advance a solve; it only chooses a readout time inside an array it was
 * handed. The two share the word "live" and nothing else, so a change here can
 * never be a change to the running-circuit path.
 */

/** Default wall-clock loop for one full t0→tstop scrub (ms). */
export const LIVE_SCHEMATIC_LOOP_MS = 3200;

/**
 * Live schematic readout drives App-level state and therefore recomputes the
 * visible voltage/current annotations. Updating that state at a ProMotion
 * display's 120 Hz burns four times the reconciliation work of the cadence a
 * circuit readout can usefully show. Keep requestAnimationFrame for paint
 * alignment, but publish at most thirty readouts per second.
 */
export const LIVE_SCHEMATIC_UPDATE_INTERVAL_MS = 1000 / 30;

/** Whether another App-visible live readout is due. */
export function shouldUpdateLiveSchematicFrame(elapsedMs: number): boolean {
  return Number.isFinite(elapsedMs) && elapsedMs >= LIVE_SCHEMATIC_UPDATE_INTERVAL_MS;
}

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
