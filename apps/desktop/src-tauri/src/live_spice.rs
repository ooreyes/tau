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
    library_candidates, missing_codemodel_message, non_finite_kind, take_messages, SpiceEngine,
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
 * models into the same fixed `/tmp/tau-ngspice-codemodels` directory, and both
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
        character.is_ascii_alphanumeric() || matches!(character, '_' | '.' | '$' | '#' | '-' | '+')
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

// ─────────────────────────────────────────────────────────────────────────────
// The live run itself (child-side, and directly testable)
// ─────────────────────────────────────────────────────────────────────────────

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
        let max_samples = clamp_slice_samples(request.max_samples);
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
            // The solver reaching the deck's own `.tran` end time is the one
            // stop that is not an interruption, and it must not be reported as
            // though Tau imposed it.
            let reason = match self.stop_at_seconds {
                Some(time) => format!(
                    "The live run reached the requested stop time of {time} s and ngspice finished on that exact solved point."
                ),
                None => {
                    "The transient analysis in this deck reached its own end time.".to_string()
                }
            };
            let kind = if self.stop_at_seconds.is_some() {
                LiveStopReason::RequestedStopTime
            } else {
                LiveStopReason::AnalysisComplete
            };
            self.record_stop(kind, reason);
        }
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
        if self.stop.is_some() || !self.running() {
            return Err(
                "This live run is no longer solving, so there is nothing to alter.".to_string(),
            );
        }
        self.raw_command("bg_halt")?;
        if self.await_running(false, LIVE_BG_STATE_TIMEOUT).is_none() {
            return Err("ngspice did not stop the background solve, so Tau will not alter a circuit that is still being integrated.".to_string());
        }
        let altered = self.raw_command(&command);
        // Resume even when the alter was refused: leaving the engine halted
        // after a rejected knob turn would strand a run the user never stopped.
        let resumed = self.raw_command("bg_resume");
        altered?;
        resumed?;
        if self.await_running(true, LIVE_BG_STATE_TIMEOUT).is_none() {
            self.record_stop(
                LiveStopReason::EngineError,
                format!("ngspice accepted `{command}` but did not resume solving afterwards."),
            );
            return Err("ngspice did not resume the live run after the change.".to_string());
        }
        Ok(self.telemetry())
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
    stdin: ChildStdin,
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
        let mut child = Command::new(executable)
            .arg(LIVE_WORKER_ARG)
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
            stdin,
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
        self.stdin
            .write_all(&encoded)
            .and_then(|()| self.stdin.write_all(b"\n"))
            .and_then(|()| self.stdin.flush())
            .map_err(|error| {
                format!(
                    "Tau's live ngspice worker stopped accepting commands: {error}.{}",
                    self.diagnostics()
                )
            })?;

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
                                format!("Tau's live ngspice worker returned invalid data: {error}")
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

impl Drop for LiveSession {
    /** The only owner of the child process.
     *
     * Graceful first, because a clean exit lets `LiveRun`'s drop halt the
     * background solver before `dlclose`; SIGKILL after the grace period,
     * because a wedged child must not outlive the session that started it. */
    fn drop(&mut self) {
        let shutdown = serde_json::to_vec(&LiveRequestFrame::Shutdown).unwrap_or_default();
        let _ = self.stdin.write_all(&shutdown);
        let _ = self.stdin.write_all(b"\n");
        let _ = self.stdin.flush();

        let deadline = Instant::now() + LIVE_SHUTDOWN_GRACE;
        let mut exited = false;
        while Instant::now() < deadline {
            match self.child.try_wait() {
                Ok(Some(_)) => {
                    exited = true;
                    break;
                }
                Ok(None) => thread::sleep(Duration::from_millis(10)),
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

/// Kill the child and release the lease as soon as it stops solving.
fn retire_if_stopped(slot: &mut LiveSlot, telemetry: &LiveTelemetry) {
    if !telemetry.running {
        slot.last = Some(telemetry.clone());
        slot.session = None;
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
        let session = held
            .session
            .as_mut()
            .ok_or_else(|| "No live simulation is running.".to_string())?;
        let response =
            match session.request(&LiveRequestFrame::Poll { request }, LIVE_FRAME_TIMEOUT) {
                Ok(response) => response,
                Err(error) => {
                    // A worker that stopped answering is a worker that must not
                    // keep the lease. Drop it here rather than waiting for a Stop
                    // the user has no reason to press.
                    held.session = None;
                    return Err(error);
                }
            };
        match (response.error, response.slice) {
            (None, Some(slice)) => {
                retire_if_stopped(&mut held, &slice.telemetry);
                Ok(slice)
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
                held.session = None;
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
                held.session = None;
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
        (Some(error), _) => Err(error),
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

    // ── real-engine proofs ─────────────────────────────────────────────────
    //
    // These drive `LiveRun` directly rather than through the child process, for
    // the same reason the 1E spike did: `cargo test`'s own binary cannot be
    // re-executed with `--tau-spice-live-worker` (libtest rejects the argument),
    // and the engine behaviour is what needs proving. The IPC layer above is
    // covered by the framing and loop tests, which need no engine.
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
}
