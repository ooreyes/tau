//! A persistent, free-running ngspice session, so Run can energise a circuit
//! like a bench instrument instead of computing one fixed window.
//!
//! # Why this is a second process, and what that costs
//!
//! `spice::run_spice_worker_process` runs every *bounded* simulation in a
//! `--tau-spice-worker` child with a 120 s ceiling and exactly one JSON
//! response at the end. A free-running simulation has neither: no end, no
//! timeout, and an answer that only exists as a stream. So the choice was
//! between growing a streaming channel back to the parent, or running the live
//! engine in-process and giving up the crash isolation the subprocess buys.
//!
//! **This module streams from a child.** The deciding fact is in the spike
//! (`spice.rs`, section 1E): the poll path reads a running plot through
//! `ngSpice_LockRealloc` / `ngGet_Vec_Info` / `ngSpice_UnlockRealloc`, and
//! `ngGet_Vec_Info` internally calls `vec_get`, which walks plot lists the
//! background solver thread owns — a walk `ngSpice_LockRealloc` does **not**
//! cover. Every measurement says it is safe; nothing in ngspice's contract
//! says it is. Undocumented-safe is exactly the risk the bounded path already
//! spends a whole process on, and it would be perverse to accept a *lower*
//! standard for the path that holds the lock while the solver is mid-flight.
//! A segfault in the UI process costs the user an unsaved schematic; the same
//! segfault in a child costs a banner.
//!
//! What is lost by not running in-process: one process spawn (~tens of ms) on
//! Run, a serialization hop on every frame, and the ability to hand the
//! renderer a zero-copy view of ngspice's own memory. The frame hop is the only
//! one with a per-frame price, and it is paid deliberately — see
//! `LIVE_DEFAULT_SLICE_SAMPLES`, which bounds it.
//!
//! What is *not* changed: the bounded path keeps its shape, its 120 s
//! `WORKER_TIMEOUT` and its SIGKILL cancellation. This module shares
//! `SpiceEngine` (the loader, the staged code models, the message plumbing)
//! and nothing else. `scripts/differential-parity.sh` is the proof.
//!
//! # What the child is not allowed to do quietly
//!
//! Two things about a free-running solve are dishonest if they are not
//! reported, and both are reported here, in `LiveTelemetry`:
//!
//! * **Retention.** `MAX_VECTOR_LENGTH` (2e6) bounds a *finished* run. A live
//!   one at the spike's measured ~500k points/s reaches 2e6 in four seconds
//!   and keeps going. So the child decimates the delivered stream as it goes
//!   (`stride`) and counts every solved point it did not hand over
//!   (`decimatedSamples`), and it stops the solver outright when the engine's
//!   own retained data reaches `scalarBudget`, naming the reason
//!   (`sample-budget`). Silently dropping history and presenting the remainder
//!   as the whole run is the substitution AGENTS.md forbids.
//! * **Divergence.** Every delivered frame is scanned for a non-finite sample.
//!   The first one truncates the frame at that point and halts the run with
//!   `non-finite`, because a plot that keeps scrolling past a NaN is showing a
//!   circuit that stopped being solved.

use std::{
    ffi::{c_char, CString},
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    slice,
    sync::{
        mpsc::{self, Receiver, RecvTimeoutError},
        Arc, Mutex, MutexGuard, PoisonError,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::spice::{
    c_string, clear_callback_state, deck_lines, engine_log_tail, fatal_engine_messages,
    library_candidates, missing_codemodel_message, non_finite_kind, peek_messages, take_messages,
    SpiceEngine,
};

/// Argv marker that turns this executable into a live ngspice host.
const LIVE_WORKER_ARG: &str = "--tau-spice-live-worker";

/** Every frame the child writes is preceded by this marker on its own line.
 *
 * libngspice writes to the real stdout of its host process in places Tau does
 * not control (`fprintf(stdout, ...)` survives in several of its printers), so
 * the child's stdout is a shared channel, not a private one. The bounded path
 * solves the same problem with `WORKER_RESPONSE_MARKER`; a live stream needs it
 * per frame rather than once. The parent skips anything it cannot find a marker
 * in, and keeps it as diagnostics rather than throwing it away. */
const LIVE_FRAME_MARKER: &str = "TAU_LIVE_FRAME_V1:";

/** How much solved data the child lets the *engine* retain before it stops the
 * run and says so.
 *
 * Counted in scalars (samples x vectors), because that is what actually costs
 * memory: a 30-node circuit pays thirty times what a divider does for the same
 * circuit time. 32e6 f64 is 256 MiB, which is deliberately the same ceiling the
 * bounded path already accepts for one answer (`MAX_WORKER_OUTPUT_BYTES`) — a
 * live run is not entitled to more of the machine than a finished one.
 *
 * This is a ceiling, not the expected case. Reaching it takes ~4 s only on the
 * spike's deliberately trivial RC at a 10 us step; a circuit with real device
 * models solves far fewer points per second, and the deck's own `.tran` step
 * is the user's control over the trade. When it *is* reached the run stops with
 * `LiveStopReason::SampleBudget` and the telemetry carries the achieved rate,
 * so the UI can say how much circuit time that bought. */
const LIVE_SCALAR_BUDGET: usize = 32_000_000;
/** The smallest budget a caller may ask for. Below this the budget check fires
 * before the first frame and "live" would mean a single slice, which is a
 * confusing way to spell "bounded run". Tests use values just above it to
 * exercise exhaustion without waiting for 256 MiB of samples. */
const LIVE_MIN_SCALAR_BUDGET: usize = 1_024;

/** Samples per vector in one delivered frame when the caller does not choose.
 *
 * A live plot is a few hundred pixels wide, so more than a couple of thousand
 * points per frame per trace buys nothing visible and costs a JSON hop. This is
 * the knob that keeps the "serialization on every frame" cost of the subprocess
 * decision bounded: 2048 samples x 8 traces is ~16k numbers a frame. */
const LIVE_DEFAULT_SLICE_SAMPLES: usize = 2_048;
/** Ceiling on what a caller may ask for in one frame, so a frontend bug cannot
 * turn a 20 ms poll into a multi-megabyte transfer. */
const LIVE_MAX_SLICE_SAMPLES: usize = 32_768;
/// Widest JSON a single `f64` occupies in a slice column, comma included.
/// `serde_json` prints shortest-round-trip, so 24 is a ceiling rather than a
/// guess: a 17-significant-digit float with a sign and a 3-digit exponent fits.
const LIVE_SLICE_VALUE_JSON_BYTES: usize = 24;
/// Values (columns x samples) one poll may deliver.
///
/// `clamp_slice_samples` bounds SAMPLES, and nothing bounded the number of
/// COLUMNS - so a poll naming many vectors at the sample ceiling produced a
/// frame larger than `MAX_LIVE_FRAME_BYTES`. The parent's reader caps its read
/// at that many bytes, so an oversized frame arrives truncated, fails to parse,
/// and the session is retired: a legitimate-looking request killed the run. The
/// budget therefore has to bound the PRODUCT, which is what actually determines
/// the frame size. Quarter of the wire cap, so the telemetry and log that travel
/// in the same frame have room.
const LIVE_MAX_SLICE_VALUES: usize = MAX_LIVE_FRAME_BYTES / 4 / LIVE_SLICE_VALUE_JSON_BYTES;
/** Traces one poll may name. A transient plot of a large circuit can publish
 * thousands of vectors; a plot showing thousands of them is not a plot. */
const LIVE_MAX_POLL_NAMES: usize = 64;
/** Vector names latched from the running plot at start. Bounded for the same
 * reason `MAX_VECTOR_NAMES` is on the bounded path. */
const LIVE_MAX_VECTOR_NAMES: usize = 10_000;

/** How long the child waits for a command before it stops the solver.
 *
 * A free-running simulation nobody is watching is a core burning for nothing.
 * The solver is halted and the reason recorded (`idle-timeout`) rather than the
 * child being killed, so the next poll still learns the truth instead of
 * finding a corpse. */
const LIVE_IDLE_HALT: Duration = Duration::from_secs(30);
/** How long the child stays alive holding that answer before it exits anyway.
 * The parent normally retires a stopped session immediately; this covers the
 * parent that is alive but wedged, which stdin EOF cannot detect. */
const LIVE_IDLE_EXIT: Duration = Duration::from_secs(300);
/** How often the child looks at the engine when no command has arrived. The
 * budget and completion checks live here, so nothing depends on the UI polling
 * to keep the run honest. */
const LIVE_WATCH_INTERVAL: Duration = Duration::from_millis(25);

/** How long the parent waits for one frame. Generous relative to the spike's
 * worst measured tail poll (5.1 ms) because a frame can also carry a halt,
 * whose latency floor is structural (`_thread_stop` polls `fl_exited` with a
 * 10 ms usleep) and which the child may retry. */
const LIVE_FRAME_TIMEOUT: Duration = Duration::from_secs(20);
/** How long the parent waits for the child to load libngspice, stage code
 * models, parse the deck and reach a running background solve. */
const LIVE_START_TIMEOUT: Duration = Duration::from_secs(60);
/** How long the child gets to exit after a graceful shutdown before SIGKILL. */
const LIVE_SHUTDOWN_GRACE: Duration = Duration::from_millis(750);
/** Ceiling on `ngSpice_running` transitions, matching the spike's 10-13 ms
 * measured stop latency with room for a loaded machine. */
const LIVE_BG_STATE_TIMEOUT: Duration = Duration::from_secs(5);
/** How long a `bg_resume` gets to put the solver back to work before Tau
 * concludes the transient it was resuming had already reached its end.
 *
 * Twenty times the spike's measured background-state transition, and four
 * orders of magnitude more than the thread spawn that is all a resume actually
 * needs. A knob turned in the last milliseconds of a run has to be answered at
 * human speed, so this is what that question costs instead of
 * `LIVE_BG_STATE_TIMEOUT`. */
const LIVE_RESUME_VERDICT: Duration = Duration::from_millis(250);
/** How long the solver must stay running *on the run's own plot* before a
 * resume is believed. ngspice's `com_resume` silently degrades into `com_run`
 * when the analysis it was asked to resume is finished, and the second run is
 * indistinguishable from the first for the moment it takes to allocate its
 * plot. One watch interval of agreement is what separates them. */
const LIVE_RESUME_CONFIRM: Duration = Duration::from_millis(25);
/** Longest single frame the parent will assemble from the child's stdout. */
const MAX_LIVE_FRAME_BYTES: usize = 16 * 1024 * 1024;
/** Bytes of child stderr kept for diagnostics. The drain exists mainly so a
 * chatty child cannot block writing into a pipe nobody reads. */
const MAX_LIVE_STDERR_BYTES: usize = 64 * 1024;
/** Non-frame stdout lines kept as diagnostics. */
const MAX_LIVE_NOISE_LINES: usize = 32;

// ─────────────────────────────────────────────────────────────────────────────
// Mutual exclusion with the bounded path
// ─────────────────────────────────────────────────────────────────────────────

/** Which kind of run currently owns Tau's ngspice capability, if any.
 *
 * One engine at a time is not a convenience here. The bounded path and the live
 * path both spawn a child that loads the same `libngspice` and stages code
 * models into the same fixed per-user `$TMPDIR/tau-ngspice-codemodels` directory, and both
 * would compete for the same machine while the user believes one number on
 * screen came from one circuit. Refusing the second request with a sentence
 * that names the first is the only honest arrangement. */
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum EngineUse {
    Bounded,
    Live,
}

static ENGINE_SLOT: Mutex<Option<EngineUse>> = Mutex::new(None);

fn engine_slot() -> MutexGuard<'static, Option<EngineUse>> {
    ENGINE_SLOT.lock().unwrap_or_else(PoisonError::into_inner)
}

/** Proof that the holder owns Tau's single ngspice capability. Releasing is
 * `Drop`'s job precisely because the paths that must release it include the
 * error returns, the cancellation, and the panic. */
#[derive(Debug)]
pub(crate) struct EngineLease {
    kind: EngineUse,
}

impl Drop for EngineLease {
    fn drop(&mut self) {
        let mut slot = engine_slot();
        if *slot == Some(self.kind) {
            *slot = None;
        }
    }
}

pub(crate) fn acquire_engine(kind: EngineUse) -> Result<EngineLease, String> {
    let mut slot = engine_slot();
    match *slot {
        // Preserved verbatim from the bounded path's own pre-existing refusal,
        // so adding the live interlock did not silently reword an error the
        // rest of Tau may be reading.
        Some(EngineUse::Bounded) => {
            Err("Another native ngspice analysis is already running.".to_string())
        }
        Some(EngineUse::Live) => Err(
            "A live simulation is running. Stop it before starting another analysis.".to_string(),
        ),
        None => {
            *slot = Some(kind);
            Ok(EngineLease { kind })
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Wire types (parent <-> child, and child -> frontend)
// ─────────────────────────────────────────────────────────────────────────────

/** Why a live run is no longer solving. Every one of these is a *named*
 * exhaustion reason: the UI must be able to distinguish "you pressed Stop" from
 * "Tau stopped it for you", and if it stopped for a reason of Tau's own the
 * user is owed which one. */
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LiveStopReason {
    /// `halt_live_spice`, i.e. the Stop button.
    HaltedByUser,
    /// The deck's own `.tran` reached its end time. Not an interruption.
    AnalysisComplete,
    /// `scalarBudget` reached; the engine's retained data hit its ceiling.
    SampleBudget,
    /// A delivered frame contained a NaN or an infinity.
    NonFinite,
    /// The caller's `stopAtSeconds` was reached, on a `SetBkpt` solved point.
    RequestedStopTime,
    /// Nothing polled for `LIVE_IDLE_HALT`.
    IdleTimeout,
    /// ngspice reported a fatal condition while running.
    EngineError,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveStartRequest {
    /// A complete SPICE deck with a transient card and `.end`, as `simulate_spice` takes.
    pub netlist: String,
    /** Circuit time at which the run should stop, if the caller wants a
     * defined end.
     *
     * `ngSpice_SetBkpt` is what makes this exact: the spike (1E-E) measured
     * that a breakpoint forces the solver to land *on* the requested instant
     * (nearest solved sample within 1e-12 relative), while proving it does not
     * pause there. So the breakpoint buys the boundary and the child's own
     * watch buys the stop. Without it a "stop at 5 ms" would really mean "stop
     * at the first solved point past 5 ms", which is an interpolation the user
     * did not ask for. */
    #[serde(default)]
    pub stop_at_seconds: Option<f64>,
    /** Override for `LIVE_SCALAR_BUDGET`, clamped into
     * `LIVE_MIN_SCALAR_BUDGET ..= LIVE_SCALAR_BUDGET`. A caller may ask for
     * less, never for more. */
    #[serde(default)]
    pub scalar_budget: Option<usize>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveStartResponse {
    /// ngspice's name for the running plot.
    pub plot: String,
    /** Every vector the running plot published, latched once.
     *
     * Latched, and not re-read per frame, because `ngSpice_AllVecs` walks the
     * plot list the background thread owns and `ngSpice_LockRealloc` does not
     * cover that walk (spike 1E). Doing it once at start, when the solver has
     * only just begun, is the smallest exposure that still answers the
     * question; doing it every frame would multiply an undocumented-safe
     * traversal by the frame rate. A vector that appears later is therefore not
     * pollable until the next Run — which is honest, because a transient plot's
     * vector set is fixed at circuit load. */
    pub vectors: Vec<String>,
    pub library_path: String,
    pub telemetry: LiveTelemetry,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LivePollRequest {
    /// Vectors to deliver this frame. Empty means every latched vector, capped.
    #[serde(default)]
    pub names: Vec<String>,
    /// Samples per vector this frame; defaults to `LIVE_DEFAULT_SLICE_SAMPLES`.
    #[serde(default)]
    pub max_samples: Option<usize>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSlicePayload {
    /// Names of the delivered columns, in the order of `columns`.
    pub names: Vec<String>,
    /** One column per name, already trimmed so that index `i` of every column
     * is the same solved point. See `LiveRun::read_slice` for why that trim is
     * load-bearing rather than tidy. */
    pub columns: Vec<Vec<f64>>,
    /// Engine-side sample index this frame started at.
    pub from: usize,
    /// Engine-side sample index the next frame will start at.
    pub cursor: usize,
    /** 1 means every solved point in `from..cursor` was delivered. Anything
     * larger means the frame is decimated 1:`stride` and the UI must label it
     * as such. */
    pub stride: usize,
    /** How far apart the longest and shortest published vector lengths were at
     * the instant of the read — the cost, in samples, of reading a plot while
     * it is still being appended to. Trimmed away, and reported so it can be
     * watched rather than assumed. */
    pub skew: usize,
    pub telemetry: LiveTelemetry,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveTelemetry {
    pub running: bool,
    /// Wall-clock seconds since the background solve was confirmed running.
    pub wall_seconds: f64,
    /// Solved points the engine has published on its shortest vector.
    pub solved_samples: usize,
    /// Vectors the running plot publishes, i.e. the multiplier on the budget.
    pub vector_count: usize,
    /// `solvedSamples * vectorCount`, the quantity `scalarBudget` bounds.
    pub scalars: usize,
    pub scalar_budget: usize,
    /// Achieved solver rate, which is the number the retention policy is judged against.
    pub points_per_second: f64,
    /// Solved points handed to the caller across all frames of this run.
    pub delivered_samples: usize,
    /** Solved points that existed and were never handed over, because the
     * frame budget forced a stride. This is the retention loss, stated. */
    pub decimated_samples: usize,
    /// Stride the most recent frame used.
    pub stride: usize,
    pub stop_reason: Option<LiveStopReason>,
    /// One sentence naming what happened, for the UI to show verbatim.
    pub stop_detail: Option<String>,
    /// Newest ngspice diagnostics since the previous telemetry read.
    pub engine_log: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAlterRequest {
    /// Instance designator as it appears in the deck, e.g. `R2` or `V1`.
    pub instance: String,
    /// Parameter name; omitted means the instance's default (`alter r2 = 3k`).
    #[serde(default)]
    pub parameter: Option<String>,
    /// New value, in SPICE notation (`3k`, `1.5`, `100n`, `-2.5e-3`).
    pub value: String,
}

// ─────────────────────────────────────────────────────────────────────────────
// Alter argument validation
// ─────────────────────────────────────────────────────────────────────────────

/** Build the `alter` command line for one instance parameter, or refuse.
 *
 * This validation is not defensive politeness. `ngSpice_Command` is the *whole*
 * ngspice command interpreter: `source`, `shell`, `destroy`, `write` and the
 * rest are all reachable through it, and command text is split on whitespace
 * and newlines. A value string pasted in unchecked therefore turns a knob in
 * the UI into arbitrary command execution inside the engine process, with the
 * user's schematic — which is untrusted data the moment a `.asc` arrives by
 * email — supplying the instance names. So the three fields are matched against
 * grammars narrow enough that no separator can survive them, and the command is
 * assembled here rather than accepted from the caller. */
pub(crate) fn alter_command(request: &LiveAlterRequest) -> Result<String, String> {
    let instance = validate_instance(&request.instance)?;
    let value = validate_spice_value(&request.value)?;
    match request.parameter.as_deref() {
        None => Ok(format!("alter {instance} = {value}")),
        Some(parameter) => {
            let parameter = validate_parameter(parameter)?;
            Ok(format!("alter {instance} {parameter} = {value}"))
        }
    }
}

fn validate_instance(instance: &str) -> Result<String, String> {
    let refusal = || {
        format!(
            "{instance:?} is not a SPICE instance name Tau will alter. Use the designator as it appears in the deck, such as R2 or V1."
        )
    };
    if instance.is_empty() || instance.len() > 64 {
        return Err(refusal());
    }
    let mut characters = instance.chars();
    if !characters
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic())
    {
        return Err(refusal());
    }
    if !characters.all(|character| {
        // No '$': it is ngspice's variable-substitution sigil, and a
        // designator has no business naming an interpreter variable.
        character.is_ascii_alphanumeric() || matches!(character, '_' | '.' | '#' | '-' | '+')
    }) {
        return Err(refusal());
    }
    Ok(instance.to_ascii_lowercase())
}

fn validate_parameter(parameter: &str) -> Result<String, String> {
    let refusal =
        || format!("{parameter:?} is not a parameter name Tau will alter on a live instance.");
    if parameter.is_empty() || parameter.len() > 32 {
        return Err(refusal());
    }
    let mut characters = parameter.chars();
    if !characters
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic())
    {
        return Err(refusal());
    }
    if !characters.all(|character| character.is_ascii_alphanumeric() || character == '_') {
        return Err(refusal());
    }
    Ok(parameter.to_ascii_lowercase())
}

/** Accept exactly a SPICE numeric literal with an optional engineering suffix.
 *
 * Deliberately stricter than ngspice's own lexer, which tolerates trailing
 * junk (`1kohm` parses as 1000). Tau emits canonical values, so tolerance here
 * would only widen the surface described above without serving any caller. */
fn validate_spice_value(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    let refusal = || {
        format!(
            "{value:?} is not a SPICE value. Tau accepts a number with an optional engineering suffix, such as 3k, 100n, or -2.5e-3."
        )
    };
    if trimmed.is_empty() || trimmed.len() > 32 {
        return Err(refusal());
    }
    let lowered = trimmed.to_ascii_lowercase();
    let body = lowered.strip_prefix(['+', '-']).unwrap_or(&lowered);

    // Longest suffix first: `meg` and `mil` both begin with a letter that is
    // itself a suffix, and taking `m` off `meg` would leave `eg` as digits.
    let mut mantissa = body;
    let mut suffix = "";
    for candidate in ["meg", "mil", "t", "g", "k", "m", "u", "n", "p", "f"] {
        if let Some(head) = body.strip_suffix(candidate) {
            // An exponent's own `e` must not be mistaken for a suffix, and a
            // bare suffix with no digits in front of it is not a number.
            if !head.is_empty() && !head.ends_with('e') {
                mantissa = head;
                suffix = candidate;
                break;
            }
        }
    }
    if !is_decimal_literal(mantissa) {
        return Err(refusal());
    }
    Ok(format!(
        "{}{mantissa}{suffix}",
        if lowered.starts_with('-') { "-" } else { "" }
    ))
}

/// `digits[.digits][e[+/-]digits]`, with at least one digit in the mantissa.
fn is_decimal_literal(text: &str) -> bool {
    let (mantissa, exponent) = match text.split_once('e') {
        Some((mantissa, exponent)) => (mantissa, Some(exponent)),
        None => (text, None),
    };
    let digits = match mantissa.split_once('.') {
        Some((whole, fraction)) => {
            if !whole.chars().all(|c| c.is_ascii_digit())
                || !fraction.chars().all(|c| c.is_ascii_digit())
            {
                return false;
            }
            whole.len() + fraction.len()
        }
        None => {
            if !mantissa.chars().all(|c| c.is_ascii_digit()) {
                return false;
            }
            mantissa.len()
        }
    };
    if digits == 0 {
        return false;
    }
    match exponent {
        None => true,
        Some(exponent) => {
            let exponent = exponent.strip_prefix(['+', '-']).unwrap_or(exponent);
            !exponent.is_empty() && exponent.chars().all(|c| c.is_ascii_digit())
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Retention arithmetic
// ─────────────────────────────────────────────────────────────────────────────

/** How many solved points to skip between delivered ones so that `available`
 * fits in `max_samples`.
 *
 * Stride, and not a min/max envelope, and the reason is the same one that
 * forces the trim in `read_slice`: an envelope's `(t_of_min, v_max)` pair is
 * not a point the solver ever produced. Every pair Tau plots on a live trace
 * has to be a real solved point, or the waveform is Tau's drawing of the
 * circuit rather than ngspice's answer about it. Stride throws samples away —
 * which is why `decimatedSamples` exists — but it never invents one. */
fn decimation_stride(available: usize, max_samples: usize) -> usize {
    if available == 0 || max_samples == 0 {
        return 1;
    }
    available.div_ceil(max_samples).max(1)
}

/// How many samples a strided read of `available` points actually delivers.
fn strided_count(available: usize, stride: usize) -> usize {
    if available == 0 {
        0
    } else {
        available.div_ceil(stride.max(1))
    }
}

fn clamp_scalar_budget(requested: Option<usize>) -> usize {
    requested
        .unwrap_or(LIVE_SCALAR_BUDGET)
        .clamp(LIVE_MIN_SCALAR_BUDGET, LIVE_SCALAR_BUDGET)
}

fn clamp_slice_samples(requested: Option<usize>) -> usize {
    requested
        .unwrap_or(LIVE_DEFAULT_SLICE_SAMPLES)
        .clamp(1, LIVE_MAX_SLICE_SAMPLES)
}

/// `clamp_slice_samples`, then reduced so `columns * samples` fits
/// `LIVE_MAX_SLICE_VALUES`. At least one sample always survives: a frame that
/// carries no data is still readable, and the caller learns the run's cursor.
fn clamp_slice_samples_for_columns(requested: Option<usize>, columns: usize) -> usize {
    let samples = clamp_slice_samples(requested);
    let columns = columns.max(1);
    samples.min((LIVE_MAX_SLICE_VALUES / columns).max(1))
}

// ─────────────────────────────────────────────────────────────────────────────
// The live run itself (child-side, and directly testable)
// ─────────────────────────────────────────────────────────────────────────────

/** What the engine did with a `bg_resume`, once it is no longer ambiguous.
 *
 * The distinction that matters is the one the old code could not make: only
 * `Failed` is a failure. A live run that ended while the engineer was reaching
 * for a knob ended — nothing about that is an error, and calling it one is
 * both a lie and, at five seconds a time, a slow one. */
enum ResumeVerdict {
    /// Back to work on the same plot it was solving before.
    Solving,
    /// Never ran again, because the analysis it was resuming was over.
    Finished,
    /// `com_resume` degraded into `com_run` and started a second analysis.
    Restarted,
    /// ngspice reported a fatal condition instead of resuming.
    Failed(String),
}

/// What one locked read of the running plot produced, before framing.
struct RawSlice {
    columns: Vec<Vec<f64>>,
    /// Engine index just past the last *solved* point considered this read.
    solved: usize,
    skew: usize,
    /// First non-finite sample seen, as (engine index, value, column).
    diverged: Option<(usize, f64, usize)>,
}

/** A loaded circuit with a background solve attached to it.
 *
 * Deliberately usable without the IPC layer: the real-engine proofs at the
 * bottom of this file drive this struct directly, exactly as the 1E spike drove
 * its own `LiveEngine`, so the parts that touch ngspice are provable without a
 * subprocess in the loop. */
pub(crate) struct LiveRun {
    engine: SpiceEngine,
    plot: String,
    vectors: Vec<String>,
    /// Pre-built C strings, so no allocation happens inside the realloc lock.
    vector_keys: Vec<CString>,
    started: Instant,
    cursor: usize,
    delivered: usize,
    decimated: usize,
    stride: usize,
    solved: usize,
    scalar_budget: usize,
    stop_at_seconds: Option<f64>,
    stop: Option<(LiveStopReason, String)>,
}

impl LiveRun {
    fn start(
        candidates: Vec<PathBuf>,
        request: &LiveStartRequest,
    ) -> Result<(Self, LiveStartResponse), String> {
        let lines = deck_lines(&request.netlist)?;
        let stop_at = match request.stop_at_seconds {
            None => None,
            Some(time) if time.is_finite() && time > 0.0 => Some(time),
            Some(time) => {
                return Err(format!(
                    "A live run's stop time must be a positive number of seconds, not {time}."
                ))
            }
        };

        let mut engine = SpiceEngine::load(candidates)?;
        if let Some(message) = missing_codemodel_message(&lines, engine.codemodels_loaded) {
            return Err(message);
        }
        clear_callback_state(&engine.callback_state);
        engine.circ_lines(&lines)?;

        // Ordering is the engine's, not a preference: 1E-E proved SetBkpt is
        // refused with no circuit loaded and accepted after one, and that
        // bg_run then honours it.
        if let Some(time) = stop_at {
            let accepted = unsafe { (engine.api.set_bkpt)(time) };
            if !accepted {
                return Err(format!(
                    "ngspice refused a breakpoint at {time} s, so Tau cannot guarantee the live run stops on a solved point there."
                ));
            }
        }

        let mut run = Self {
            engine,
            plot: String::new(),
            vectors: Vec::new(),
            vector_keys: Vec::new(),
            started: Instant::now(),
            cursor: 0,
            delivered: 0,
            decimated: 0,
            stride: 1,
            solved: 0,
            scalar_budget: clamp_scalar_budget(request.scalar_budget),
            stop_at_seconds: stop_at,
            stop: None,
        };

        run.raw_command("bg_run")?;
        run.started = Instant::now();
        if run.await_running(true, LIVE_BG_STATE_TIMEOUT).is_none() {
            return Err(with_log(
                &mut run,
                "ngspice accepted bg_run but never started solving in the background.".to_string(),
            ));
        }
        if let Some(error) = fatal_engine_messages(&run.engine.callback_state) {
            run.force_halt();
            return Err(error);
        }

        // `ngSpice_running` going true does NOT mean the run's plot exists yet.
        // The background thread flips that flag before it allocates the plot, so
        // `cur_plot` in this instant can still name ngspice's `const` pool -
        // boltz, pi, kelvin and friends. Latching THAT as the run's vector list
        // is silent until the first poll, which then refuses `time` as "not a
        // vector this live run publishes" and reads like the deck's fault.
        //
        // A bounded window run is where it actually bites: 3 ms of circuit time
        // is microseconds of wall clock, so the run can be over before the first
        // read. Wait for a plot that is not the constant pool and that publishes
        // something, rather than trusting one instant. `latch_vector_names`
        // already refuses an empty list, so the retry ends the moment the real
        // plot appears, and a run that genuinely never makes one still fails -
        // just with the timeout's honest message instead of a confusing one.
        let plot_deadline = Instant::now() + LIVE_BG_STATE_TIMEOUT;
        loop {
            run.plot = unsafe { c_string((run.engine.api.cur_plot)()) }
                .ok_or_else(|| "ngspice started a live run with no plot.".to_string())?;
            if !run.plot.eq_ignore_ascii_case("const") {
                match run.latch_vector_names() {
                    Ok(names) => {
                        run.vectors = names;
                        break;
                    }
                    Err(error) if Instant::now() >= plot_deadline => {
                        run.force_halt();
                        return Err(error);
                    }
                    Err(_) => {}
                }
            } else if Instant::now() >= plot_deadline {
                run.force_halt();
                return Err(
                    "ngspice never opened a plot for the live run; it is still on the constant pool."
                        .to_string(),
                );
            }
            thread::sleep(Duration::from_micros(200));
        }
        run.vector_keys = run
            .vectors
            .iter()
            .map(|name| {
                CString::new(name.as_str()).map_err(|_| {
                    "ngspice published a vector name containing a NUL byte.".to_string()
                })
            })
            .collect::<Result<Vec<_>, _>>()?;

        let response = LiveStartResponse {
            plot: run.plot.clone(),
            vectors: run.vectors.clone(),
            library_path: run.engine.library_path.display().to_string(),
            telemetry: run.telemetry(),
        };
        Ok((run, response))
    }

    /// Raw `ngSpice_Command`, folding the engine's own words into a failure.
    fn raw_command(&mut self, command: &str) -> Result<(), String> {
        // Same gate as the batch runner's `run_named_command`, from the same
        // shared function: these two are the only ways into the interpreter and
        // they must not drift apart again.
        crate::spice::reject_interpreter_metacharacters(command)?;
        let text = CString::new(command)
            .map_err(|_| "An ngspice command contained a NUL byte.".to_string())?;
        let status = unsafe { (self.engine.api.command)(text.as_ptr() as *mut c_char) };
        if status != 0 {
            let log = take_messages(&self.engine.callback_state);
            return Err(if log.is_empty() {
                format!("ngspice rejected `{command}` with status {status}.")
            } else {
                format!(
                    "ngspice rejected `{command}` with status {status}: {}",
                    engine_log_tail(&log).join(" | ")
                )
            });
        }
        Ok(())
    }

    fn running(&self) -> bool {
        unsafe { (self.engine.api.running)() }
    }

    fn await_running(&self, want: bool, budget: Duration) -> Option<Duration> {
        let start = Instant::now();
        loop {
            if self.running() == want {
                return Some(start.elapsed());
            }
            if start.elapsed() >= budget {
                return None;
            }
            thread::sleep(Duration::from_micros(200));
        }
    }

    /** Stop the background solver no matter what, ignoring every error.
     *
     * Used on the paths where there is nobody left to report to — `Drop`, and
     * the failures during start. A background thread that outlives this struct
     * would keep writing into engine state while `Library`'s own drop
     * `dlclose`s the code it is executing (spike 1E), so this is the one place
     * a swallowed error is the right call. */
    fn force_halt(&mut self) {
        if self.running() {
            let _ = self.raw_command("bg_halt");
            self.await_running(false, LIVE_BG_STATE_TIMEOUT);
        }
    }

    fn latch_vector_names(&self) -> Result<Vec<String>, String> {
        let plot = CString::new(self.plot.as_str())
            .map_err(|_| "ngspice returned an invalid plot name.".to_string())?;
        let names = unsafe { (self.engine.api.all_vecs)(plot.as_ptr() as *mut c_char) };
        if names.is_null() {
            return Err(format!(
                "ngspice published no vectors for the live plot {}.",
                self.plot
            ));
        }
        let mut result = Vec::new();
        for index in 0..LIVE_MAX_VECTOR_NAMES {
            let entry = unsafe { *names.add(index) };
            if entry.is_null() {
                break;
            }
            if let Some(name) = unsafe { c_string(entry) } {
                if !name.is_empty() {
                    result.push(name);
                }
            }
        }
        if result.is_empty() {
            return Err(format!(
                "ngspice published no vectors for the live plot {}.",
                self.plot
            ));
        }
        Ok(result)
    }

    /** One read of the running plot, by the protocol the engine's source
     * dictates and that `ngSpice_LockRealloc` exists for: `dvec_extend` swaps
     * the sample array under `vecreallocMutex`, and `plotAddRealValue` stores a
     * sample *before* incrementing `v_length`, so a reader that holds the lock,
     * reads a length, and copies exactly that many samples can never see a
     * freed buffer or a half-written value.
     *
     * THE READ ORDER IS LOAD-BEARING AND IS ENFORCED BELOW. All lengths are
     * read first, in one pass, and only then is anything copied. The lock
     * covers reallocation, not the per-vector `v_length++`, so the lengths of
     * different vectors are *not* collectively atomic: at any instant the time
     * axis and a signal disagree by however many samples the solver got through
     * in between. Copying vector 1's samples before reading vector 2's length
     * produced a 2039-sample skew between the axis and the signal in the spike
     * — values plotted against the wrong times, and perfectly plausible
     * looking. Every column is therefore trimmed to the shortest published
     * length, and the raw disagreement is reported as `skew` rather than
     * hidden.
     *
     * Two passes and not one for a second reason: `ngGet_Vec_Info` hands back a
     * pointer into a single shared static `myvec`, so the next lookup
     * overwrites the previous answer. The first pass copies out the data
     * pointer and length; nothing keeps the `VectorInfo` itself.
     *
     * SAFETY, stated plainly because it is not guaranteed: `ngGet_Vec_Info`
     * calls `vec_get`, which walks plot lists the background thread owns, and
     * `ngSpice_LockRealloc` does not cover that walk. The spike measured it
     * safe over millions of samples on this engine build; ngspice's contract
     * does not promise it. That gap is why this whole module runs in a child
     * process. */
    fn read_slice(&self, keys: &[&CString], from: usize, max_samples: usize) -> RawSlice {
        let mut heads: Vec<(*const f64, usize)> = Vec::with_capacity(keys.len());
        let mut columns: Vec<Vec<f64>> = Vec::with_capacity(keys.len());
        let mut diverged: Option<(usize, f64, usize)> = None;

        unsafe {
            (self.engine.api.lock_realloc)();

            // PASS 1 — lengths only. Nothing is copied here.
            for key in keys {
                let info = (self.engine.api.get_vec_info)(key.as_ptr() as *mut c_char);
                if info.is_null() || (*info).real_data.is_null() || (*info).length <= 0 {
                    heads.push((std::ptr::null(), 0));
                } else {
                    heads.push(((*info).real_data as *const f64, (*info).length as usize));
                }
            }
            let shortest = heads.iter().map(|(_, len)| *len).min().unwrap_or(0);
            let longest = heads.iter().map(|(_, len)| *len).max().unwrap_or(0);
            let available = shortest.saturating_sub(from);
            let stride = decimation_stride(available, max_samples);

            // PASS 2 — copy, strided, scanning every solved sample on the way
            // past. The divergence scan covers samples the stride skips too:
            // the guard is about whether the solver is still solving, and a
            // frame budget must not be able to hide a NaN until the next
            // kept index.
            for (column, (data, _)) in heads.iter().enumerate() {
                if data.is_null() || available == 0 {
                    columns.push(Vec::new());
                    continue;
                }
                let tail = slice::from_raw_parts(data.add(from), available);
                let mut kept = Vec::with_capacity(strided_count(available, stride));
                for (offset, value) in tail.iter().enumerate() {
                    if !value.is_finite() {
                        let index = from + offset;
                        if diverged.is_none_or(|(seen, _, _)| index < seen) {
                            diverged = Some((index, *value, column));
                        }
                        break;
                    }
                    if offset % stride == 0 {
                        kept.push(*value);
                    }
                }
                columns.push(kept);
            }

            (self.engine.api.unlock_realloc)();

            RawSlice {
                columns,
                solved: shortest,
                skew: longest - shortest,
                diverged,
            }
        }
    }

    /** Resolve the caller's requested names against the latched vector list.
     *
     * Only names the engine itself published can reach `ngGet_Vec_Info`. An
     * arbitrary string would otherwise be handed to a function that parses
     * `plot.vector` syntax and walks the plot list to satisfy it. */
    fn resolve_names(&self, requested: &[String]) -> Result<Vec<usize>, String> {
        if requested.is_empty() {
            return Ok((0..self.vectors.len().min(LIVE_MAX_POLL_NAMES)).collect());
        }
        if requested.len() > LIVE_MAX_POLL_NAMES {
            return Err(format!(
                "A live frame can carry at most {LIVE_MAX_POLL_NAMES} traces; {} were asked for.",
                requested.len()
            ));
        }
        requested
            .iter()
            .map(|name| {
                self.vectors
                    .iter()
                    .position(|known| known.eq_ignore_ascii_case(name))
                    .ok_or_else(|| format!("{name:?} is not a vector this live run publishes."))
            })
            .collect()
    }

    fn poll(&mut self, request: &LivePollRequest) -> Result<LiveSlicePayload, String> {
        let indices = self.resolve_names(&request.names)?;
        // Samples alone are not the frame size; columns x samples is. Fit the
        // product to the wire budget by lowering the sample count, which
        // degrades resolution rather than dropping a vector the caller asked
        // for - a missing column would silently change what is plotted, while
        // fewer samples is visibly the same signal at a coarser step (the
        // decimation stride below already handles that case).
        let max_samples =
            clamp_slice_samples_for_columns(request.max_samples, indices.len().max(1));
        let keys: Vec<&CString> = indices
            .iter()
            .map(|index| &self.vector_keys[*index])
            .collect();
        let from = self.cursor;

        let slice = self.read_slice(&keys, from, max_samples);
        let available = slice.solved.saturating_sub(from);
        let stride = decimation_stride(available, max_samples);

        // A divergence truncates the frame at the bad sample rather than
        // dropping it: the samples solved before the blow-up are real, and the
        // engineer needs to see the approach to it.
        let mut columns = slice.columns;
        let mut cursor = slice.solved;
        if let Some((index, value, column)) = slice.diverged {
            let keep = index.saturating_sub(from).div_ceil(stride);
            for values in &mut columns {
                values.truncate(keep.min(values.len()));
            }
            cursor = index;
            let name = self
                .vectors
                .get(indices.get(column).copied().unwrap_or(usize::MAX))
                .cloned()
                .unwrap_or_else(|| "a live vector".to_string());
            self.record_stop(
                LiveStopReason::NonFinite,
                format!(
                    "Sample {index} of {name} was {}, so Tau stopped the live run there. The solver is no longer producing numbers for this circuit.",
                    non_finite_kind(value)
                ),
            );
        }

        let delivered = columns.iter().map(Vec::len).max().unwrap_or(0);
        self.delivered += delivered;
        self.decimated += cursor.saturating_sub(from).saturating_sub(delivered);
        self.cursor = cursor;
        self.stride = stride;
        self.solved = slice.solved.max(self.solved);
        self.enforce_limits();

        let names = indices
            .iter()
            .map(|index| self.vectors[*index].clone())
            .collect();
        Ok(LiveSlicePayload {
            names,
            columns,
            from,
            cursor,
            stride,
            skew: slice.skew,
            telemetry: self.telemetry(),
        })
    }

    /** Lengths only, no copying — what the child does on its own watch tick so
     * the budget and the completion check never depend on the UI polling. */
    fn observe(&mut self) {
        let keys: Vec<&CString> = self.vector_keys.iter().collect();
        let mut shortest = usize::MAX;
        unsafe {
            (self.engine.api.lock_realloc)();
            for key in &keys {
                let info = (self.engine.api.get_vec_info)(key.as_ptr() as *mut c_char);
                let length = if info.is_null() || (*info).length <= 0 {
                    0
                } else {
                    (*info).length as usize
                };
                shortest = shortest.min(length);
            }
            (self.engine.api.unlock_realloc)();
        }
        if shortest != usize::MAX {
            self.solved = self.solved.max(shortest);
        }
        self.enforce_limits();
    }

    /** The retention ceiling and the two ways a run ends by itself.
     *
     * Checked after every frame and on every watch tick, because a budget that
     * is only enforced when somebody looks is not a budget. */
    fn enforce_limits(&mut self) {
        if self.stop.is_some() {
            self.force_halt();
            return;
        }
        let scalars = self.scalars();
        if scalars >= self.scalar_budget {
            let reason = format!(
                "The live run reached Tau's retention budget of {} solved values ({} samples across {} traces) after {:.1} s at {:.0} points/s, so the solver was stopped. Nothing already shown was discarded; the run simply ends here.",
                self.scalar_budget,
                self.solved,
                self.vectors.len().max(1),
                self.started.elapsed().as_secs_f64(),
                self.points_per_second()
            );
            self.record_stop(LiveStopReason::SampleBudget, reason);
            return;
        }
        if let Some(error) = fatal_engine_messages(&self.engine.callback_state) {
            self.record_stop(LiveStopReason::EngineError, error);
            return;
        }
        if !self.running() {
            self.record_completion(None);
        }
    }

    /** Record the one stop that is not an interruption.
     *
     * The solver reaching the deck's own `.tran` end time — or the exact
     * instant the caller asked for — must never be reported as though Tau or
     * ngspice failed. Shared by the watch tick and by the actuation path,
     * because a knob turned in the last milliseconds of a run reaches the same
     * fact by a different route and is owed the same sentence. `note` carries
     * anything the route itself has to admit to. */
    fn record_completion(&mut self, note: Option<&str>) {
        let reason = match self.stop_at_seconds {
            Some(time) => format!(
                "The live run reached the requested stop time of {time} s and ngspice finished on that exact solved point."
            ),
            None => "The transient analysis in this deck reached its own end time.".to_string(),
        };
        let kind = if self.stop_at_seconds.is_some() {
            LiveStopReason::RequestedStopTime
        } else {
            LiveStopReason::AnalysisComplete
        };
        self.record_stop(
            kind,
            match note {
                Some(note) => format!("{reason} {note}"),
                None => reason,
            },
        );
    }

    /** Answer, for a run that may already be over, what it is doing — or
     * `None` if it is still solving.
     *
     * A run can reach its end at any instant, including between the poll that
     * last reported it healthy and the next thing the engineer does to it. When
     * that has happened the honest answer is the completion reason, named the
     * way a watch tick would have named it, and not a failure: nothing went
     * wrong. `enforce_limits` already holds every rule for classifying a solver
     * that is no longer running, so this asks it rather than inventing a second
     * opinion that could drift from the first. */
    fn conclude_if_not_solving(&mut self) -> Option<LiveTelemetry> {
        if self.stop.is_none() {
            if self.running() {
                return None;
            }
            self.enforce_limits();
        }
        Some(self.telemetry())
    }

    fn record_stop(&mut self, reason: LiveStopReason, detail: String) {
        if self.stop.is_none() {
            self.stop = Some((reason, detail));
        }
        self.force_halt();
    }

    fn halt(&mut self, reason: LiveStopReason, detail: String) -> LiveTelemetry {
        self.record_stop(reason, detail);
        self.telemetry()
    }

    /** Halt, alter one instance parameter, resume.
     *
     * The three steps are one operation because ngspice will not accept an
     * `alter` against a plot its background thread is appending to, and because
     * a half-applied actuation — halted but not resumed — would look to the UI
     * exactly like a finished run.
     *
     * The spike (1E-D) measured that this works for a source, whose DC value is
     * re-read on every matrix load, *and* for a resistor, whose conductance is
     * cached in `RESconduct` and whose `if_setparam` path skips the `CKTtemp`
     * that recomputes it. On the C source's own reading the resistor case
     * should go stale, and it does not: `bg_resume` refreshes it. That is
     * behaviour nobody wrote down, so the real-engine proof at the bottom of
     * this file asserts the exact settled voltage rather than "something
     * moved" — if a future ngspice stops refreshing, a pot silently stops
     * responding while a supply keeps working, and only an exact assertion
     * catches that. */
    fn alter(&mut self, request: &LiveAlterRequest) -> Result<LiveTelemetry, String> {
        let command = alter_command(request)?;
        // A knob turned at a run that has already ended is not an error. It is
        // a run that ended, and the answer is the reason it ended.
        if let Some(finished) = self.conclude_if_not_solving() {
            return Ok(finished);
        }

        let before = peek_messages(&self.engine.callback_state).len();
        self.raw_command("bg_halt")?;
        if self.await_running(false, LIVE_BG_STATE_TIMEOUT).is_none() {
            return Err("ngspice did not stop the background solve, so Tau will not alter a circuit that is still being integrated.".to_string());
        }
        if self.halt_found_nothing_to_stop(before) {
            // The transient reached its end inside the window between the check
            // above and the halt landing. Resuming from here would not continue
            // anything: `com_resume` finds `ci_inprogress` false and quietly
            // calls `com_run`, i.e. it re-runs the whole analysis into a second
            // plot (measured — see `live_3b_`). Better to stop here and say the
            // run finished than to hand the engineer a different run's samples.
            self.record_completion(Some(
                "The change was not applied, because the run had already finished when it arrived.",
            ));
            return Ok(self.telemetry());
        }

        let altered = self.raw_command(&command);
        // Resume even when the alter was refused: leaving the engine halted
        // after a rejected knob turn would strand a run the user never stopped.
        let resumed = self.raw_command("bg_resume");
        altered?;
        resumed?;
        match self.confirm_resumed() {
            ResumeVerdict::Solving => Ok(self.telemetry()),
            ResumeVerdict::Finished => {
                self.record_completion(None);
                Ok(self.telemetry())
            }
            // `record_completion` halts on its way through `record_stop`, which
            // is what stops the second run ngspice started behind Tau's back.
            ResumeVerdict::Restarted => {
                self.record_completion(Some(
                    "ngspice re-ran the analysis from zero instead of resuming it, so Tau stopped that second run rather than show it as a continuation of the first.",
                ));
                Ok(self.telemetry())
            }
            ResumeVerdict::Failed(detail) => {
                self.record_stop(
                    LiveStopReason::EngineError,
                    format!(
                        "ngspice accepted `{command}` but reported a fatal condition instead of resuming: {detail}"
                    ),
                );
                Err("ngspice did not resume the live run after the change.".to_string())
            }
        }
    }

    /** Did the halt we just issued actually interrupt a solve?
     *
     * ngspice's `_thread_stop` (`sharedspice.c`) reports the number of 10 ms
     * waits it needed for the background thread to leave, and a count of zero
     * means the thread had already left of its own accord — the transient
     * finished before the halt reached it. That is the one state in which
     * `bg_resume` is destructive rather than useless, so it is worth asking the
     * engine directly instead of inferring it from how long the call took.
     *
     * Only diagnostics printed *after* the halt are considered, so an earlier
     * halt in the same telemetry window cannot answer for this one. If the
     * message buffer overflowed in between, `before` overruns the log and this
     * answers "no", which costs only the safety net in `confirm_resumed`. */
    fn halt_found_nothing_to_stop(&self, before: usize) -> bool {
        let messages = peek_messages(&self.engine.callback_state);
        messages
            .iter()
            .skip(before)
            .any(|message| message.contains("Background thread stopped with timeout = 0"))
    }

    /** Watch the engine until it is clear what `bg_resume` did.
     *
     * Three things can happen, and only one of them is the good one:
     *
     * * the solver goes back to work on *our* plot — the expected case, and the
     *   plot identity is part of it because a resume that quietly became a
     *   fresh `run` would otherwise pass this check while publishing a second
     *   plot's samples as a continuation of the first;
     * * it never runs again, because the transient it was asked to resume had
     *   already reached its end. That is completion, not failure, and it is
     *   decided in `LIVE_RESUME_VERDICT` rather than after the full
     *   `LIVE_BG_STATE_TIMEOUT`, because a user who flips a switch as the run
     *   ends is owed an answer now, not in five seconds;
     * * ngspice says something fatal, which is the only genuine failure here.
     *
     * `LIVE_BG_STATE_TIMEOUT` is deliberately *not* the clock this runs on. Its
     * five seconds are the right budget for a transition that is expected to
     * happen; a resume that has not shown itself in `LIVE_RESUME_VERDICT` is
     * overwhelmingly a transient that was already over, and making the engineer
     * watch a frozen plot for five seconds to be told so is the defect this
     * replaced. The residual risk — a solver so slow to start that it is called
     * finished — costs nothing that is not recovered: `enforce_limits` re-halts
     * any run that starts after a stop was recorded, on every watch tick. */
    fn confirm_resumed(&mut self) -> ResumeVerdict {
        let started = Instant::now();
        let mut solving_since: Option<Instant> = None;
        loop {
            if let Some(plot) = unsafe { c_string((self.engine.api.cur_plot)()) } {
                if !plot.eq_ignore_ascii_case(&self.plot) {
                    return ResumeVerdict::Restarted;
                }
            }
            if self.running() {
                let since = *solving_since.get_or_insert_with(Instant::now);
                if since.elapsed() >= LIVE_RESUME_CONFIRM {
                    return ResumeVerdict::Solving;
                }
            } else if solving_since.is_some() {
                // It resumed and then reached its own end inside the
                // confirmation window. Still completion.
                return ResumeVerdict::Finished;
            } else if let Some(error) = fatal_engine_messages(&self.engine.callback_state) {
                return ResumeVerdict::Failed(error);
            } else if started.elapsed() >= LIVE_RESUME_VERDICT {
                return ResumeVerdict::Finished;
            }
            thread::sleep(Duration::from_micros(200));
        }
    }

    fn scalars(&self) -> usize {
        self.solved.saturating_mul(self.vectors.len().max(1))
    }

    fn points_per_second(&self) -> f64 {
        let seconds = self.started.elapsed().as_secs_f64();
        if seconds <= 0.0 {
            0.0
        } else {
            self.solved as f64 / seconds
        }
    }

    fn telemetry(&mut self) -> LiveTelemetry {
        let log = engine_log_tail(&take_messages(&self.engine.callback_state));
        let (stop_reason, stop_detail) = match &self.stop {
            Some((reason, detail)) => (Some(*reason), Some(detail.clone())),
            None => (None, None),
        };
        LiveTelemetry {
            running: self.stop.is_none() && self.running(),
            wall_seconds: self.started.elapsed().as_secs_f64(),
            solved_samples: self.solved,
            vector_count: self.vectors.len(),
            scalars: self.scalars(),
            scalar_budget: self.scalar_budget,
            points_per_second: self.points_per_second(),
            delivered_samples: self.delivered,
            decimated_samples: self.decimated,
            stride: self.stride,
            stop_reason,
            stop_detail,
            engine_log: log,
        }
    }
}

impl Drop for LiveRun {
    /** The last owner of the background thread.
     *
     * `SpiceEngine` holds the `Library`, and `Library`'s own drop `dlclose`s
     * the code the solver thread is executing. Halting has to happen before
     * that, on every path out of this struct including a panic. */
    fn drop(&mut self) {
        self.force_halt();
    }
}

/// Fold whatever ngspice has said into a failure message on the start path.
fn with_log(run: &mut LiveRun, message: String) -> String {
    let log = engine_log_tail(&take_messages(&run.engine.callback_state));
    run.force_halt();
    if log.is_empty() {
        message
    } else {
        format!("{message} Engine log: {}", log.join(" | "))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Child protocol
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum LiveRequestFrame {
    Start {
        request: LiveStartRequest,
        library_candidates: Vec<PathBuf>,
    },
    Poll {
        request: LivePollRequest,
    },
    Alter {
        request: LiveAlterRequest,
    },
    Status,
    Halt,
    Shutdown,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LiveResponseFrame {
    error: Option<String>,
    start: Option<LiveStartResponse>,
    slice: Option<LiveSlicePayload>,
    telemetry: Option<LiveTelemetry>,
}

impl LiveResponseFrame {
    fn failed(error: String) -> Self {
        Self {
            error: Some(error),
            start: None,
            slice: None,
            telemetry: None,
        }
    }
}

/** Runs before Tauri starts, exactly as the bounded worker does. A libngspice
 * crash inside a free-running solve is therefore confined to this process. */
pub fn maybe_run_live_spice_worker() -> bool {
    if std::env::args_os().nth(1).as_deref() != Some(std::ffi::OsStr::new(LIVE_WORKER_ARG)) {
        return false;
    }
    // `BufReader<Stdin>` rather than `StdinLock`, because the reader half runs
    // on its own thread and a lock guard cannot cross one. Nothing else in this
    // process reads stdin, so the lock buys nothing anyway.
    let stdout = std::io::stdout();
    serve_live_worker(BufReader::new(std::io::stdin()), stdout.lock());
    true
}

/** The child's whole life.
 *
 * Written against `BufRead`/`Write` rather than the real stdio so the framing
 * can be proven without a process, and structured around a reader thread plus
 * `recv_timeout` because the child must be able to act on its own clock — the
 * budget, the completion check and the idle deadline all have to fire whether
 * or not the parent is asking anything. */
fn serve_live_worker<R: BufRead + Send + 'static, W: Write>(input: R, mut output: W) {
    let (sender, receiver) = mpsc::channel::<Vec<u8>>();
    let reader = thread::spawn(move || {
        let mut input = input;
        loop {
            let mut line = Vec::new();
            match (&mut input)
                .take(MAX_LIVE_FRAME_BYTES as u64)
                .read_until(b'\n', &mut line)
            {
                Ok(0) => break,
                Ok(_) => {
                    if sender.send(line).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    let mut run: Option<LiveRun> = None;
    let mut last_command = Instant::now();
    let mut idle_halted = false;

    loop {
        match receiver.recv_timeout(LIVE_WATCH_INTERVAL) {
            Ok(line) => {
                last_command = Instant::now();
                let response = match serde_json::from_slice::<LiveRequestFrame>(&line) {
                    Err(error) => LiveResponseFrame::failed(format!(
                        "Tau's live ngspice worker received an unreadable command: {error}"
                    )),
                    Ok(LiveRequestFrame::Shutdown) => break,
                    Ok(frame) => handle_live_frame(&mut run, frame),
                };
                if write_live_frame(&mut output, &response).is_err() {
                    break;
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                if let Some(active) = run.as_mut() {
                    active.observe();
                }
                let idle = last_command.elapsed();
                if idle >= LIVE_IDLE_EXIT {
                    break;
                }
                if idle >= LIVE_IDLE_HALT && !idle_halted {
                    idle_halted = true;
                    if let Some(active) = run.as_mut() {
                        active.record_stop(
                            LiveStopReason::IdleTimeout,
                            format!(
                                "Nothing read from this live run for {} s, so Tau stopped the solver rather than leave it computing samples no one is watching.",
                                LIVE_IDLE_HALT.as_secs()
                            ),
                        );
                    }
                }
            }
            // The parent is gone. `LiveRun`'s drop halts the solver before the
            // library unloads; without this the child would be an orphan
            // burning a core for as long as the machine is up.
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }

    drop(run);
    drop(receiver);
    let _ = reader.join();
}

fn handle_live_frame(run: &mut Option<LiveRun>, frame: LiveRequestFrame) -> LiveResponseFrame {
    match frame {
        LiveRequestFrame::Shutdown => LiveResponseFrame::failed(
            "Tau's live ngspice worker cannot answer after shutdown.".to_string(),
        ),
        LiveRequestFrame::Start {
            request,
            library_candidates,
        } => {
            if run.is_some() {
                return LiveResponseFrame::failed(
                    "This live ngspice worker already has a circuit energised.".to_string(),
                );
            }
            match LiveRun::start(library_candidates, &request) {
                Ok((started, response)) => {
                    *run = Some(started);
                    LiveResponseFrame {
                        error: None,
                        start: Some(response),
                        slice: None,
                        telemetry: None,
                    }
                }
                Err(error) => LiveResponseFrame::failed(error),
            }
        }
        LiveRequestFrame::Poll { request } => match run.as_mut() {
            None => LiveResponseFrame::failed(not_started()),
            Some(active) => match active.poll(&request) {
                Ok(slice) => LiveResponseFrame {
                    error: None,
                    start: None,
                    telemetry: Some(slice.telemetry.clone()),
                    slice: Some(slice),
                },
                Err(error) => LiveResponseFrame::failed(error),
            },
        },
        LiveRequestFrame::Alter { request } => match run.as_mut() {
            None => LiveResponseFrame::failed(not_started()),
            Some(active) => match active.alter(&request) {
                Ok(telemetry) => LiveResponseFrame {
                    error: None,
                    start: None,
                    slice: None,
                    telemetry: Some(telemetry),
                },
                Err(error) => LiveResponseFrame::failed(error),
            },
        },
        LiveRequestFrame::Status => match run.as_mut() {
            None => LiveResponseFrame::failed(not_started()),
            Some(active) => {
                active.observe();
                LiveResponseFrame {
                    error: None,
                    start: None,
                    slice: None,
                    telemetry: Some(active.telemetry()),
                }
            }
        },
        LiveRequestFrame::Halt => match run.as_mut() {
            None => LiveResponseFrame::failed(not_started()),
            Some(active) => LiveResponseFrame {
                error: None,
                start: None,
                slice: None,
                telemetry: Some(active.halt(
                    LiveStopReason::HaltedByUser,
                    "Stopped by the engineer.".to_string(),
                )),
            },
        },
    }
}

fn not_started() -> String {
    "This live ngspice worker has no circuit energised.".to_string()
}

fn write_live_frame<W: Write>(output: &mut W, frame: &LiveResponseFrame) -> Result<(), ()> {
    let encoded = serde_json::to_vec(frame).map_err(|_| ())?;
    output
        .write_all(LIVE_FRAME_MARKER.as_bytes())
        .map_err(|_| ())?;
    output.write_all(&encoded).map_err(|_| ())?;
    output.write_all(b"\n").map_err(|_| ())?;
    output.flush().map_err(|_| ())
}

/** Recover one frame from a line of the child's stdout, or `None` if the line
 * is engine noise. The *last* marker wins, so an ngspice `fprintf` that did not
 * end in a newline cannot swallow the frame that follows it. */
fn frame_payload(line: &str) -> Option<&str> {
    line.rfind(LIVE_FRAME_MARKER)
        .map(|at| &line[at + LIVE_FRAME_MARKER.len()..])
}

// ─────────────────────────────────────────────────────────────────────────────
// Parent side
// ─────────────────────────────────────────────────────────────────────────────

/** The parent's half of one live child.
 *
 * Field order is the drop order and matters: the child is killed before the
 * lease is released, so the engine capability is never advertised as free
 * while a solver is still winding down. */
struct LiveSession {
    child: Child,
    /** Held as an `Option` so shutdown can `take()` it and close the pipe.
     *
     * The child's reader thread sits in `read_until` on this pipe, and the
     * child's main loop joins that thread before it returns, so the child
     * cannot finish exiting until it sees EOF. Keeping the writing end alive
     * for the whole of `shutdown` therefore made the graceful path impossible:
     * the Shutdown frame was read and obeyed, and the child then blocked in
     * `reader.join()` until the 750 ms grace ran out and SIGKILL arrived.
     * Closing this after the frame is written is what turns SIGKILL back into
     * the backstop it was always documented to be. */
    stdin: Option<ChildStdin>,
    frames: Receiver<Vec<u8>>,
    reader: Option<JoinHandle<()>>,
    stderr: Arc<Mutex<Vec<u8>>>,
    stderr_reader: Option<JoinHandle<()>>,
    noise: Vec<String>,
    _lease: EngineLease,
}

impl LiveSession {
    fn spawn(lease: EngineLease) -> Result<Self, String> {
        let executable = std::env::current_exe().map_err(|error| {
            format!("Could not locate Tau's live ngspice worker executable: {error}")
        })?;
        let mut command = Command::new(executable);
        command.arg(LIVE_WORKER_ARG);
        Self::spawn_command(command, lease)
    }

    /** Spawn one worker over the three pipes the protocol needs.
     *
     * Split from `spawn` so the lifecycle above these pipes — the retirement of
     * a refused session, and the graceful shutdown handshake — can be proven
     * against a stand-in child. `cargo test`'s own binary cannot be re-executed
     * with `--tau-spice-live-worker` (libtest rejects the argument), so without
     * this seam the parent half of this module would only ever be exercised by
     * hand. */
    fn spawn_command(mut command: Command, lease: EngineLease) -> Result<Self, String> {
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| {
                format!("Could not start Tau's isolated live ngspice worker: {error}")
            })?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Tau's live ngspice worker stdin was unavailable.".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Tau's live ngspice worker stdout was unavailable.".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Tau's live ngspice worker stderr was unavailable.".to_string())?;

        let (sender, frames) = mpsc::channel::<Vec<u8>>();
        let reader = thread::spawn(move || {
            let mut stdout = BufReader::new(stdout);
            loop {
                let mut line = Vec::new();
                match (&mut stdout)
                    .take(MAX_LIVE_FRAME_BYTES as u64)
                    .read_until(b'\n', &mut line)
                {
                    Ok(0) => break,
                    Ok(_) => {
                        if sender.send(line).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        // Drained, not ignored: an unread stderr pipe fills and then blocks the
        // child inside a write, which would look exactly like a wedged solver.
        let collected = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&collected);
        let stderr_reader = thread::spawn(move || {
            let mut stderr = stderr;
            let mut chunk = [0_u8; 4096];
            while let Ok(read) = stderr.read(&mut chunk) {
                if read == 0 {
                    break;
                }
                let mut buffer = sink.lock().unwrap_or_else(PoisonError::into_inner);
                if buffer.len() < MAX_LIVE_STDERR_BYTES {
                    let room = MAX_LIVE_STDERR_BYTES - buffer.len();
                    buffer.extend_from_slice(&chunk[..read.min(room)]);
                }
            }
        });

        Ok(Self {
            child,
            stdin: Some(stdin),
            frames,
            reader: Some(reader),
            stderr: collected,
            stderr_reader: Some(stderr_reader),
            noise: Vec::new(),
            _lease: lease,
        })
    }

    fn diagnostics(&self) -> String {
        let stderr = self.stderr.lock().unwrap_or_else(PoisonError::into_inner);
        let text = String::from_utf8_lossy(&stderr).trim().to_string();
        let noise = self.noise.join(" | ");
        match (text.is_empty(), noise.is_empty()) {
            (true, true) => String::new(),
            (false, true) => format!(" Worker diagnostics: {text}"),
            (true, false) => format!(" Worker output: {noise}"),
            (false, false) => format!(" Worker diagnostics: {text} | {noise}"),
        }
    }

    fn request(
        &mut self,
        frame: &LiveRequestFrame,
        budget: Duration,
    ) -> Result<LiveResponseFrame, String> {
        let encoded = serde_json::to_vec(frame)
            .map_err(|error| format!("Could not encode a live ngspice command: {error}"))?;
        if self.stdin.is_none() {
            return Err(format!(
                "Tau's live ngspice worker has already been shut down.{}",
                self.diagnostics()
            ));
        }
        let written = self.stdin.as_mut().map(|stdin| {
            stdin
                .write_all(&encoded)
                .and_then(|()| stdin.write_all(b"\n"))
                .and_then(|()| stdin.flush())
        });
        if let Some(Err(error)) = written {
            return Err(format!(
                "Tau's live ngspice worker stopped accepting commands: {error}.{}",
                self.diagnostics()
            ));
        }

        let deadline = Instant::now() + budget;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(format!(
                    "Tau's live ngspice worker stopped answering.{}",
                    self.diagnostics()
                ));
            }
            match self.frames.recv_timeout(remaining) {
                Ok(line) => {
                    let text = String::from_utf8_lossy(&line);
                    match frame_payload(text.trim_end()) {
                        Some(payload) => {
                            return serde_json::from_str(payload).map_err(|error| {
                                // A line at the reader's cap arrived without its
                                // newline, i.e. the frame was longer than the
                                // wire budget and this is only its first chunk.
                                // Say that, rather than blaming the data: the
                                // payload budget above exists to make this
                                // unreachable, so if it fires the budget is
                                // wrong and the message has to point there.
                                if line.len() >= MAX_LIVE_FRAME_BYTES {
                                    format!(
                                        "Tau's live ngspice worker produced a frame larger than the {MAX_LIVE_FRAME_BYTES} byte limit, so it could not be read. Ask for fewer vectors or samples per frame."
                                    )
                                } else {
                                    format!("Tau's live ngspice worker returned invalid data: {error}")
                                }
                            })
                        }
                        None => {
                            let noise = text.trim().to_string();
                            if !noise.is_empty() && self.noise.len() < MAX_LIVE_NOISE_LINES {
                                self.noise.push(noise);
                            }
                        }
                    }
                }
                Err(RecvTimeoutError::Timeout) => {
                    return Err(format!(
                        "Tau's live ngspice worker stopped answering.{}",
                        self.diagnostics()
                    ))
                }
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(format!(
                        "Tau's live ngspice worker exited unexpectedly.{}",
                        self.diagnostics()
                    ))
                }
            }
        }
    }
}

/// What one shutdown handshake cost, and whether it needed the SIGKILL backstop.
#[derive(Clone, Copy, Debug)]
struct ShutdownOutcome {
    /// True when the child exited on its own before the grace period ran out.
    exited_gracefully: bool,
    elapsed: Duration,
}

impl LiveSession {
    /** End the child, gracefully if it will let us.
     *
     * Three steps, and the middle one is the whole point. The Shutdown frame
     * tells the child to leave its command loop; **closing stdin** then lets it
     * finish leaving, because its reader thread is parked in `read_until` and
     * its main loop joins that thread on the way out. With the pipe held open
     * the child obeyed the frame and then blocked forever, so every Stop paid
     * the full grace period and died by SIGKILL — a killed process cannot run
     * `LiveRun`'s drop, which is the one thing that halts the background solver
     * before `dlclose` unloads the code it is executing. SIGKILL stays as the
     * backstop for a genuinely wedged child; it is no longer the normal path.
     *
     * Separate from `Drop` so the handshake is measurable: `Drop` runs this and
     * throws the numbers away, a test runs it and asserts on them. Running it
     * twice is harmless — the frame is not sent to a closed pipe, and
     * `Child::wait` caches the status it already reaped. */
    fn shutdown(&mut self) -> ShutdownOutcome {
        let started = Instant::now();
        if let Some(stdin) = self.stdin.as_mut() {
            let shutdown = serde_json::to_vec(&LiveRequestFrame::Shutdown).unwrap_or_default();
            let _ = stdin.write_all(&shutdown);
            let _ = stdin.write_all(b"\n");
            let _ = stdin.flush();
        }
        // Dropping the writing end is the EOF the child is waiting for.
        self.stdin = None;

        let deadline = started + LIVE_SHUTDOWN_GRACE;
        let mut exited = false;
        while Instant::now() < deadline {
            match self.child.try_wait() {
                Ok(Some(_)) => {
                    exited = true;
                    break;
                }
                // Short relative to the grace period, because a clean exit now
                // takes a couple of milliseconds and a 10 ms sleep would be
                // most of the measured stop latency.
                Ok(None) => thread::sleep(Duration::from_millis(1)),
                Err(_) => break,
            }
        }
        if !exited {
            let _ = self.child.kill();
        }
        let _ = self.child.wait();
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
        if let Some(reader) = self.stderr_reader.take() {
            let _ = reader.join();
        }
        ShutdownOutcome {
            exited_gracefully: exited,
            elapsed: started.elapsed(),
        }
    }
}

impl Drop for LiveSession {
    /** The only owner of the child process.
     *
     * Graceful first, because a clean exit lets `LiveRun`'s drop halt the
     * background solver before `dlclose`; SIGKILL after the grace period,
     * because a wedged child must not outlive the session that started it. */
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[derive(Default)]
struct LiveSlot {
    session: Option<LiveSession>,
    /** The last thing a retired session said.
     *
     * A stopped session is retired at once so it cannot hold the engine lease
     * against a bounded run, but the reason it stopped is exactly what the UI
     * still needs. Keeping the final telemetry here is what lets the child be
     * killed promptly without the answer dying with it. */
    last: Option<LiveTelemetry>,
}

#[derive(Default)]
pub struct LiveSpiceState {
    slot: Arc<Mutex<LiveSlot>>,
}

fn lock_slot(slot: &Arc<Mutex<LiveSlot>>) -> MutexGuard<'_, LiveSlot> {
    slot.lock().unwrap_or_else(PoisonError::into_inner)
}

/** End the child and release the lease, returning what the handshake cost.
 *
 * `None` when there was no session to end. */
fn retire_session(slot: &mut LiveSlot) -> Option<ShutdownOutcome> {
    let mut session = slot.session.take()?;
    Some(session.shutdown())
}

/// Kill the child and release the lease as soon as it stops solving.
fn retire_if_stopped(slot: &mut LiveSlot, telemetry: &LiveTelemetry) {
    if !telemetry.running {
        let mut telemetry = telemetry.clone();
        // A worker that had to be killed is a worker whose solver never got to
        // halt itself, and that belongs in the log the engineer can read rather
        // than only in the exit status nobody sees.
        if let Some(outcome) = retire_session(slot) {
            if !outcome.exited_gracefully {
                telemetry.engine_log.push(format!(
                    "Tau's live ngspice worker did not exit within {} ms of being asked to, so it was killed after {} ms.",
                    LIVE_SHUTDOWN_GRACE.as_millis(),
                    outcome.elapsed.as_millis()
                ));
            }
        }
        slot.last = Some(telemetry);
    }
}

/** Decide who still owns the engine after the child has *refused* a command.
 *
 * A refusal is not a transport failure: the child answered, so the session is
 * intact by construction and the old code kept it. That is only right for the
 * refusals a run survives — a poll naming a vector the plot never published
 * leaves a perfectly healthy solve behind it. It was wrong for every other
 * refusal, and the asymmetry was invisible from here: the frontend treats a
 * failed call as the end of its session and stops asking, while the host still
 * holds the lease and the child still holds a core, so the run becomes an
 * orphan and every later Run is refused with "A live simulation is already
 * running" until Tau restarts.
 *
 * So the two sides are made to agree by asking the only party that knows.
 * `Status` costs one frame and reports whether the solver is still running; a
 * session that is not running is retired here and now — which drops the child,
 * halts the solver on the child's own way out, and releases the lease — and its
 * final telemetry is kept in `last` so the UI can still be told why. A child
 * that cannot even answer `Status` is retired for the same reason. Nothing is
 * left in a state where one side assumes the other cleaned up.
 *
 * The refusal itself is returned unchanged apart from the appended stop
 * detail: the caller asked for something and did not get it, and that stays
 * true whatever the session's fate.
 *
 * The one case this deliberately leaves alone — a refusal from a solver that is
 * still solving — is the case the frontend closes from its side: a failed call
 * ends its session *and* fires a best-effort `halt_live_spice`, which arrives
 * here as a Stop and retires the session the ordinary way. Neither side assumes
 * the other did it; they meet. */
fn settle_after_refusal(held: &mut LiveSlot, error: String) -> String {
    let Some(session) = held.session.as_mut() else {
        return error;
    };
    let status = session.request(&LiveRequestFrame::Status, LIVE_FRAME_TIMEOUT);
    let telemetry = match status {
        Ok(response) => response.telemetry,
        // The child stopped answering while explaining itself. Whatever the
        // first refusal meant, this session is over.
        Err(_) => None,
    };
    match telemetry {
        Some(telemetry) if telemetry.running => error,
        Some(telemetry) => {
            let detail = telemetry.stop_detail.clone();
            retire_if_stopped(held, &telemetry);
            match detail {
                Some(detail) => format!("{error} The live run is no longer solving: {detail}"),
                None => format!(
                    "{error} The live run is no longer solving, so Tau released the engine."
                ),
            }
        }
        None => {
            retire_session(held);
            format!("{error} Tau could not confirm what the live run is doing, so it stopped the worker and released the engine.")
        }
    }
}

#[tauri::command]
pub async fn start_live_spice(
    app: AppHandle,
    state: State<'_, LiveSpiceState>,
    request: LiveStartRequest,
) -> Result<LiveStartResponse, String> {
    // Reject a malformed deck before a process is spawned, exactly as the
    // bounded command does; the child repeats the check before ngspice sees it.
    deck_lines(&request.netlist)?;
    let candidates = library_candidates(&app);
    let slot = Arc::clone(&state.slot);

    tauri::async_runtime::spawn_blocking(move || {
        {
            let mut held = lock_slot(&slot);
            if held.session.is_some() {
                return Err(
                    "A live simulation is already running. Stop it before starting another."
                        .to_string(),
                );
            }
            held.last = None;
        }
        let lease = acquire_engine(EngineUse::Live)?;
        let mut session = LiveSession::spawn(lease)?;
        let response = session.request(
            &LiveRequestFrame::Start {
                request,
                library_candidates: candidates,
            },
            LIVE_START_TIMEOUT,
        )?;
        match (response.error, response.start) {
            (None, Some(start)) => {
                lock_slot(&slot).session = Some(session);
                Ok(start)
            }
            (Some(error), _) => Err(error),
            (None, None) => {
                Err("Tau's live ngspice worker returned an inconsistent response.".to_string())
            }
        }
    })
    .await
    .map_err(|error| format!("Tau's live ngspice task failed: {error}"))?
}

#[tauri::command]
pub async fn poll_live_spice(
    state: State<'_, LiveSpiceState>,
    request: LivePollRequest,
) -> Result<LiveSlicePayload, String> {
    let slot = Arc::clone(&state.slot);
    tauri::async_runtime::spawn_blocking(move || {
        let mut held = lock_slot(&slot);
        poll_locked(&mut held, request)
    })
    .await
    .map_err(|error| format!("Tau's live ngspice task failed: {error}"))?
}

/// Split from the command so the ownership rules above can be tested.
fn poll_locked(held: &mut LiveSlot, request: LivePollRequest) -> Result<LiveSlicePayload, String> {
    let session = held
        .session
        .as_mut()
        .ok_or_else(|| "No live simulation is running.".to_string())?;
    let response = match session.request(&LiveRequestFrame::Poll { request }, LIVE_FRAME_TIMEOUT) {
        Ok(response) => response,
        Err(error) => {
            // A worker that stopped answering is a worker that must not
            // keep the lease. Drop it here rather than waiting for a Stop
            // the user has no reason to press.
            retire_session(held);
            return Err(error);
        }
    };
    match (response.error, response.slice) {
        (None, Some(slice)) => {
            retire_if_stopped(held, &slice.telemetry);
            Ok(slice)
        }
        (Some(error), _) => Err(settle_after_refusal(held, error)),
        (None, None) => {
            Err("Tau's live ngspice worker returned an inconsistent response.".to_string())
        }
    }
}

#[tauri::command]
pub async fn alter_live_spice(
    state: State<'_, LiveSpiceState>,
    request: LiveAlterRequest,
) -> Result<LiveTelemetry, String> {
    // Validated in the parent as well as the child so a malformed knob turn
    // never reaches the pipe, and the refusal reads the same either way.
    alter_command(&request)?;
    let slot = Arc::clone(&state.slot);
    tauri::async_runtime::spawn_blocking(move || {
        let mut held = lock_slot(&slot);
        let session = held
            .session
            .as_mut()
            .ok_or_else(|| "No live simulation is running.".to_string())?;
        let response = session.request(&LiveRequestFrame::Alter { request }, LIVE_FRAME_TIMEOUT)?;
        finish_telemetry(&mut held, response)
    })
    .await
    .map_err(|error| format!("Tau's live ngspice task failed: {error}"))?
}

#[tauri::command]
pub async fn halt_live_spice(state: State<'_, LiveSpiceState>) -> Result<LiveTelemetry, String> {
    let slot = Arc::clone(&state.slot);
    tauri::async_runtime::spawn_blocking(move || {
        let mut held = lock_slot(&slot);
        let Some(session) = held.session.as_mut() else {
            return held
                .last
                .clone()
                .ok_or_else(|| "No live simulation is running.".to_string());
        };
        match session.request(&LiveRequestFrame::Halt, LIVE_FRAME_TIMEOUT) {
            Ok(response) => finish_telemetry(&mut held, response),
            Err(error) => {
                // Stop must stop. If the child will not answer, killing it is
                // still an honest stop, and saying so is better than leaving a
                // solver running behind a button that reported failure.
                retire_session(&mut held);
                Err(error)
            }
        }
    })
    .await
    .map_err(|error| format!("Tau's live ngspice task failed: {error}"))?
}

#[tauri::command]
pub async fn live_spice_status(
    state: State<'_, LiveSpiceState>,
) -> Result<Option<LiveTelemetry>, String> {
    let slot = Arc::clone(&state.slot);
    tauri::async_runtime::spawn_blocking(move || {
        let mut held = lock_slot(&slot);
        let Some(session) = held.session.as_mut() else {
            return Ok(held.last.clone());
        };
        match session.request(&LiveRequestFrame::Status, LIVE_FRAME_TIMEOUT) {
            Ok(response) => finish_telemetry(&mut held, response).map(Some),
            Err(error) => {
                retire_session(&mut held);
                Err(error)
            }
        }
    })
    .await
    .map_err(|error| format!("Tau's live ngspice task failed: {error}"))?
}

fn finish_telemetry(
    held: &mut LiveSlot,
    response: LiveResponseFrame,
) -> Result<LiveTelemetry, String> {
    match (response.error, response.telemetry) {
        (None, Some(telemetry)) => {
            retire_if_stopped(held, &telemetry);
            Ok(telemetry)
        }
        // Same ownership question as a refused poll, and the same answer: the
        // child answered, so ask it whether it is still solving before deciding
        // whether this session may keep the engine.
        (Some(error), _) => Err(settle_after_refusal(held, error)),
        (None, None) => {
            Err("Tau's live ngspice worker returned an inconsistent response.".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{io::Cursor, path::PathBuf, thread, time::Duration};

    use super::*;
    use crate::spice::real_engine_test_guard;

    // ── alter validation ───────────────────────────────────────────────────

    fn alter(instance: &str, parameter: Option<&str>, value: &str) -> Result<String, String> {
        alter_command(&LiveAlterRequest {
            instance: instance.to_string(),
            parameter: parameter.map(str::to_string),
            value: value.to_string(),
        })
    }

    #[test]
    fn a_knob_turn_becomes_exactly_one_alter_command() {
        assert_eq!(alter("R2", None, "3k").unwrap(), "alter r2 = 3k");
        assert_eq!(alter("V1", None, "2").unwrap(), "alter v1 = 2");
        assert_eq!(
            alter("Q1", Some("Area"), "1.5").unwrap(),
            "alter q1 area = 1.5"
        );
        assert_eq!(alter("C1", None, "-2.5E-3").unwrap(), "alter c1 = -2.5e-3");
        assert_eq!(alter("R1", None, "1MEG").unwrap(), "alter r1 = 1meg");
        assert_eq!(alter("R1", None, "5mil").unwrap(), "alter r1 = 5mil");
        assert_eq!(alter("R1", None, "100n").unwrap(), "alter r1 = 100n");
    }

    /** `ngSpice_Command` is the whole ngspice command interpreter, so anything
     * that can carry a separator out of a value or a designator is a way to run
     * `shell`, `source` or `destroy` inside the engine with a `.asc` file as
     * the author. Each case below is one such carrier. */
    #[test]
    fn nothing_that_could_carry_a_second_command_survives_validation() {
        for (instance, parameter, value) in [
            ("r2", None, "1k\ndestroy all"),
            ("r2", None, "1k; shell rm -rf /"),
            ("r2", None, "1k 2k"),
            ("r2", None, "$(whoami)"),
            ("r2\nsource /etc/passwd", None, "1k"),
            ("r2 v1", None, "1k"),
            ("", None, "1k"),
            ("2r", None, "1k"),
            ("r2", Some("r; destroy"), "1k"),
            ("r2", Some(""), "1k"),
            ("r2", None, ""),
            ("r2", None, "abc"),
            ("r2", None, "1kohm"),
            ("r2", None, "1e"),
            ("r2", None, "k"),
            ("r2", None, "1..2"),
            ("r2", None, "0x10"),
            ("r2", None, "nan"),
            ("r2", None, "inf"),
        ] {
            assert!(
                alter(instance, parameter, value).is_err(),
                "{instance:?}/{parameter:?}/{value:?} was accepted and must not be"
            );
        }
    }

    // ── retention arithmetic ───────────────────────────────────────────────

    /** The retention policy's whole contract in numbers: what does not fit in a
     * frame is skipped by an integer stride, never averaged and never
     * interpolated, and the count of what was skipped is recoverable. */
    #[test]
    fn a_frame_that_cannot_carry_the_tail_strides_it_and_the_loss_is_countable() {
        assert_eq!(decimation_stride(0, 2048), 1);
        assert_eq!(decimation_stride(100, 2048), 1);
        assert_eq!(decimation_stride(2048, 2048), 1);
        assert_eq!(decimation_stride(2049, 2048), 2);
        assert_eq!(decimation_stride(4096, 2048), 2);
        assert_eq!(decimation_stride(1_000_000, 2048), 489);

        for available in [0_usize, 1, 7, 2048, 2049, 5000, 1_000_000] {
            let stride = decimation_stride(available, 2048);
            let delivered = strided_count(available, stride);
            assert!(
                delivered <= 2048,
                "{available} samples delivered {delivered} in one frame"
            );
            assert_eq!(
                available - delivered,
                available.saturating_sub(delivered),
                "the dropped count must be exactly what was not delivered"
            );
        }
    }

    /** A caller may spend less of the machine on a live run than Tau's ceiling,
     * never more. The lower clamp exists because a budget under a frame's worth
     * of samples would end the run before the first frame, which is a
     * confusing way to spell "bounded run". */
    #[test]
    fn the_retention_budget_can_be_lowered_by_a_caller_but_never_raised() {
        assert_eq!(clamp_scalar_budget(None), LIVE_SCALAR_BUDGET);
        assert_eq!(clamp_scalar_budget(Some(0)), LIVE_MIN_SCALAR_BUDGET);
        assert_eq!(clamp_scalar_budget(Some(50_000)), 50_000);
        assert_eq!(
            clamp_scalar_budget(Some(usize::MAX)),
            LIVE_SCALAR_BUDGET,
            "a caller must not be able to ask for more of the machine than Tau's own ceiling"
        );
        assert_eq!(clamp_slice_samples(None), LIVE_DEFAULT_SLICE_SAMPLES);
        assert_eq!(clamp_slice_samples(Some(0)), 1);
        assert_eq!(
            clamp_slice_samples(Some(usize::MAX)),
            LIVE_MAX_SLICE_SAMPLES
        );
    }

    // ── mutual exclusion ───────────────────────────────────────────────────

    /** One engine at a time, and the refusal names which run is in the way.
     *
     * The bounded-vs-bounded wording is asserted verbatim because it predates
     * this module: adding the live interlock must not silently reword an error
     * the rest of Tau may already be matching on. */
    #[test]
    fn the_bounded_and_live_paths_cannot_both_hold_the_engine() {
        let _serialise = real_engine_test_guard();
        let bounded = acquire_engine(EngineUse::Bounded).expect("engine should be free");
        assert_eq!(
            acquire_engine(EngineUse::Bounded).unwrap_err(),
            "Another native ngspice analysis is already running."
        );
        assert!(acquire_engine(EngineUse::Live)
            .unwrap_err()
            .contains("Another native ngspice analysis"));
        drop(bounded);

        let live = acquire_engine(EngineUse::Live).expect("engine should be free again");
        assert!(acquire_engine(EngineUse::Bounded)
            .unwrap_err()
            .contains("A live simulation is running"));
        drop(live);
        drop(acquire_engine(EngineUse::Bounded).expect("dropping a lease must release the engine"));
    }

    // ── framing ────────────────────────────────────────────────────────────

    /** libngspice writes to the host's real stdout in places Tau does not
     * control, so a frame has to be findable inside a line that also carries
     * engine chatter — including chatter that never ended in a newline. */
    #[test]
    fn a_frame_is_recoverable_from_a_line_that_also_carries_engine_noise() {
        let frame = LiveResponseFrame::failed("nope".to_string());
        let mut buffer = Vec::new();
        write_live_frame(&mut buffer, &frame).expect("frame should write");
        let line = String::from_utf8(buffer).expect("frames are UTF-8");
        assert!(line.ends_with('\n'));

        let payload = frame_payload(line.trim_end()).expect("marker should be found");
        let decoded: LiveResponseFrame = serde_json::from_str(payload).expect("payload decodes");
        assert_eq!(decoded.error.as_deref(), Some("nope"));

        let glued = format!("Warning: singular matrix{}", line.trim_end());
        let payload = frame_payload(&glued).expect("marker should survive a glued prefix");
        assert!(serde_json::from_str::<LiveResponseFrame>(payload).is_ok());

        assert!(frame_payload("Warning: singular matrix").is_none());
    }

    /** A worker with no circuit refuses every command by name rather than
     * panicking or answering with an empty result. */
    #[test]
    fn a_worker_with_no_circuit_refuses_every_command_in_words() {
        let mut run = None;
        for frame in [
            LiveRequestFrame::Poll {
                request: LivePollRequest::default(),
            },
            LiveRequestFrame::Status,
            LiveRequestFrame::Halt,
            LiveRequestFrame::Alter {
                request: LiveAlterRequest {
                    instance: "r1".to_string(),
                    parameter: None,
                    value: "1k".to_string(),
                },
            },
        ] {
            let response = handle_live_frame(&mut run, frame);
            assert_eq!(response.error.as_deref(), Some(not_started().as_str()));
            assert!(response.slice.is_none() && response.telemetry.is_none());
        }
    }

    /** Stdin EOF is the parent-death signal, and it must end the child rather
     * than leave it waiting on a pipe nobody owns. Proven without ngspice
     * because the shape of the loop, not the engine, is what is at stake. */
    #[test]
    fn the_worker_loop_ends_when_its_parent_closes_the_pipe() {
        let input = Cursor::new(Vec::<u8>::new());
        let mut output = Vec::new();
        let finished = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = std::sync::Arc::clone(&finished);
        thread::scope(|scope| {
            scope.spawn(|| {
                serve_live_worker(input, &mut output);
                flag.store(true, std::sync::atomic::Ordering::Release);
            });
        });
        assert!(
            finished.load(std::sync::atomic::Ordering::Acquire),
            "the worker loop outlived its parent's stdin"
        );
    }

    /** An unreadable command is answered, not fatal: a live session that died
     * on one malformed frame would strand a running solver. */
    #[test]
    fn an_unreadable_command_is_answered_and_the_worker_stays_up() {
        let input = Cursor::new(b"{not json}\n{\"kind\":\"shutdown\"}\n".to_vec());
        let mut output = Vec::new();
        serve_live_worker(input, &mut output);
        let text = String::from_utf8(output).expect("frames are UTF-8");
        let payload = frame_payload(text.trim_end()).expect("the bad command was answered");
        let decoded: LiveResponseFrame = serde_json::from_str(payload).expect("payload decodes");
        assert!(decoded
            .error
            .unwrap_or_default()
            .contains("unreadable command"));
    }

    // ── session lifecycle (parent side, stand-in child) ────────────────────

    /** A child that speaks the frame protocol and nothing else.
     *
     * It exists because the two lifecycle rules below are about what the
     * *parent* does with a worker, not about ngspice: who owns the engine after
     * a refusal, and whether Stop is a handshake or an execution. Both were
     * wrong for months underneath a green suite precisely because no test could
     * reach them — `cargo test`'s binary cannot be re-executed as a live worker
     * (libtest rejects the argument), so the real child is unavailable here.
     *
     * The one behaviour it copies deliberately from the real worker is the last
     * line: on Shutdown it stops answering but **cannot exit until its stdin
     * reaches EOF**, because the real child's main loop joins a reader thread
     * parked in `read_until`. A stand-in that exited on the frame alone would
     * pass whether or not the parent ever closes the pipe, which is the whole
     * question. */
    fn stand_in_worker(
        poll_reply: &LiveResponseFrame,
        status_reply: &LiveResponseFrame,
    ) -> LiveSession {
        const SCRIPT: &str = r#"
mark='TAU_LIVE_FRAME_V1:'
while IFS= read -r line; do
  case "$line" in
    *'"poll"'*)     printf '%s%s\n' "$mark" "$TAU_TEST_POLL" ;;
    *'"shutdown"'*) exec cat >/dev/null ;;
    *)              printf '%s%s\n' "$mark" "$TAU_TEST_STATUS" ;;
  esac
done
"#;
        let mut command = std::process::Command::new("/bin/sh");
        command
            .arg("-c")
            .arg(SCRIPT)
            .env(
                "TAU_TEST_POLL",
                serde_json::to_string(poll_reply).expect("a reply frame encodes"),
            )
            .env(
                "TAU_TEST_STATUS",
                serde_json::to_string(status_reply).expect("a reply frame encodes"),
            );
        let lease = acquire_engine(EngineUse::Live).expect("the engine should be free");
        LiveSession::spawn_command(command, lease).expect("the stand-in worker should spawn")
    }

    fn telemetry_frame(telemetry: LiveTelemetry) -> LiveResponseFrame {
        LiveResponseFrame {
            error: None,
            start: None,
            slice: None,
            telemetry: Some(telemetry),
        }
    }

    /** A refusal must leave exactly one of the two sides owning the run, and
     * the deciding question is whether the solver is still solving.
     *
     * The frontend treats a failed call as the end of its session and stops
     * asking. So a refusal that leaves the host holding the lease produces an
     * orphan: a child still burning a core on a run nobody is reading, and
     * every later Run refused with "A live simulation is already running" until
     * the app restarts. The other error is just as real in the other direction
     * — a poll that named a vector the plot never published must not tear down
     * a healthy run — so both cases are asserted here. */
    #[test]
    fn a_refusal_retires_a_worker_that_has_stopped_and_spares_one_that_has_not() {
        let _serialise = real_engine_test_guard();

        let stopped = LiveTelemetry {
            running: false,
            stop_reason: Some(LiveStopReason::AnalysisComplete),
            stop_detail: Some(
                "The transient analysis in this deck reached its own end time.".to_string(),
            ),
            ..LiveTelemetry::default()
        };
        let mut slot = LiveSlot {
            session: Some(stand_in_worker(
                &LiveResponseFrame::failed("the live plot has gone".to_string()),
                &telemetry_frame(stopped),
            )),
            last: None,
        };
        let error = poll_locked(&mut slot, LivePollRequest::default())
            .expect_err("the stand-in worker refuses every poll");
        assert!(
            slot.session.is_none(),
            "a refusal from a worker that is no longer solving left the session holding the engine"
        );
        assert!(
            error.contains("the live plot has gone"),
            "the worker's own words must survive: {error}"
        );
        assert!(
            error.contains("reached its own end time"),
            "the refusal must carry why the run is over: {error}"
        );
        assert_eq!(
            slot.last.as_ref().and_then(|last| last.stop_reason),
            Some(LiveStopReason::AnalysisComplete),
            "retiring a session must keep the reason the UI still needs"
        );
        drop(
            acquire_engine(EngineUse::Bounded)
                .expect("retiring a live session must release the engine lease"),
        );

        let solving = LiveTelemetry {
            running: true,
            ..LiveTelemetry::default()
        };
        let mut slot = LiveSlot {
            session: Some(stand_in_worker(
                &LiveResponseFrame::failed(
                    "\"vout\" is not a vector this live run publishes.".to_string(),
                ),
                &telemetry_frame(solving),
            )),
            last: None,
        };
        let error = poll_locked(&mut slot, LivePollRequest::default())
            .expect_err("the stand-in worker refuses every poll");
        assert!(error.contains("is not a vector this live run publishes"));
        assert!(
            slot.session.is_some(),
            "a recoverable refusal tore down a run that is still solving"
        );
        assert!(
            acquire_engine(EngineUse::Bounded).is_err(),
            "a live run that survived a refusal must keep the engine"
        );
        drop(slot);
        drop(acquire_engine(EngineUse::Bounded).expect("dropping the session releases the engine"));
    }

    /** Stop is a handshake, and SIGKILL is the backstop — not the other way
     * round.
     *
     * The child cannot finish exiting until its stdin reaches EOF, so holding
     * the writing end open through the whole grace period made the graceful
     * path unreachable: every Stop waited out `LIVE_SHUTDOWN_GRACE` and then
     * killed a process that had already been told to leave. A killed child
     * never runs `LiveRun`'s drop, and that drop is the only thing that halts
     * the background solver before `dlclose` unloads the code it is running. */
    #[test]
    fn stopping_a_session_closes_the_pipe_the_worker_is_waiting_on() {
        let _serialise = real_engine_test_guard();
        let idle = telemetry_frame(LiveTelemetry {
            running: true,
            ..LiveTelemetry::default()
        });
        let mut session = stand_in_worker(&idle, &idle);
        session
            .request(&LiveRequestFrame::Status, LIVE_FRAME_TIMEOUT)
            .expect("the stand-in worker should answer before it is stopped");

        let outcome = session.shutdown();
        println!(
            "stop latency {:?}, graceful exit {}",
            outcome.elapsed, outcome.exited_gracefully
        );
        assert!(
            outcome.exited_gracefully,
            "the worker had to be killed after {:?}; Stop is still paying the full grace period",
            outcome.elapsed
        );
        assert!(
            outcome.elapsed < LIVE_SHUTDOWN_GRACE,
            "a graceful stop took {:?}, which is the grace period, not a handshake",
            outcome.elapsed
        );
    }

    // ── real-engine proofs ─────────────────────────────────────────────────
    //
    // These drive `LiveRun` directly rather than through the child process, for
    // the same reason the 1E spike did: the engine behaviour is what they are
    // about, and a process in the loop would only add latency to every
    // assertion. `maybe_run_live_spice_worker` cannot be reached from a test
    // binary — libtest owns argv and rejects `--tau-spice-live-worker` — but
    // that is not the same as the real chain being untestable from here, and
    // the unit F proofs at the bottom of this file do run it in a real child
    // (see `live_f_worker_child_entry`).
    //
    //   TAU_NGSPICE_LIB=build/ngspice-stage/lib/libngspice.dylib \
    //     cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml live_3a_ \
    //     -- --ignored --nocapture --test-threads=1

    /** A first-order RC driven hard enough that the solver has real work to do,
     * with an end time far past anything these tests wait for. Every proof here
     * stops on a wall-clock budget, which is exactly what a live UI must do. */
    const LIVE_RC_DECK: &str = "tau live rc
V1 in 0 SIN(0 1 1k)
R1 in out 1k
C1 out 0 100n
.tran 10u 600
.end";

    /** A 1:1 divider with a small hold cap: R2 is the pot and V1 the supply, so
     * a mid-run `alter` of either is the actuation the live feature promises.
     * RC = 50 us, so the node settles inside a quarter of a millisecond of
     * circuit time — far less than any window used below, which keeps "did the
     * waveform move?" a question about the engine and not about settling. */
    const LIVE_ACTUATION_DECK: &str = "tau live actuation
V1 in 0 1
R1 in mid 1k
R2 mid 0 1k
C1 mid 0 100n
.tran 10u 600
.end";

    /** The same RC, with a transient that ends by itself in a fraction of a
     * second. Every other live proof deliberately outlives the test; these two
     * are about what happens *after* the end.
     *
     * Twenty milliseconds of circuit time and not two, because `LiveRun::start`
     * has to observe `ngSpice_running` go true before it will hand the run
     * back, and a transient that finishes in single-digit milliseconds of wall
     * clock can beat that observation. Short enough to wait for, long enough to
     * be seen starting. */
    const LIVE_SHORT_DECK: &str = "tau live short rc
V1 in 0 SIN(0 1 1k)
R1 in out 1k
C1 out 0 100n
.tran 10u 20m
.end";

    fn live_candidates() -> Vec<PathBuf> {
        vec![std::env::var_os("TAU_NGSPICE_LIB")
            .map(PathBuf::from)
            .expect("TAU_NGSPICE_LIB must point to a shared ngspice library")]
    }

    fn start(request: LiveStartRequest) -> (LiveRun, LiveStartResponse) {
        LiveRun::start(live_candidates(), &request)
            .unwrap_or_else(|error| panic!("live run should start: {error}"))
    }

    fn rc_request() -> LiveStartRequest {
        LiveStartRequest {
            netlist: LIVE_RC_DECK.to_string(),
            stop_at_seconds: None,
            scalar_budget: None,
        }
    }

    fn poll(run: &mut LiveRun, names: &[&str]) -> LiveSlicePayload {
        run.poll(&LivePollRequest {
            names: names.iter().map(|name| name.to_string()).collect(),
            max_samples: None,
        })
        .expect("poll should succeed")
    }

    /** The claim the whole unit rests on: consecutive frames assemble into the
     * solver's own waveform, not a reconstruction of it.
     *
     * Asserted by comparing the incrementally assembled stream against one
     * whole-plot read taken after the halt. Only undecimated frames can be
     * compared sample-for-sample, so the frame budget is set high enough that
     * the RC deck never fills one; the decimated case is a separate proof
     * below, because it is a different promise. */
    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn live_3a_frames_assemble_into_the_waveform_the_solver_produced() {
        let _guard = real_engine_test_guard();
        let (mut run, started) = start(rc_request());
        assert!(
            started.vectors.iter().any(|name| name == "time"),
            "a live transient plot must publish a time axis, got {:?}",
            started.vectors
        );

        let mut time: Vec<f64> = Vec::new();
        let mut out: Vec<f64> = Vec::new();
        let mut worst_skew = 0_usize;
        let watch = Instant::now();
        while watch.elapsed() < Duration::from_millis(1500) {
            let slice = run
                .poll(&LivePollRequest {
                    names: vec!["time".to_string(), "out".to_string()],
                    max_samples: Some(LIVE_MAX_SLICE_SAMPLES),
                })
                .expect("poll should succeed");
            assert_eq!(slice.stride, 1, "the RC deck should not need decimation");
            assert_eq!(slice.from, time.len(), "frames must not overlap or skip");
            worst_skew = worst_skew.max(slice.skew);
            time.extend_from_slice(&slice.columns[0]);
            out.extend_from_slice(&slice.columns[1]);
            thread::sleep(Duration::from_millis(20));
        }

        let telemetry = run.halt(LiveStopReason::HaltedByUser, "test".to_string());
        println!(
            "3A assembled {} samples at {:.0} points/s, worst skew {worst_skew}, decimated {}",
            time.len(),
            telemetry.points_per_second,
            telemetry.decimated_samples
        );
        assert!(!time.is_empty(), "no samples were ever delivered");
        assert_eq!(
            telemetry.decimated_samples, 0,
            "an undecimated run must report no retention loss"
        );
        assert_eq!(telemetry.delivered_samples, time.len());
        assert_eq!(telemetry.stop_reason, Some(LiveStopReason::HaltedByUser));
        assert!(!telemetry.running, "halt must actually stop the solver");
        assert!(
            time.windows(2).all(|pair| pair[1] > pair[0]),
            "the assembled time axis was not strictly increasing"
        );
        assert!(out.iter().all(|value| value.is_finite()));

        // The exactness claim. One whole-plot read after the halt is the truth;
        // everything assembled from frames must match it sample for sample.
        let keys: Vec<&CString> = run.vector_keys.iter().collect();
        let indices: Vec<usize> = ["time", "out"]
            .iter()
            .map(|name| run.vectors.iter().position(|known| known == name).unwrap())
            .collect();
        let selected: Vec<&CString> = indices.iter().map(|index| keys[*index]).collect();
        let truth = run.read_slice(&selected, 0, usize::MAX);
        assert_eq!(
            &truth.columns[0][..time.len()],
            &time[..],
            "the assembled time axis is not the axis the solver produced"
        );
        assert_eq!(
            &truth.columns[1][..out.len()],
            &out[..],
            "the assembled waveform is not the waveform the solver produced"
        );
    }

    /** Decimation is allowed to drop samples; it is not allowed to invent one
     * or to lie about the drop. Every delivered pair must still be a pair the
     * solver produced, and `decimatedSamples` must account for the difference
     * exactly. */
    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn live_3a_decimated_frames_report_exactly_what_they_dropped() {
        let _guard = real_engine_test_guard();
        let (mut run, _) = start(rc_request());
        thread::sleep(Duration::from_millis(400));

        let mut delivered = 0_usize;
        let mut dropped = 0_usize;
        let mut spanned = 0_usize;
        let mut strides = Vec::new();
        for _ in 0..10 {
            let slice = run
                .poll(&LivePollRequest {
                    names: vec!["time".to_string(), "out".to_string()],
                    max_samples: Some(8),
                })
                .expect("poll should succeed");
            spanned += slice.cursor - slice.from;
            delivered += slice.columns[0].len();
            strides.push(slice.stride);
            assert!(
                slice.columns[0].len() <= 8,
                "a frame delivered more than the caller's budget"
            );
            thread::sleep(Duration::from_millis(60));
        }
        let telemetry = run.halt(LiveStopReason::HaltedByUser, "test".to_string());
        dropped += telemetry.decimated_samples;
        println!("3A decimation strides {strides:?}, spanned {spanned}, delivered {delivered}, dropped {dropped}");

        assert!(
            strides.iter().any(|stride| *stride > 1),
            "the RC deck outruns an 8-sample frame; decimation should have engaged: {strides:?}"
        );
        assert_eq!(
            spanned,
            delivered + dropped,
            "the retention loss reported to the UI does not account for the samples the solver produced"
        );
        assert!(
            telemetry.decimated_samples > 0,
            "a decimated run reported no retention loss"
        );
    }

    /** Halt, alter, resume, with the exact voltage asserted rather than
     * "something moved" — see `LiveRun::alter` for why the resistor case is the
     * one that matters. A divider answering 0.6 V after the pot went to 3k
     * would be a live plot of a circuit nobody drew. */
    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn live_3a_altering_a_pot_mid_run_moves_the_node_to_the_value_on_the_schematic() {
        let _guard = real_engine_test_guard();
        let (mut run, _) = start(LiveStartRequest {
            netlist: LIVE_ACTUATION_DECK.to_string(),
            stop_at_seconds: None,
            scalar_budget: None,
        });
        thread::sleep(Duration::from_millis(300));
        let before = poll(&mut run, &["time", "mid"]);
        assert!(
            !before.columns[1].is_empty(),
            "nothing solved before the alter"
        );

        let telemetry = run
            .alter(&LiveAlterRequest {
                instance: "R2".to_string(),
                parameter: None,
                value: "3k".to_string(),
            })
            .expect("a live pot should be alterable");
        assert!(telemetry.running, "the run must resume after an alter");
        thread::sleep(Duration::from_millis(400));

        let after = poll(&mut run, &["time", "mid"]);
        let settled: f64 = {
            let tail = &after.columns[1][after.columns[1].len().saturating_sub(64)..];
            tail.iter().sum::<f64>() / tail.len() as f64
        };
        let stopped = run.halt(LiveStopReason::HaltedByUser, "test".to_string());
        println!(
            "3A pot alter settled at {settled:.6} V after {} samples",
            stopped.solved_samples
        );

        assert!(
            after.from >= before.cursor,
            "the cursor went backwards across the alter, so history was re-delivered"
        );
        assert!(
            (settled - 0.75).abs() < 1e-3,
            "after altering R2 to 3k the node settled at {settled:.6} V, not the 0.750 V the altered divider has. Live actuation is not solving the circuit the user is holding."
        );
    }

    /** The retention ceiling is a real stop with a real name, not a number in a
     * comment. A budget of a few thousand scalars is reached almost at once by
     * the RC deck, which is the point: the same code path runs at 32e6. */
    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn live_3a_the_retention_budget_stops_the_run_and_names_the_reason() {
        let _guard = real_engine_test_guard();
        let (mut run, started) = start(LiveStartRequest {
            netlist: LIVE_RC_DECK.to_string(),
            stop_at_seconds: None,
            scalar_budget: Some(LIVE_MIN_SCALAR_BUDGET * 8),
        });
        let budget = started.telemetry.scalar_budget;
        assert_eq!(budget, LIVE_MIN_SCALAR_BUDGET * 8);

        let mut telemetry = started.telemetry;
        let deadline = Instant::now() + Duration::from_secs(30);
        while telemetry.running && Instant::now() < deadline {
            telemetry = poll(&mut run, &["time", "out"]).telemetry;
            thread::sleep(Duration::from_millis(20));
        }
        println!(
            "3A budget {budget} scalars reached at {} samples x {} traces, {:.0} points/s: {:?}",
            telemetry.solved_samples,
            telemetry.vector_count,
            telemetry.points_per_second,
            telemetry.stop_detail
        );

        assert_eq!(
            telemetry.stop_reason,
            Some(LiveStopReason::SampleBudget),
            "the run did not stop for the reason its budget says it should"
        );
        assert!(!telemetry.running);
        assert!(telemetry.scalars >= budget);
        let detail = telemetry.stop_detail.unwrap_or_default();
        assert!(
            detail.contains(&budget.to_string()) && detail.contains("points/s"),
            "the exhaustion message must state the budget and the achieved rate, got {detail:?}"
        );
    }

    /** A run with a declared end stops on a solved point at exactly that
     * instant, and reports that it did so deliberately. `ngSpice_SetBkpt` is
     * what makes the instant exact (1E-E); without it "stop at 3 ms" would mean
     * "stop just past 3 ms". */
    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn live_3a_a_requested_stop_time_lands_on_a_solved_point() {
        let _guard = real_engine_test_guard();
        let stop_at = 3.333_3e-3;
        let (mut run, _) = start(LiveStartRequest {
            netlist: LIVE_RC_DECK.to_string(),
            stop_at_seconds: Some(stop_at),
            scalar_budget: None,
        });

        let mut axis: Vec<f64> = Vec::new();
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            let slice = run
                .poll(&LivePollRequest {
                    names: vec!["time".to_string()],
                    max_samples: Some(LIVE_MAX_SLICE_SAMPLES),
                })
                .expect("poll should succeed");
            axis.extend_from_slice(&slice.columns[0]);
            if axis.last().copied().unwrap_or(0.0) > stop_at || Instant::now() >= deadline {
                break;
            }
            thread::sleep(Duration::from_millis(5));
        }
        let nearest = axis
            .iter()
            .map(|sample| (sample - stop_at).abs())
            .fold(f64::INFINITY, f64::min);
        run.halt(LiveStopReason::HaltedByUser, "test".to_string());
        println!("3A requested stop {stop_at:.6e} s: nearest solved point {nearest:.3e} s away");
        assert!(
            nearest <= stop_at * 1e-12,
            "the requested stop time is not a solved point (nearest {nearest:.3e} s away)"
        );
    }

    /** An actuation that lands after the run has ended is answered with the
     * completion, at once.
     *
     * Nothing has gone wrong when a user reaches for a switch as the transient
     * reaches its end time, so nothing may be reported as an error — and the
     * answer has to arrive at human speed, because the alternative this
     * replaced was a five-second stall ending in ENGINE ERROR. The deck here
     * ends on its own in about two milliseconds of circuit time, which makes
     * "the run is already over" the certain state rather than a race. */
    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn live_3b_a_knob_turned_after_the_run_ended_reports_the_completion() {
        let _guard = real_engine_test_guard();
        let (mut run, _) = start(LiveStartRequest {
            netlist: LIVE_SHORT_DECK.to_string(),
            stop_at_seconds: None,
            scalar_budget: None,
        });
        let waited = Instant::now();
        while run.running() && waited.elapsed() < Duration::from_secs(10) {
            thread::sleep(Duration::from_millis(5));
        }
        assert!(!run.running(), "the short deck should finish by itself");

        let asked = Instant::now();
        let telemetry = run
            .alter(&LiveAlterRequest {
                instance: "R1".to_string(),
                parameter: None,
                value: "2k".to_string(),
            })
            .expect("a knob turned at a finished run is not an error");
        let answered = asked.elapsed();
        println!(
            "3B knob after completion answered in {answered:?}: {:?} / {:?}",
            telemetry.stop_reason, telemetry.stop_detail
        );

        assert!(!telemetry.running);
        assert_eq!(
            telemetry.stop_reason,
            Some(LiveStopReason::AnalysisComplete),
            "a run that reached its own end time must say so, not stay silent"
        );
        assert!(
            answered < Duration::from_secs(1),
            "the answer took {answered:?}; an actuation at the end of a run must not stall"
        );
    }

    /** The two engine facts the actuation path now rests on, measured rather
     * than assumed.
     *
     * First: after a transient has ended, `bg_halt` finds the background thread
     * already gone and says so ("timeout = 0"), which is how Tau knows a resume
     * would not be resuming anything. Second: if that signal is ever missed,
     * `bg_resume` is not harmless — ngspice's `com_resume` sees
     * `ci_inprogress` false, prints "Note: run starting" and calls `com_run`,
     * re-running the whole analysis into a *second plot*. Classifying that as
     * "solving again" would publish another run's samples as a continuation of
     * this one, and classifying it as an engine error would call a completed
     * run a failure. Both are refused here, quickly. */
    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn live_3b_resuming_a_finished_transient_is_completion_not_an_engine_error() {
        let _guard = real_engine_test_guard();
        let (mut run, started) = start(LiveStartRequest {
            netlist: LIVE_SHORT_DECK.to_string(),
            stop_at_seconds: None,
            scalar_budget: None,
        });
        let waited = Instant::now();
        while run.running() && waited.elapsed() < Duration::from_secs(10) {
            thread::sleep(Duration::from_millis(5));
        }
        assert!(!run.running(), "the short deck should finish by itself");

        let before = peek_messages(&run.engine.callback_state).len();
        run.raw_command("bg_halt").expect("bg_halt is accepted");
        assert!(
            run.halt_found_nothing_to_stop(before),
            "ngspice no longer reports that the halt found the solver already gone, so Tau's one chance to avoid re-running the analysis is missing: {:?}",
            peek_messages(&run.engine.callback_state)
        );

        // Deliberately resume anyway: this is the state the check above exists
        // to avoid, and the classifier must still be right when it is reached.
        run.raw_command("bg_resume").expect("bg_resume is accepted");
        let asked = Instant::now();
        let verdict = run.confirm_resumed();
        let answered = asked.elapsed();
        let plot_now = unsafe { c_string((run.engine.api.cur_plot)()) };
        println!(
            "3B resume after completion verdict {} in {answered:?}; plot {:?} -> {plot_now:?}",
            match verdict {
                ResumeVerdict::Solving => "solving",
                ResumeVerdict::Finished => "finished",
                ResumeVerdict::Restarted => "restarted",
                ResumeVerdict::Failed(_) => "failed",
            },
            started.plot
        );
        run.force_halt();

        match verdict {
            ResumeVerdict::Restarted | ResumeVerdict::Finished => {}
            ResumeVerdict::Solving => panic!(
                "a re-run of the analysis into {plot_now:?} was accepted as a continuation of {:?}",
                started.plot
            ),
            ResumeVerdict::Failed(detail) => {
                panic!("a completed run was reported as an engine failure: {detail}")
            }
        }
        assert!(
            answered < Duration::from_secs(1),
            "the verdict took {answered:?}; the engineer must not wait out {LIVE_BG_STATE_TIMEOUT:?} to be told the run finished"
        );
    }

    /** A name the engine never published must not reach `ngGet_Vec_Info`, which
     * parses `plot.vector` syntax and walks the plot list to satisfy whatever
     * it is handed. */
    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn live_3a_only_vectors_the_engine_published_can_be_polled() {
        let _guard = real_engine_test_guard();
        let (mut run, _) = start(rc_request());
        let error = run
            .poll(&LivePollRequest {
                names: vec!["const.pi".to_string()],
                max_samples: None,
            })
            .expect_err("an unpublished vector must be refused");
        assert!(
            error.contains("not a vector this live run publishes"),
            "{error}"
        );
        run.halt(LiveStopReason::HaltedByUser, "test".to_string());
    }

    // ── the whole chain, end to end (unit F) ───────────────────────────────
    //
    // Everything above proves one layer at a time: the framing without an
    // engine, the engine without a process, the parent's ownership rules
    // against a shell script. Nothing above proves that a run started the way
    // the *app* starts one produces the samples the app asked for — and that
    // gap is not theoretical. A frontend test whose mock declared
    // `vectors: ["time", "v(out)"]` agreed with a bug for as long as it
    // existed, because ngspice publishes bare `out` and no test anywhere had
    // ever asked the library what it actually publishes.
    //
    // So these proofs run the real library, and two of them run it in a real
    // child process over the real pipe protocol.

    /** Environment flag that turns {@link live_f_worker_child_entry} into a
     * live ngspice worker instead of a test.
     *
     * Read rather than argv-matched because argv belongs to libtest here: the
     * child is `cargo test`'s own binary, invoked with a test filter. */
    const LIVE_TEST_WORKER_ENV: &str = "TAU_LIVE_TEST_WORKER_CHILD";
    /** The `--exact` name of that entry point. A constant because a filter that
     * matches nothing is libtest's most dangerous answer: it exits 0 having run
     * "0 tests". Here that is at least loud — the child exits at once, the
     * parent's `Start` finds a closed pipe and fails with "worker exited
     * unexpectedly" — but a renamed test should not cost anyone that
     * investigation. */
    const LIVE_TEST_WORKER_TEST: &str = "live_spice::tests::live_f_worker_child_entry";

    /** The child half of the two process-level proofs below.
     *
     * `maybe_run_live_spice_worker` cannot be used from a test binary — libtest
     * owns argv and rejects `--tau-spice-live-worker` — which is why the
     * comment above once said the real chain was untestable from here. It is
     * not: libtest will happily run *one named ignored test*, and that test can
     * be `serve_live_worker` itself. The child is then the same code the
     * packaged app runs, hosting the same library, speaking the same protocol
     * down the same pipes. `spice.rs` already reaches its own crash probe this
     * way (`live_1e_a_senddata_probe_child`); this is the same door.
     *
     * What this arrangement additionally proves, for free, is the reason
     * `LIVE_FRAME_MARKER` exists. libtest prints `test <name> ... ` to stdout
     * with no trailing newline before the body runs, so the first frame this
     * writes is genuinely appended to somebody else's half-written line —
     * exactly the ngspice `fprintf(stdout, …)` case the marker was designed
     * for, and the parent recovers the frame from it.
     *
     * A no-op when the flag is absent, so the ordinary suites that match
     * `live_` cannot hang waiting on a stdin nobody is writing to. */
    #[test]
    #[ignore = "entry point for the child process the live_f3/live_f4 proofs spawn"]
    fn live_f_worker_child_entry() {
        if std::env::var_os(LIVE_TEST_WORKER_ENV).is_none() {
            return;
        }
        let stdout = std::io::stdout();
        serve_live_worker(BufReader::new(std::io::stdin()), stdout.lock());
    }

    /// One real worker child, holding the engine lease, with nothing loaded yet.
    fn spawn_real_worker() -> LiveSession {
        let mut command =
            Command::new(std::env::current_exe().expect("a test binary must know its own path"));
        command
            .args([
                "--exact",
                "--ignored",
                "--nocapture",
                "--test-threads=1",
                LIVE_TEST_WORKER_TEST,
            ])
            .env(LIVE_TEST_WORKER_ENV, "1");
        let lease = acquire_engine(EngineUse::Live)
            .expect("no other run may hold the engine when a live proof starts");
        LiveSession::spawn_command(command, lease).expect("the live worker child should spawn")
    }

    /** A worker child with a circuit energised, in a `LiveSlot`, i.e. the state
     * `start_live_spice` leaves behind. The Tauri command itself needs an
     * `AppHandle` for `library_candidates`; everything after that resolution is
     * reproduced exactly. */
    fn start_real_session(request: LiveStartRequest) -> (LiveSlot, LiveStartResponse) {
        let mut session = spawn_real_worker();
        let response = session
            .request(
                &LiveRequestFrame::Start {
                    request,
                    library_candidates: live_candidates(),
                },
                LIVE_START_TIMEOUT,
            )
            .expect("the worker child should answer a start");
        let start = match (response.error, response.start) {
            (None, Some(start)) => start,
            (error, _) => panic!("the worker child refused the deck: {error:?}"),
        };
        (
            LiveSlot {
                session: Some(session),
                last: None,
            },
            start,
        )
    }

    /** `liveVectorSpellings` from `engine/nativeLive.ts`, transcribed.
     *
     * Transcribed and not approximated: this is the frontend's whole theory of
     * how its own names relate to the engine's, and the point of the proof is
     * to run *that* theory against the library rather than a Rust idea of it.
     * A drift between the two shows up as this file's assertions passing while
     * the product's resolver misses — so the mapping is kept in the same shape
     * as the original, including the refusal to touch anything that is not a
     * single-argument call. */
    fn live_vector_spellings(vector: &str) -> Vec<String> {
        let trimmed = vector.trim();
        if trimmed.is_empty() {
            return Vec::new();
        }
        let mut spellings = vec![trimmed.to_string()];
        let call = trimmed
            .strip_suffix(')')
            .and_then(|head| head.split_once('('))
            .filter(|(function, argument)| {
                !function.is_empty()
                    && function.chars().all(|c| c.is_ascii_alphabetic())
                    && !argument.trim().is_empty()
                    && !argument.contains([',', '(', ')'])
            });
        if let Some((function, argument)) = call {
            let argument = argument.trim();
            match function.to_ascii_lowercase().as_str() {
                "v" => spellings.push(argument.to_string()),
                "i" => spellings.push(format!("{argument}#branch")),
                _ => {}
            }
        }
        spellings
    }

    /// `resolveLiveVectorNames` from `engine/nativeLive.ts`: (polled, dropped).
    fn resolve_live_vector_names(
        requested: &[String],
        latched: &[String],
    ) -> (Vec<String>, Vec<String>) {
        let mut names = Vec::new();
        let mut unpublished = Vec::new();
        for request in requested {
            let hit = live_vector_spellings(request)
                .into_iter()
                .find_map(|spelling| {
                    latched
                        .iter()
                        .find(|name| name.trim().eq_ignore_ascii_case(spelling.trim()))
                        .cloned()
                });
            match hit {
                Some(name) => names.push(name),
                None => unpublished.push(request.clone()),
            }
        }
        (names, unpublished)
    }

    /** A deck shaped like one Tau emits for a schematic with a switch and a
     * pot: net names the importer produces (`n001`), a named node (`out`), the
     * emitter's derived contact resistor `R_SW1` and its pot legs
     * `R_POT1_a` / `R_POT1_b`.
     *
     * The device names are not decorative. `liveActuation.ts` builds them with
     * `R_${safeName(label)}` / `_a` / `_b`, and an `alter` against a name the
     * deck does not use is accepted by ngspice and does nothing at all — so a
     * proof that invented its own instance names would prove that altering
     * works while the product altered nothing. */
    const LIVE_APP_DECK: &str = "tau live app deck
V1 in 0 SIN(0 5 1k)
R1 in out 1k
R_SW1 out n001 1e12
R_POT1_a n001 mid 5k
R_POT1_b mid 0 5k
C1 out 0 100n
.tran 10u 600
.end";

    /** The switch shape `planStaticContact` really emits: one series resistor
     * carrying `CONTACT_OPEN_OHMS` (1e12) or `CONTACT_CLOSED_OHMS` (1m).
     *
     * Open, `out` sits at the 1 V rail through R1; closed, the 1 mΩ contact
     * pulls it to within a microvolt of ground. Twelve orders of magnitude of
     * conductance in one `alter` is the stamp that would break first if a
     * future ngspice stopped refreshing `RESconduct` on resume, which is why
     * the assertion is on the two exact voltages and not on "it moved". */
    const LIVE_SWITCH_DECK: &str = "tau live switch
V1 in 0 1
R1 in out 1k
R_SW1 out 0 1e12
C1 out 0 100n
.tran 10u 600
.end";

    /// The two pot legs `planWiper` alters, at the emitter's own 50 % split.
    const LIVE_POT_DECK: &str = "tau live pot
V1 in 0 1
R_POT1_a in mid 5k
R_POT1_b mid 0 5k
C1 mid 0 100n
.tran 10u 600
.end";

    /** A deck whose own device evaluation goes non-finite, because on this
     * engine build a *runaway* one does not.
     *
     * Measured while writing this, on the staged libngspice: an ideal
     * positive-feedback integrator (`C1 out 0 1` / `G1 0 out out 0 1`, i.e.
     * dV/dt = V) climbs to 3.3e306 and is then killed by ngspice's own timestep
     * control — "Timestep too small … run simulation(s) aborted" — before any
     * sample overflows. The same happened at every growth rate tried, because
     * the local-truncation estimate is a third derivative and overflows before
     * the solution does. B-source arithmetic is clamped too (`exp` saturates at
     * 1e99, division by zero at 1e32). So the honest way to reach the
     * non-finite guard is a device whose constitutive relation is itself
     * undefined: `atanh` outside (-1, 1) returns NaN, and the pulse steps the
     * argument from 0.5 to 2 partway through the run. The samples before the
     * step are a real solved waveform, which is the half of the promise that
     * says the approach to a blow-up must still be shown.
     *
     * See the unit report for the separate defect this measurement exposed:
     * the aborted-runaway case is currently reported as `analysis-complete`. */
    const LIVE_NON_FINITE_DECK: &str = "tau live non-finite
V2 z 0 PULSE(0.5 2 200u 1n 1n 1 1)
B1 out 0 V=atanh(V(z))
R1 out 0 1k
.tran 10u 500u
.end";

    /** The premise the frontend's whole live plot rests on: **ngspice publishes
     * bare node names, and the app asks for `v(<net>)`**.
     *
     * `liveScopeChannelRequests` (App.tsx) emits one `v(<net id>)` per
     * plottable net, and `resolveLiveVectorNames` (engine/nativeLive.ts) maps
     * those onto whatever `AllVecs` latched. Nothing in the product tests that
     * mapping against the library — the frontend suite mocks the boundary, and
     * a mock that declared `vectors: ["time", "v(out)"]` once made a real bug
     * invisible for as long as it lived. So this asserts what the engine
     * actually latches, in both directions: the bare spelling is there, the
     * parenthesised one is not, and the resolver's translation is the only
     * reason a poll succeeds.
     *
     * If a future ngspice starts publishing `v(out)`, the resolver keeps
     * working (it tries the caller's spelling first) but its premise is gone —
     * and this fails loudly here rather than silently somewhere downstream. */
    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn live_f1_the_names_the_app_asks_for_resolve_onto_what_ngspice_publishes() {
        let _guard = real_engine_test_guard();
        let (mut run, started) = start(LiveStartRequest {
            netlist: LIVE_APP_DECK.to_string(),
            stop_at_seconds: None,
            scalar_budget: None,
        });
        println!("F1 plot {:?} latched {:?}", started.plot, started.vectors);

        // What App.tsx would put on the wire for this circuit's nets, in its
        // own format string, plus the branch current spelling the resolver
        // also claims to handle.
        let requested: Vec<String> = ["out", "n001", "mid", "in"]
            .iter()
            .map(|net| format!("v({net})"))
            .chain(["i(V1)".to_string()])
            .collect();

        for net in ["out", "n001", "mid", "in", "time"] {
            assert!(
                started
                    .vectors
                    .iter()
                    .any(|name| name.eq_ignore_ascii_case(net)),
                "the live plot did not publish the bare node name {net:?}: {:?}",
                started.vectors
            );
        }
        for name in &started.vectors {
            assert!(
                !name.contains('(') && !name.contains(')'),
                "ngspice published {name:?}; the app's resolver assumes bare names and would now need revisiting"
            );
        }

        let (names, unpublished) = resolve_live_vector_names(&requested, &started.vectors);
        assert!(
            unpublished.is_empty(),
            "the resolver would drop channels this circuit really has: {unpublished:?}"
        );
        assert_eq!(
            names,
            vec!["out", "n001", "mid", "in", "v1#branch"],
            "the app's channel names did not translate onto the engine's own spelling"
        );

        // The translation is load-bearing, not decorative: the app's own
        // spelling is refused by the run it was computed for.
        let refused = run
            .poll(&LivePollRequest {
                names: vec!["v(out)".to_string()],
                max_samples: None,
            })
            .expect_err("a parenthesised app channel name must not be pollable directly");
        assert!(
            refused.contains("not a vector this live run publishes"),
            "{refused}"
        );

        // A net this deck does not have is reported, never plotted flat.
        let (_, missing) = resolve_live_vector_names(&["v(nowhere)".to_string()], &started.vectors);
        assert_eq!(missing, vec!["v(nowhere)".to_string()]);

        thread::sleep(Duration::from_millis(200));
        let mut with_axis = vec!["time".to_string()];
        with_axis.extend(names.iter().cloned());
        let slice = run
            .poll(&LivePollRequest {
                names: with_axis.clone(),
                max_samples: Some(LIVE_MAX_SLICE_SAMPLES),
            })
            .expect("the resolved names must poll");
        let telemetry = run.halt(LiveStopReason::HaltedByUser, "test".to_string());
        println!(
            "F1 delivered {} samples on {} channels ({} solved)",
            slice.columns[0].len(),
            slice.columns.len() - 1,
            telemetry.solved_samples
        );

        assert_eq!(slice.names.len(), with_axis.len());
        assert!(
            !slice.columns[0].is_empty(),
            "the app's channel set produced no samples at all"
        );
        for (index, column) in slice.columns.iter().enumerate() {
            assert_eq!(
                column.len(),
                slice.columns[0].len(),
                "channel {:?} came back a different length from the time axis",
                slice.names[index]
            );
            assert!(
                column.iter().all(|value| value.is_finite()),
                "channel {:?} delivered a non-finite sample",
                slice.names[index]
            );
        }
        // Not just "some numbers": the divider tap must be a real fraction of
        // the node above it, or the columns are in the wrong order.
        let out = slice.columns[1].last().copied().expect("v(out)");
        let n001 = slice.columns[2].last().copied().expect("v(n001)");
        assert!(
            n001.abs() < out.abs().max(1e-12),
            "v(n001) {n001} is not below v(out) {out}; the 1e12 open contact between them is not in this plot"
        );
    }

    /** The switch the app really emits, altered mid-run, changing the samples
     * after the flip and none of the ones before it.
     *
     * `live_3a_altering_a_pot_mid_run…` proves a resistor `alter` reaches the
     * matrix. This proves the shape the product actually sends: the emitter's
     * derived instance name (`R_SW1`, not an invented `S1`) and the emitter's
     * own contact values, which are twelve orders of magnitude apart. It also
     * proves the half nobody had asserted — that the actuation is not
     * retroactive. A live plot whose history changed under the engineer when a
     * switch closed would be a plot of no circuit at all, so the samples
     * delivered before the alter are re-read from the engine afterwards and
     * compared point for point. */
    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn live_f2_the_switch_the_app_emits_changes_only_the_samples_after_the_flip() {
        let _guard = real_engine_test_guard();
        let (mut run, _) = start(LiveStartRequest {
            netlist: LIVE_SWITCH_DECK.to_string(),
            stop_at_seconds: None,
            scalar_budget: None,
        });
        thread::sleep(Duration::from_millis(300));
        let before = poll(&mut run, &["time", "out"]);
        assert!(
            !before.columns[1].is_empty(),
            "nothing solved before the contact closed"
        );
        let open_tail = tail_mean(&before.columns[1]);

        // `CONTACT_CLOSED_OHMS` from simulation/liveActuation.ts, on the
        // instance `derivedResistor` names for a switch labelled SW1.
        let telemetry = run
            .alter(&LiveAlterRequest {
                instance: "R_SW1".to_string(),
                parameter: None,
                value: "1m".to_string(),
            })
            .expect("the emitter's contact resistor should be alterable");
        assert!(
            telemetry.running,
            "the run must resume after a contact flip"
        );
        thread::sleep(Duration::from_millis(400));

        let after = poll(&mut run, &["time", "out"]);
        let closed_tail = tail_mean(&after.columns[1]);

        // The history the engineer already saw, read back from the engine.
        let keys: Vec<&CString> = run.vector_keys.iter().collect();
        let indices: Vec<usize> = ["time", "out"]
            .iter()
            .map(|name| run.vectors.iter().position(|known| known == name).unwrap())
            .collect();
        let selected: Vec<&CString> = indices.iter().map(|index| keys[*index]).collect();
        let whole = run.read_slice(&selected, 0, usize::MAX);
        let stopped = run.halt(LiveStopReason::HaltedByUser, "test".to_string());
        println!(
            "F2 switch: open tail {open_tail:.6} V, closed tail {closed_tail:.6} V, {} samples",
            stopped.solved_samples
        );

        assert!(
            after.from >= before.cursor,
            "the cursor went backwards across the flip, so history was re-delivered"
        );
        assert!(
            (open_tail - 1.0).abs() < 1e-3,
            "with the 1e12 contact open the node should sit on the 1 V rail, not at {open_tail:.6} V"
        );
        assert!(
            closed_tail.abs() < 1e-3,
            "after closing the 1 mΩ contact the node should be pulled to ground, not left at {closed_tail:.6} V. The switch the app emits is not reaching the running matrix."
        );
        assert_history_intact(&before, 1, &whole.columns[1], "closing the switch");
    }

    /** The pot the app really emits: two legs, altered grow-before-shrink, on
     * the instance names `planWiper` derives.
     *
     * The ordering is the emitter's safety property (see `planLiveActuation`),
     * so it is the ordering asserted here; the tap must land on the value the
     * schematic now shows, and the samples that were already delivered must
     * still describe the pot the user was holding when they were solved. */
    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn live_f2_the_pot_legs_the_emitter_names_move_only_the_samples_after_the_drag() {
        let _guard = real_engine_test_guard();
        let (mut run, _) = start(LiveStartRequest {
            netlist: LIVE_POT_DECK.to_string(),
            stop_at_seconds: None,
            scalar_budget: None,
        });
        thread::sleep(Duration::from_millis(300));
        let before = poll(&mut run, &["time", "mid"]);
        let half = tail_mean(&before.columns[1]);

        // Grow before shrink, exactly as `planWiper` orders the two steps.
        for (instance, value) in [("R_POT1_b", "8k"), ("R_POT1_a", "2k")] {
            let telemetry = run
                .alter(&LiveAlterRequest {
                    instance: instance.to_string(),
                    parameter: None,
                    value: value.to_string(),
                })
                .unwrap_or_else(|error| panic!("{instance} should be alterable: {error}"));
            assert!(telemetry.running, "the run must resume after {instance}");
        }
        thread::sleep(Duration::from_millis(400));

        let after = poll(&mut run, &["time", "mid"]);
        let dragged = tail_mean(&after.columns[1]);

        let keys: Vec<&CString> = run.vector_keys.iter().collect();
        let indices: Vec<usize> = ["time", "mid"]
            .iter()
            .map(|name| run.vectors.iter().position(|known| known == name).unwrap())
            .collect();
        let selected: Vec<&CString> = indices.iter().map(|index| keys[*index]).collect();
        let whole = run.read_slice(&selected, 0, usize::MAX);
        run.halt(LiveStopReason::HaltedByUser, "test".to_string());
        println!("F2 pot: tap {half:.6} V before the drag, {dragged:.6} V after");

        assert!(
            (half - 0.5).abs() < 1e-3,
            "the 5k/5k pot should tap half the rail, not {half:.6} V"
        );
        assert!(
            (dragged - 0.8).abs() < 1e-3,
            "after dragging the wiper to the 2k/8k split the tap should sit at 0.800 V, not {dragged:.6} V"
        );
        assert_history_intact(&before, 1, &whole.columns[1], "dragging the wiper");
    }

    /// Mean of the last few samples, i.e. where a settled node ended up.
    fn tail_mean(column: &[f64]) -> f64 {
        let tail = &column[column.len().saturating_sub(64)..];
        tail.iter().sum::<f64>() / tail.len() as f64
    }

    /** Every sample a frame delivered is still, bit for bit, what the engine's
     * plot holds at the index that frame says it came from.
     *
     * Indexed through `from + offset * stride` rather than compared as a
     * contiguous prefix, because a live frame of a fast deck IS decimated —
     * these runs solve ~500k points/s and a frame carries at most a couple of
     * thousand. So this checks two things at once: that an actuation did not
     * rewrite history, and that the `from`/`stride` arithmetic the UI uses to
     * place a decimated frame on its time axis actually addresses the samples
     * the frame contained. A stride the child reported but did not apply would
     * put every point of a live trace at the wrong time. */
    fn assert_history_intact(
        frame: &LiveSlicePayload,
        column: usize,
        engine_column: &[f64],
        what: &str,
    ) {
        let delivered = &frame.columns[column];
        assert!(
            !delivered.is_empty(),
            "{what}: nothing had been delivered before the change, so there is no history to check"
        );
        for (offset, value) in delivered.iter().enumerate() {
            let index = frame.from + offset * frame.stride;
            assert_eq!(
                engine_column.get(index).copied(),
                Some(*value),
                "{what} changed sample {index}: the engineer was shown {value}, the plot now holds {:?}",
                engine_column.get(index)
            );
        }
    }

    /** Stop, through the real child, measured: prompt, graceful, and leaving
     * nothing behind that could refuse the next Run.
     *
     * The failure this guards against is the one users actually hit — Stop
     * appears to work, and every later Run is refused with "A live simulation
     * is already running" until the app restarts. Three independent things have
     * to be true for that not to happen, and each is checked against the
     * operating system rather than against Tau's own bookkeeping: the child
     * process is gone (asked of `ps`, by pid), the engine lease is free (asked
     * of `acquire_engine`), and a second run can energise a circuit at once
     * (done, and its samples read).
     *
     * Graceful matters as much as fast. A child killed by SIGKILL never runs
     * `LiveRun`'s drop, and that drop is the only thing that halts the
     * background solver before `dlclose` unloads the code it is executing — so
     * the retirement path's own "had to be killed" note is asserted absent. */
    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn live_f3_stop_is_prompt_and_leaves_neither_a_worker_nor_a_lease_behind() {
        let _guard = real_engine_test_guard();
        let (mut slot, _) = start_real_session(rc_request());
        let pid = slot
            .session
            .as_ref()
            .expect("a session was just started")
            .child
            .id();

        let first = poll_locked(
            &mut slot,
            LivePollRequest {
                names: vec!["time".to_string(), "out".to_string()],
                max_samples: Some(64),
            },
        )
        .expect("the live child should deliver a frame");
        assert!(
            !first.columns[0].is_empty(),
            "the child produced no samples before Stop"
        );

        // `halt_live_spice`'s body, which is all of it that does not need an
        // AppHandle: one Halt frame, then the shared retirement rule.
        let pressed = Instant::now();
        let response = slot
            .session
            .as_mut()
            .expect("still running")
            .request(&LiveRequestFrame::Halt, LIVE_FRAME_TIMEOUT)
            .expect("the child should answer a halt");
        let telemetry = finish_telemetry(&mut slot, response).expect("halt should succeed");
        let stop_latency = pressed.elapsed();

        let alive = Command::new("/bin/ps")
            .args(["-p", &pid.to_string(), "-o", "pid="])
            .output()
            .expect("ps should run");
        let survivor = String::from_utf8_lossy(&alive.stdout).trim().to_string();
        println!(
            "F3 stop latency {stop_latency:?} after {} solved samples; pid {pid} survivor {survivor:?}",
            telemetry.solved_samples
        );

        assert_eq!(telemetry.stop_reason, Some(LiveStopReason::HaltedByUser));
        assert!(!telemetry.running);
        assert!(
            slot.session.is_none(),
            "Stop left the worker session in the slot, so the next Run will be refused"
        );
        assert!(
            !telemetry
                .engine_log
                .iter()
                .any(|line| line.contains("did not exit within")),
            "the worker had to be killed, so its solver never got to halt itself: {:?}",
            telemetry.engine_log
        );
        assert!(
            survivor.is_empty(),
            "the worker process {pid} outlived the Stop that was supposed to end it"
        );
        assert!(
            stop_latency < Duration::from_secs(1),
            "Stop took {stop_latency:?}; a button that takes a second to stop a solver reads as broken"
        );

        // The lease, asked of the thing that hands it out.
        drop(
            acquire_engine(EngineUse::Bounded)
                .expect("Stop must leave the engine free for the next analysis"),
        );

        // And the claim that matters to the user: Run works again, now.
        let restarted = Instant::now();
        let (mut second, started) = start_real_session(rc_request());
        let restart = restarted.elapsed();
        assert!(
            started.vectors.iter().any(|name| name == "time"),
            "the second run published no time axis: {:?}",
            started.vectors
        );
        let frame = poll_locked(
            &mut second,
            LivePollRequest {
                names: vec!["time".to_string(), "out".to_string()],
                max_samples: Some(64),
            },
        )
        .expect("the second live run should deliver a frame");
        println!(
            "F3 second run energised in {restart:?}, first frame {} samples",
            frame.columns[0].len()
        );
        assert!(
            !frame.columns[0].is_empty(),
            "the second run started but produced no samples"
        );
        retire_session(&mut second);
        drop(acquire_engine(EngineUse::Bounded).expect("the second run released the engine too"));
    }

    /** A run that ended by itself and a run the engineer stopped are different
     * facts, and they stay different all the way out to the JSON the renderer
     * receives.
     *
     * The frontend acts on this: `nativeLive.ts` switches on the kebab-case
     * spelling to decide whether the run "completed" or "was stopped", and the
     * UI says so in words. If both arrived as the same string the app would
     * either accuse the engine of stopping a run the user stopped, or claim a
     * run finished when the user ended it early. So both payloads are
     * serialised here exactly as Tauri serialises them and asserted on the
     * wire, not on the Rust enum — a `#[serde(rename_all)]` change would
     * otherwise pass every Rust test and break the product. */
    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn live_f4_a_run_that_ended_by_itself_is_not_a_user_stop_on_the_wire() {
        let _guard = real_engine_test_guard();

        // 1. A deck that reaches its own end time while the UI is polling.
        let (mut slot, _) = start_real_session(LiveStartRequest {
            netlist: LIVE_SHORT_DECK.to_string(),
            stop_at_seconds: None,
            scalar_budget: None,
        });
        let deadline = Instant::now() + Duration::from_secs(20);
        let ended = loop {
            let frame = poll_locked(
                &mut slot,
                LivePollRequest {
                    names: vec!["time".to_string(), "out".to_string()],
                    max_samples: Some(LIVE_MAX_SLICE_SAMPLES),
                },
            )
            .expect("polling a finishing run is not an error");
            if frame.telemetry.stop_reason.is_some() {
                break frame;
            }
            assert!(
                Instant::now() < deadline,
                "the short deck never finished by itself"
            );
            thread::sleep(Duration::from_millis(10));
        };
        let self_ended = serde_json::to_string(&ended).expect("a slice payload serialises");
        println!(
            "F4 self-ended after {} samples: {:?}",
            ended.telemetry.solved_samples, ended.telemetry.stop_detail
        );
        assert!(
            slot.session.is_none(),
            "a run that ended by itself kept its worker and the engine with it"
        );
        drop(acquire_engine(EngineUse::Bounded).expect("a finished run releases the engine"));

        // 2. The same shape of payload for a run the engineer stopped.
        let (mut slot, _) = start_real_session(rc_request());
        thread::sleep(Duration::from_millis(100));
        let response = slot
            .session
            .as_mut()
            .expect("still running")
            .request(&LiveRequestFrame::Halt, LIVE_FRAME_TIMEOUT)
            .expect("the child should answer a halt");
        let halted = finish_telemetry(&mut slot, response).expect("halt should succeed");
        let user_stop = serde_json::to_string(&halted).expect("telemetry serialises");
        println!("F4 user stop: {:?}", halted.stop_detail);
        drop(acquire_engine(EngineUse::Bounded).expect("a stopped run releases the engine"));

        assert_eq!(
            ended.telemetry.stop_reason,
            Some(LiveStopReason::AnalysisComplete)
        );
        assert_eq!(halted.stop_reason, Some(LiveStopReason::HaltedByUser));
        assert!(
            self_ended.contains("\"stopReason\":\"analysis-complete\""),
            "the payload the renderer receives does not spell the completion the way nativeLive.ts reads it: {self_ended}"
        );
        assert!(
            !self_ended.contains("halted-by-user"),
            "a run that ended by itself was reported as a user Stop: {self_ended}"
        );
        assert!(
            user_stop.contains("\"stopReason\":\"halted-by-user\""),
            "a user Stop does not reach the renderer as one: {user_stop}"
        );
        assert!(
            !user_stop.contains("analysis-complete"),
            "a user Stop was reported as a completed analysis: {user_stop}"
        );
        assert!(
            self_ended.contains("\"running\":false") && user_stop.contains("\"running\":false"),
            "a stopped run must not still claim to be running"
        );
        assert!(
            ended
                .telemetry
                .stop_detail
                .as_deref()
                .is_some_and(|detail| detail.contains("reached its own end time")),
            "{:?}",
            ended.telemetry.stop_detail
        );
        assert!(
            halted
                .stop_detail
                .as_deref()
                .is_some_and(|detail| detail.contains("Stopped by the engineer")),
            "{:?}",
            halted.stop_detail
        );
    }

    /** A sample the solver could not produce a number for stops the run and is
     * never handed to the plot.
     *
     * Two halves, and the second is the one that keeps a live trace honest: the
     * frame is truncated *at* the bad sample rather than dropped, so the
     * engineer sees the approach to the blow-up and nothing past it. A plot
     * that kept scrolling would be showing a circuit that stopped being solved.
     *
     * `LIVE_NON_FINITE_DECK` explains why the deck is a domain violation rather
     * than a runaway: on this engine build ngspice's timestep control kills a
     * runaway before any sample overflows. */
    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn live_f5_a_non_finite_sample_stops_the_run_instead_of_reaching_the_plot() {
        let _guard = real_engine_test_guard();
        let (mut run, _) = start(LiveStartRequest {
            netlist: LIVE_NON_FINITE_DECK.to_string(),
            stop_at_seconds: None,
            scalar_budget: None,
        });

        let mut delivered: Vec<f64> = Vec::new();
        let deadline = Instant::now() + Duration::from_secs(20);
        let telemetry = loop {
            let frame = poll(&mut run, &["time", "out"]);
            delivered.extend_from_slice(&frame.columns[1]);
            if frame.telemetry.stop_reason.is_some() {
                break frame.telemetry;
            }
            assert!(
                Instant::now() < deadline,
                "the deck never produced its non-finite sample"
            );
            thread::sleep(Duration::from_millis(10));
        };
        println!(
            "F5 delivered {} finite samples, last {:?}, then: {:?}",
            delivered.len(),
            delivered.last(),
            telemetry.stop_detail
        );

        assert_eq!(
            telemetry.stop_reason,
            Some(LiveStopReason::NonFinite),
            "a NaN in the solution was not reported as one: {:?}",
            telemetry.stop_detail
        );
        assert!(!telemetry.running, "the solver was left running past a NaN");
        assert!(
            delivered.iter().all(|value| value.is_finite()),
            "a non-finite sample was handed to the plot"
        );
        assert!(
            delivered.len() > 8,
            "only {} samples were delivered; the approach to the blow-up must still be shown",
            delivered.len()
        );
        let detail = telemetry.stop_detail.clone().unwrap_or_default();
        assert!(
            detail.contains("out") && detail.contains("NaN"),
            "the stop must name the trace and what it carried: {detail}"
        );

        // Tau did not invent the divergence: the engine's own plot still has a
        // non-finite value at the index the stop named.
        let keys: Vec<&CString> = run.vector_keys.iter().collect();
        let index = run
            .vectors
            .iter()
            .position(|name| name == "out")
            .expect("out is published");
        let whole = run.read_slice(&[keys[index]], 0, usize::MAX);
        let (bad_index, bad_value, _) = whole
            .diverged
            .expect("the engine's plot must still hold the sample that stopped the run");
        assert!(bad_value.is_nan(), "expected a NaN, found {bad_value}");
        assert!(
            detail.contains(&bad_index.to_string()),
            "the stop named a different sample from the one in the plot ({bad_index}): {detail}"
        );
        run.halt(LiveStopReason::HaltedByUser, "test".to_string());
    }
    /// Samples were clamped and columns were not, so a poll naming many vectors
    /// at the sample ceiling produced a frame bigger than the wire cap. The
    /// parent reads at most that many bytes, so the frame arrived truncated,
    /// failed to parse, and the live session was retired - a legitimate-looking
    /// request killing the run. The budget has to bound the PRODUCT.
    #[test]
    fn a_poll_frame_can_never_exceed_the_wire_budget() {
        // The worst case the old code allowed: the documented sample ceiling on
        // a wide poll.
        for columns in [1usize, 8, 64, 256, 4096] {
            let samples = clamp_slice_samples_for_columns(Some(LIVE_MAX_SLICE_SAMPLES), columns);
            assert!(samples >= 1, "{columns} columns left no samples at all");
            let values = columns.saturating_mul(samples);
            assert!(
                values <= LIVE_MAX_SLICE_VALUES,
                "{columns} columns x {samples} samples = {values} values, over the budget of {LIVE_MAX_SLICE_VALUES}"
            );
            // And the reason the budget is expressed in values: the JSON it
            // implies has to stay inside the frame the reader will accept.
            assert!(
                values * LIVE_SLICE_VALUE_JSON_BYTES < MAX_LIVE_FRAME_BYTES,
                "{columns} columns would still overflow the {MAX_LIVE_FRAME_BYTES} byte frame"
            );
        }
    }

    /// The clamp must not quietly shrink ordinary polls, which are narrow.
    #[test]
    fn ordinary_polls_keep_the_samples_they_asked_for() {
        assert_eq!(
            clamp_slice_samples_for_columns(None, 4),
            LIVE_DEFAULT_SLICE_SAMPLES
        );
        assert_eq!(clamp_slice_samples_for_columns(Some(2_048), 8), 2_048);
        // Still honours the absolute sample ceiling for a single column.
        assert_eq!(
            clamp_slice_samples_for_columns(Some(usize::MAX), 1),
            LIVE_MAX_SLICE_SAMPLES
        );
    }

}
