use std::{
    ffi::{c_char, c_int, c_void, CStr, CString},
    io::{Read, Write},
    path::PathBuf,
    process::{Command, Stdio},
    ptr, slice,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

#[cfg(debug_assertions)]
use std::env;

use libloading::Library;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

/** Points per trace Tau will hold in one result. A run that produces more is
 * resampled down to this, not thrown away: the solver's accuracy is a separate
 * question from how much of its output the display can carry, and a 60 s
 * transient is an ordinary thing for an engineer to ask for. */
const MAX_VECTOR_LENGTH: usize = 2_000_000;
const MAX_TRANSFER_VALUES: usize = 8_000_000;
/** Names read from one `AllVecs` list before Tau stops walking it. */
const MAX_VECTOR_NAMES: usize = 10_000;
/** Below this a resample is not worth mentioning - ngspice adds a handful of
 * breakpoints past the requested output step on almost every run, and a notice
 * about losing 14 samples out of two million is noise, not information. */
const RESAMPLE_NOTICE_RATIO: f64 = 0.995;
/** Secondary plots share a budget well under the primary one: a `.noise` run
 * needs two small plots, while a `.step` deck can leave dozens behind.
 * Keep this ≥ `MAX_FAMILY_MEMBERS - 1` in the TypeScript step family so a
 * native single-deck `.step` is not silently truncated mid-family. */
const MAX_EXTRA_PLOTS: usize = 255;
const MAX_EXTRA_PLOT_VALUES: usize = 1_000_000;
const MAX_PLOT_NAMES: usize = 1_000;
/** ngspice's always-present plot of named constants, never a run result. */
const CONSTANTS_PLOT: &str = "const";
const MAX_NETLIST_BYTES: usize = 512 * 1024;
const MAX_DECK_LINES: usize = 30_000;
const MAX_ENGINE_MESSAGES: usize = 256;
const MAX_ENGINE_MESSAGE_BYTES: usize = 2 * 1024;
/** How many of the newest engine log lines a failed run carries back across
 * the worker boundary.
 *
 * The live buffer is already bounded twice over - `MAX_ENGINE_MESSAGES` lines
 * of `MAX_ENGINE_MESSAGE_BYTES` each - but that product is half a megabyte,
 * and half a megabyte of solver chatter pasted into a single error string is
 * not a diagnostic, it is a wall the reader will not climb. The tail is the
 * part worth carrying for the same reason `record_engine_message` keeps the
 * newest lines: ngspice states the cause of a failure at the end, after
 * whatever noise preceded it. */
const MAX_ERROR_LOG_MESSAGES: usize = 24;
const MAX_WORKER_INPUT_BYTES: usize = MAX_NETLIST_BYTES + 64 * 1024;
const MAX_WORKER_OUTPUT_BYTES: usize = 256 * 1024 * 1024;
const MAX_WORKER_STDERR_BYTES: usize = 64 * 1024;
/** The worker streams a result through this fixed-size buffer instead of first
 * materializing its complete JSON response. It bounds serialization overhead
 * while still avoiding a syscall for every scalar in a large waveform. */
const WORKER_RESPONSE_BUFFER_BYTES: usize = 64 * 1024;
const WORKER_TIMEOUT: Duration = Duration::from_secs(120);
/** What the wait between worker checks settles at once a run has proven itself
 * long. By then the wall clock belongs to ngspice, so looking more often buys
 * no latency a person could perceive and only costs wakeups. */
const WORKER_POLL_INTERVAL: Duration = Duration::from_millis(20);
/** How Tau ramps up to that settled interval, as (poll this fast until the run
 * has been going this long, interval to use while under it).
 *
 * One flat interval cannot serve both ends of the range this loop sees. An
 * operating point, or a small `.tran`, is finished inside single-digit
 * milliseconds; a flat 20 ms poll then adds ~10 ms of pure waiting to it on
 * average, and a `.step` family pays that again for every member, so a
 * 40-point sweep spends most of half a second noticing nothing. A 60 s
 * transient at the other end cannot tell a 250 µs poll from a 20 ms one except
 * in wasted wakeups.
 *
 * So the ramp spends wakeups only where they buy latency, then stops: 20
 * checks over the first 5 ms, 15 more to 20 ms, 16 more to 100 ms — 51 before
 * it settles, against the 5 a flat 20 ms poll would have spent over the same
 * 100 ms. A long run therefore pays 46 extra wakeups once and polls exactly as
 * it did before for the remaining minutes, while a 1 ms run is noticed within
 * 250 µs instead of within 20 ms. Holding that fastest phase for the whole
 * 120 s ceiling would have cost ~480,000 wakeups to buy the same 20 ms.
 *
 * These intervals are floors, not promises: `thread::sleep` overshoots by
 * whatever the OS scheduler's granularity is. That is why the first phase is
 * 250 µs and not 10 µs — under the scheduler's resolution the extra wakeups
 * are charged and the latency is not won back. */
const WORKER_POLL_RAMP: [(Duration, Duration); 3] = [
    (Duration::from_millis(5), Duration::from_micros(250)),
    (Duration::from_millis(20), Duration::from_millis(1)),
    (Duration::from_millis(100), Duration::from_millis(5)),
];
const WORKER_ARG: &str = "--tau-spice-worker";
const WORKER_RESPONSE_MARKER: &[u8; 22] = b"TAU_SPICE_RESPONSE_V1:";

/** Build the fallback table for the fixed worker marker at compile time. */
const fn marker_failure_table<const N: usize>(marker: &[u8; N]) -> [usize; N] {
    let mut table = [0_usize; N];
    let mut index = 1_usize;
    let mut prefix = 0_usize;
    while index < N {
        if marker[index] == marker[prefix] {
            prefix += 1;
            table[index] = prefix;
            index += 1;
        } else if prefix > 0 {
            prefix = table[prefix - 1];
        } else {
            index += 1;
        }
    }
    table
}

const WORKER_RESPONSE_MARKER_FAILURE: [usize; WORKER_RESPONSE_MARKER.len()] =
    marker_failure_table(WORKER_RESPONSE_MARKER);

type SendChar = unsafe extern "C" fn(*mut c_char, c_int, *mut c_void) -> c_int;
type SendStat = unsafe extern "C" fn(*mut c_char, c_int, *mut c_void) -> c_int;
type ControlledExit = unsafe extern "C" fn(c_int, bool, bool, c_int, *mut c_void) -> c_int;
type SendData = unsafe extern "C" fn(*mut c_void, c_int, c_int, *mut c_void) -> c_int;
type SendInitData = unsafe extern "C" fn(*mut c_void, c_int, *mut c_void) -> c_int;
type BgThreadRunning = unsafe extern "C" fn(bool, c_int, *mut c_void) -> c_int;

type NgSpiceInit = unsafe extern "C" fn(
    Option<SendChar>,
    Option<SendStat>,
    Option<ControlledExit>,
    Option<SendData>,
    Option<SendInitData>,
    Option<BgThreadRunning>,
    *mut c_void,
) -> c_int;
type NgSpiceCommand = unsafe extern "C" fn(*mut c_char) -> c_int;
type NgSpiceCirc = unsafe extern "C" fn(*mut *mut c_char) -> c_int;
type NgSpiceCurPlot = unsafe extern "C" fn() -> *mut c_char;
type NgSpiceAllPlots = unsafe extern "C" fn() -> *mut *mut c_char;
type NgSpiceAllVecs = unsafe extern "C" fn(*mut c_char) -> *mut *mut c_char;
type NgGetVecInfo = unsafe extern "C" fn(*mut c_char) -> *mut VectorInfo;
/** The four entry points a *free-running* analysis needs and a completed-run
 * reader does not (`live_spice`).
 *
 * They are resolved here, in the one `SpiceEngine::from_library`, rather than
 * from a second `Library::new` in the live module. Two handles onto the same
 * `.dylib` would be two `ngSpice_Init` calls against one set of process-global
 * engine statics, and libngspice latches state across init (`nodatawanted` is
 * the documented example) - so the live path has to be the same engine Tau
 * already loaded, not a sibling copy of it. Resolving them unconditionally
 * also makes "this build cannot be driven live" a load-time refusal on both
 * paths instead of a surprise the first time somebody presses Run. */
type NgSpiceRunning = unsafe extern "C" fn() -> bool;
type NgSpiceLockRealloc = unsafe extern "C" fn() -> c_int;
type NgSpiceUnlockRealloc = unsafe extern "C" fn() -> c_int;
type NgSpiceSetBkpt = unsafe extern "C" fn(f64) -> bool;

#[repr(C)]
#[derive(Clone, Copy)]
struct NgComplex {
    real: f64,
    imag: f64,
}

#[repr(C)]
pub(crate) struct VectorInfo {
    name: *mut c_char,
    vector_type: c_int,
    flags: i16,
    pub(crate) real_data: *mut f64,
    complex_data: *mut NgComplex,
    pub(crate) length: c_int,
}

#[derive(Default)]
pub(crate) struct CallbackState {
    messages: Mutex<Vec<String>>,
    dropped_messages: Mutex<usize>,
    exit_message: Mutex<Option<String>>,
}

fn record_engine_message(state: &CallbackState, bytes: &[u8]) {
    let bounded = &bytes[..bytes.len().min(MAX_ENGINE_MESSAGE_BYTES)];
    let message = String::from_utf8_lossy(bounded).trim().to_string();
    if message.is_empty() {
        return;
    }
    if let Ok(mut messages) = state.messages.lock() {
        // Keep the newest diagnostics. Parser failures and fatal XSPICE errors
        // arrive at the end of a noisy run, so retaining only the first N would
        // turn an error flood into a possible stale-plot false success.
        if messages.len() >= MAX_ENGINE_MESSAGES {
            let remove = MAX_ENGINE_MESSAGES / 2;
            messages.drain(..remove);
            if let Ok(mut dropped) = state.dropped_messages.lock() {
                *dropped = dropped.saturating_add(remove);
            }
        }
        messages.push(message);
    }
}

unsafe extern "C" fn on_char(text: *mut c_char, _ident: c_int, user_data: *mut c_void) -> c_int {
    if text.is_null() || user_data.is_null() {
        return 0;
    }
    let state = unsafe { &*(user_data as *const CallbackState) };
    record_engine_message(state, unsafe { CStr::from_ptr(text) }.to_bytes());
    0
}

unsafe extern "C" fn on_stat(_text: *mut c_char, _ident: c_int, _user_data: *mut c_void) -> c_int {
    0
}

unsafe extern "C" fn on_exit(
    status: c_int,
    immediate: bool,
    quit: bool,
    _ident: c_int,
    user_data: *mut c_void,
) -> c_int {
    if user_data.is_null() {
        return 0;
    }
    let state = unsafe { &*(user_data as *const CallbackState) };
    if let Ok(mut exit_message) = state.exit_message.lock() {
        *exit_message = Some(format!(
            "ngspice exited with status {status} ({}){}",
            if quit { "quit" } else { "error" },
            if immediate { ", immediate" } else { "" }
        ));
    }
    0
}

unsafe extern "C" fn on_bg_thread(_running: bool, _ident: c_int, _user_data: *mut c_void) -> c_int {
    0
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpiceRequest {
    /// A complete, newline-separated SPICE deck with an analysis card and `.end`.
    pub netlist: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpiceVector {
    pub name: String,
    pub real: Vec<f64>,
    pub imaginary: Option<Vec<f64>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpicePlot {
    pub name: String,
    pub vectors: Vec<SpiceVector>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpiceResult {
    pub plot: String,
    pub vectors: Vec<SpiceVector>,
    /** Plots this run created besides the current one, which stays in `plot`
     * and `vectors`. Most analyses make a single plot, but `.noise` splits its
     * answer across two - the spectral density curves and the integrated
     * totals - and only the totals are current. Held separately so the primary
     * result is never transferred twice. */
    pub extra_plots: Vec<SpicePlot>,
    pub messages: Vec<String>,
    pub library_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkerRequest {
    request: SpiceRequest,
    library_candidates: Vec<PathBuf>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkerResponse {
    result: Option<SpiceResult>,
    error: Option<String>,
    /** The tail of the engine log for a run that failed after ngspice had
     * already explained itself.
     *
     * `SpiceResult.messages` is otherwise the only carrier for those lines,
     * and a failure has no `SpiceResult`, so every diagnostic the engine
     * produced used to stop at the process boundary and the parent could
     * report nothing but Tau's own summary. Defaulted rather than required so
     * that a response missing the field still decodes - a strict field here
     * would reintroduce exactly the all-or-nothing decode failure this whole
     * path exists to prevent. */
    #[serde(default)]
    engine_log: Vec<String>,
}

pub struct NativeSpiceState {
    active_cancellation: Arc<Mutex<Option<Arc<AtomicBool>>>>,
}

impl Default for NativeSpiceState {
    fn default() -> Self {
        Self {
            active_cancellation: Arc::new(Mutex::new(None)),
        }
    }
}

pub(crate) struct SpiceApi {
    init: NgSpiceInit,
    pub(crate) command: NgSpiceCommand,
    circ: NgSpiceCirc,
    pub(crate) cur_plot: NgSpiceCurPlot,
    all_plots: NgSpiceAllPlots,
    pub(crate) all_vecs: NgSpiceAllVecs,
    pub(crate) get_vec_info: NgGetVecInfo,
    pub(crate) running: NgSpiceRunning,
    pub(crate) lock_realloc: NgSpiceLockRealloc,
    pub(crate) unlock_realloc: NgSpiceUnlockRealloc,
    pub(crate) set_bkpt: NgSpiceSetBkpt,
}

/** Remove leftover per-run `tau-ngspice-XXXXXX` staging dirs that earlier Tau
 * builds leaked when a worker died by signal (Drop never ran). Only dirs with
 * the randomized-suffix prefix are touched, never the stable staging dir, and
 * only after they have been idle well past a worker's maximum lifetime. */
fn sweep_stale_codemodel_dirs(stable_dir: &std::path::Path) {
    let Some(parent) = stable_dir.parent() else {
        return;
    };
    let Ok(entries) = std::fs::read_dir(parent) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path == stable_dir {
            continue;
        }
        let is_legacy = entry.file_name().to_str().is_some_and(|name| {
            name.starts_with("tau-ngspice-") && name != "tau-ngspice-codemodels"
        });
        if !is_legacy || !path.is_dir() {
            continue;
        }
        let idle_long_enough = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|modified| modified.elapsed().ok())
            .is_some_and(|elapsed| elapsed.as_secs() > 600);
        if idle_long_enough {
            let _ = std::fs::remove_dir_all(&path);
        }
    }
}

pub(crate) struct SpiceEngine {
    _library: Library,
    pub(crate) api: SpiceApi,
    pub(crate) callback_state: Box<CallbackState>,
    pub(crate) library_path: PathBuf,
    /** How many XSPICE code-model modules this engine actually loaded. Zero
     * means every A device in a deck is an unknown model type, which is a
     * property of the engine build rather than of the circuit. */
    pub(crate) codemodels_loaded: usize,
}

impl SpiceEngine {
    pub(crate) fn load(candidates: Vec<PathBuf>) -> Result<Self, String> {
        let mut failures = Vec::new();
        for candidate in &candidates {
            if !candidate.is_file() {
                failures.push(format!("{}: file not found", candidate.display()));
                continue;
            }
            match unsafe { Library::new(candidate) } {
                Ok(library) => match unsafe { Self::from_library(library, candidate.clone()) } {
                    Ok(engine) => return Ok(engine),
                    Err(error) => failures.push(format!("{}: {error}", candidate.display())),
                },
                Err(error) => failures.push(format!("{}: {error}", candidate.display())),
            }
        }
        Err(format!(
            "Tau's bundled libngspice could not be loaded. Run scripts/build-ngspice.sh before a development build, or set TAU_NGSPICE_LIB for an explicit development override. Checked: {}{}",
            candidates
                .iter()
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join(", "),
            if failures.is_empty() { String::new() } else { format!(". Loader errors: {}", failures.join("; ")) }
        ))
    }

    unsafe fn from_library(library: Library, library_path: PathBuf) -> Result<Self, String> {
        unsafe fn symbol<T: Copy>(library: &Library, name: &[u8]) -> Result<T, String> {
            let symbol = unsafe { library.get::<T>(name) }
                .map_err(|error| format!("missing {}: {error}", String::from_utf8_lossy(name)))?;
            Ok(*symbol)
        }

        let api = SpiceApi {
            init: unsafe { symbol(&library, b"ngSpice_Init\0")? },
            command: unsafe { symbol(&library, b"ngSpice_Command\0")? },
            circ: unsafe { symbol(&library, b"ngSpice_Circ\0")? },
            cur_plot: unsafe { symbol(&library, b"ngSpice_CurPlot\0")? },
            all_plots: unsafe { symbol(&library, b"ngSpice_AllPlots\0")? },
            all_vecs: unsafe { symbol(&library, b"ngSpice_AllVecs\0")? },
            get_vec_info: unsafe { symbol(&library, b"ngGet_Vec_Info\0")? },
            running: unsafe { symbol(&library, b"ngSpice_running\0")? },
            lock_realloc: unsafe { symbol(&library, b"ngSpice_LockRealloc\0")? },
            unlock_realloc: unsafe { symbol(&library, b"ngSpice_UnlockRealloc\0")? },
            set_bkpt: unsafe { symbol(&library, b"ngSpice_SetBkpt\0")? },
        };
        let mut callback_state = Box::<CallbackState>::default();
        let user_data = callback_state.as_mut() as *mut CallbackState as *mut c_void;
        let status = unsafe {
            (api.init)(
                Some(on_char),
                Some(on_stat),
                Some(on_exit),
                // Tau reads completed plots through ngSpice_AllVecs and
                // ngGet_Vec_Info below; it never consumes streaming samples.
                // Leaving these callbacks absent also keeps libngspice out of
                // its streaming bookkeeping path, which can dereference a
                // null vector when valid mixed device-property saves are used.
                None,
                None,
                Some(on_bg_thread),
                user_data,
            )
        };
        if status != 0 {
            return Err(format!("ngSpice_Init failed with status {status}"));
        }
        let mut engine = Self {
            _library: library,
            api,
            callback_state,
            library_path,
            codemodels_loaded: 0,
        };
        engine.load_bundled_codemodels()?;
        Ok(engine)
    }

    /** libngspice does not source the CLI's `spinit` when embedded. XSPICE
     * devices (adc_bridge/d_dff/dac_bridge, tables, transmission lines) are
     * dynamic `.cm` modules, so load Tau's sibling bundle explicitly before
     * any circuit is parsed. Without this, ordinary analog circuits work but
     * every digital A-device fails as an unknown model type. */
    fn load_bundled_codemodels(&mut self) -> Result<(), String> {
        let Some(lib_dir) = self.library_path.parent() else {
            return Ok(());
        };
        let codemodel_dir = lib_dir.join("ngspice");
        let names = crate::staged_engine::REQUIRED_CODEMODELS;

        // `codemodel` does not unquote double-quoted filenames and its command
        // lexer still splits backslash-escaped spaces. DMGs commonly mount as
        // `/Volumes/Tau 1`, so loading directly from the app resource path can
        // silently leave every XSPICE device unknown. Stage the small, sealed
        // modules in a STABLE no-whitespace staging directory shared by every
        // run. A per-run TempDir relied on Drop for cleanup, and the worker
        // process is killed with SIGKILL on Stop/timeout/crash, so each such
        // exit leaked a ~692 KiB directory into /tmp. A fixed path is written
        // atomically (temp file + rename), reused when the bytes already
        // match, and never needs Drop. The embedded code signatures travel
        // with the copied bytes.
        // Per-user, NOT `/tmp`. This used to be the literal
        // `/tmp/tau-ngspice-codemodels`, and `/private/tmp` is mode 1777: the
        // first account to create that directory owns it, and its contents are
        // `dlopen`'d into this process by the `codemodel` command below. On a
        // shared Mac that is a native-code load from a path another local user
        // could have created. macOS's per-user `$TMPDIR` (`/var/folders/<hash>/T`)
        // is mode 700, keeps the no-whitespace property the block comment above
        // requires, and is just as stable across runs - so nothing about the
        // reuse-by-content-hash or the leak-free fixed path changes.
        let staged_dir = std::env::temp_dir().join("tau-ngspice-codemodels");
        if staged_dir
            .to_string_lossy()
            .chars()
            .any(char::is_whitespace)
        {
            return Err(
                "Tau's temporary code-model path contains whitespace; XSPICE cannot load safely."
                    .to_string(),
            );
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
            if !staged_dir.exists() {
                std::fs::DirBuilder::new()
                    .recursive(true)
                    .mode(0o700)
                    .create(&staged_dir)
                    .map_err(|error| {
                        format!("Could not stage bundled ngspice code models: {error}")
                    })?;
            }
            // Refuse a staging directory any other account can write, whoever
            // created it. These bytes get loaded as native code, so "probably
            // ours" is not good enough, and a refusal here is recoverable by
            // deleting the directory while a silent load is not.
            let mode = std::fs::metadata(&staged_dir)
                .map_err(|error| format!("Could not inspect the code-model staging path: {error}"))?
                .permissions()
                .mode();
            if mode & 0o022 != 0 {
                return Err(format!(
                    "{} is writable by other accounts, so Tau will not load code models from it. Delete it and reopen Tau.",
                    staged_dir.display()
                ));
            }
        }
        #[cfg(not(unix))]
        std::fs::create_dir_all(&staged_dir)
            .map_err(|error| format!("Could not stage bundled ngspice code models: {error}"))?;
        sweep_stale_codemodel_dirs(&staged_dir);
        let pid = std::process::id();
        let mut staged = Vec::new();
        for name in names {
            let source = codemodel_dir.join(name);
            if !source.is_file() {
                continue;
            }
            let destination = staged_dir.join(name);
            staged.push(destination.clone());
            let bytes = std::fs::read(&source).map_err(|error| {
                format!(
                    "Could not stage bundled ngspice code model {}: {error}",
                    source.display()
                )
            })?;
            // Concurrent workers share the staging dir; identical bytes mean
            // the copy can be skipped, and the rename keeps a reader in
            // another process from ever observing a torn file.
            if std::fs::read(&destination).is_ok_and(|existing| existing == bytes) {
                continue;
            }
            let scratch = staged_dir.join(format!(".{name}.tmp-{pid}"));
            std::fs::write(&scratch, &bytes)
                .and_then(|()| std::fs::rename(&scratch, &destination))
                .map_err(|error| {
                    let _ = std::fs::remove_file(&scratch);
                    format!(
                        "Could not stage bundled ngspice code model {}: {error}",
                        source.display()
                    )
                })?;
        }

        // Only the modules that were staged from beside THIS library are
        // loaded. The staging directory is a fixed path shared by every Tau
        // process on the machine, so a library built elsewhere can have left
        // its own modules there; loading a foreign build's `.cm` into this
        // library is an ABI mismatch, and it would also make an engine with no
        // code models of its own look like a healthy one.
        for path in &staged {
            let command = CString::new(format!("codemodel {}", path.display())).map_err(|_| {
                "A bundled ngspice code-model path contains a NUL byte.".to_string()
            })?;
            let status = unsafe { (self.api.command)(command.as_ptr() as *mut c_char) };
            if status != 0 {
                return Err(with_engine_messages(
                    &self.callback_state,
                    format!(
                        "ngspice could not load bundled code model {}",
                        path.display()
                    ),
                ));
            }
            if let Some(error) = fatal_engine_messages(&self.callback_state) {
                return Err(format!("Loading {} failed: {error}", path.display()));
            }
        }
        self.codemodels_loaded = staged.len();
        clear_callback_state(&self.callback_state);
        Ok(())
    }

    fn run(&mut self, request: SpiceRequest) -> Result<SpiceResult, String> {
        let lines = deck_lines(&request.netlist)?;
        if let Some(message) = missing_codemodel_message(&lines, self.codemodels_loaded) {
            return Err(message);
        }
        clear_callback_state(&self.callback_state);
        // ngspice appends this run's plots to the ones earlier circuits in the
        // same process left behind, so the only way to tell them apart is to
        // know what was there first.
        let plots_before = self.plot_names();

        // Stock ngspice rejects `.step` as unimplemented. Expand emitted cards
        // into one circ/run per member so the native-step UI path stays honest.
        let (base_lines, axes) = crate::step_expand::split_step_directives(&lines)?;
        let members = crate::step_expand::step_members(&axes)?;
        if members.is_empty() {
            self.circ_lines(&lines)?;
            self.run_command()?;
        } else {
            for (index, member) in members.iter().enumerate() {
                if index > 0 {
                    // Drop the previous circuit; plots are retained for transfer.
                    self.run_named_command("remcirc")?;
                    clear_callback_state(&self.callback_state);
                }
                let member_lines = crate::step_expand::apply_member_to_deck(&base_lines, member);
                self.circ_lines(&member_lines)?;
                for alter in crate::step_expand::source_alter_commands(member) {
                    self.run_named_command(&alter)?;
                }
                self.run_command()?;
            }
        }

        let plot = unsafe { c_string((self.api.cur_plot)()) }.ok_or_else(|| {
            with_engine_messages(
                &self.callback_state,
                "ngspice did not produce a plot.".to_string(),
            )
        })?;
        let mut transferred = 0_usize;
        let mut notices: Vec<String> = Vec::new();
        let vectors =
            self.read_vectors(&plot, &mut transferred, MAX_TRANSFER_VALUES, &mut notices)?;

        // Secondary plots are extra detail on top of an answer the caller
        // already has, so they get their own smaller budget and a run that
        // cannot afford them says so instead of failing outright.
        let mut extra_plots = Vec::new();
        let mut extra_transferred = 0_usize;
        let mut omitted = Vec::new();
        // Creation order from AllPlots is newest-first; reverse so extras are
        // oldest→newest to match TypeScript `orderNativeStepPlots`.
        let mut secondary: Vec<String> = self
            .plot_names()
            .into_iter()
            .filter(|name| name != &plot && name != CONSTANTS_PLOT && !plots_before.contains(name))
            .collect();
        secondary.reverse();
        for name in secondary {
            if extra_plots.len() >= MAX_EXTRA_PLOTS {
                omitted.push(name);
                continue;
            }
            match self.read_vectors(
                &name,
                &mut extra_transferred,
                MAX_EXTRA_PLOT_VALUES,
                &mut notices,
            ) {
                Ok(vectors) if !vectors.is_empty() => extra_plots.push(SpicePlot { name, vectors }),
                Ok(_) => {}
                Err(_) => omitted.push(name),
            }
        }

        let mut messages = take_messages(&self.callback_state);
        for notice in notices {
            // Secondary plots repeat the primary plot's notice verbatim when
            // they were reduced by the same amount; say it once.
            if !messages.contains(&notice) {
                messages.push(notice);
            }
        }
        if !omitted.is_empty() {
            // Prefixed the way ngspice prefixes its own diagnostics, because
            // that is what the frontend screens messages on before showing
            // them. Without it this notice would be dropped in silence.
            messages.push(format!(
                "Warning: Tau left out this run's secondary result plots {} to stay inside its transfer budget.",
                omitted.join(", ")
            ));
        }
        Ok(SpiceResult {
            plot,
            vectors,
            extra_plots,
            messages,
            library_path: self.library_path.display().to_string(),
        })
    }

    pub(crate) fn circ_lines(&mut self, lines: &[String]) -> Result<(), String> {
        let c_lines = lines
            .iter()
            .map(|line| {
                CString::new(line.as_str()).map_err(|_| "Netlist contains a NUL byte.".to_string())
            })
            .collect::<Result<Vec<_>, _>>()?;
        let mut pointers = c_lines
            .iter()
            .map(|line| line.as_ptr() as *mut c_char)
            .collect::<Vec<_>>();
        pointers.push(ptr::null_mut());
        let circ_status = unsafe { (self.api.circ)(pointers.as_mut_ptr()) };
        if circ_status != 0 {
            return Err(with_engine_messages(
                &self.callback_state,
                format!("ngSpice_Circ failed with status {circ_status}"),
            ));
        }
        if let Some(error) = fatal_engine_messages(&self.callback_state) {
            return Err(error);
        }
        Ok(())
    }

    fn run_command(&mut self) -> Result<(), String> {
        self.run_named_command("run")
    }

    fn run_named_command(&mut self, command: &str) -> Result<(), String> {
        reject_interpreter_metacharacters(command)?;
        let command = CString::new(command)
            .map_err(|_| "ngspice command contains a NUL byte.".to_string())?;
        let command_status = unsafe { (self.api.command)(command.as_ptr() as *mut c_char) };
        if command_status != 0 {
            return Err(with_engine_messages(
                &self.callback_state,
                format!("ngSpice_Command failed with status {command_status}"),
            ));
        }
        if let Some(error) = fatal_engine_messages(&self.callback_state) {
            return Err(error);
        }
        if let Some(exit) = self
            .callback_state
            .exit_message
            .lock()
            .ok()
            .and_then(|message| message.clone())
        {
            return Err(with_engine_messages(&self.callback_state, exit));
        }
        Ok(())
    }

    /** Names of every plot ngspice currently holds, newest first (engine order). */
    fn plot_names(&self) -> Vec<String> {
        let names = unsafe { (self.api.all_plots)() };
        if names.is_null() {
            return Vec::new();
        }
        let mut result = Vec::new();
        for index in 0..MAX_PLOT_NAMES {
            let entry = unsafe { *names.add(index) };
            if entry.is_null() {
                break;
            }
            if let Some(name) = unsafe { c_string(entry) } {
                result.push(name);
            }
        }
        result
    }

    /** Every vector name ngspice currently holds for `plot`, in engine order. */
    fn vector_names(&self, plot: &str) -> Result<Vec<String>, String> {
        let plot_name =
            CString::new(plot).map_err(|_| "ngspice returned an invalid plot name.".to_string())?;
        let names = unsafe { (self.api.all_vecs)(plot_name.as_ptr() as *mut c_char) };
        if names.is_null() {
            return Err(format!("ngspice returned no vectors for plot {plot}."));
        }
        let mut result = Vec::new();
        for index in 0..MAX_VECTOR_NAMES {
            let entry = unsafe { *names.add(index) };
            if entry.is_null() {
                break;
            }
            result.push(unsafe { c_string(entry) }.unwrap_or_default());
        }
        Ok(result)
    }

    /**
     * ngspice's own record for one vector. The qualified `plot.name` form is
     * tried first so a stale same-named vector from an earlier circuit in this
     * process cannot answer for the current one.
     *
     * SAFETY: the returned reference borrows storage ngspice owns, which stays
     * valid until the next command runs against the engine. Callers must not
     * hold it across `run_command`/`circ_lines`.
     */
    fn vector_info(&self, plot: &str, name: &str) -> Result<Option<&VectorInfo>, String> {
        let nul = || "ngspice vector name contains a NUL byte.".to_string();
        let qualified = CString::new(format!("{plot}.{name}")).map_err(|_| nul())?;
        let mut info = unsafe { (self.api.get_vec_info)(qualified.as_ptr() as *mut c_char) };
        if info.is_null() {
            let plain = CString::new(name).map_err(|_| nul())?;
            info = unsafe { (self.api.get_vec_info)(plain.as_ptr() as *mut c_char) };
        }
        if info.is_null() {
            return Ok(None);
        }
        Ok(Some(unsafe { &*info }))
    }

    /**
     * Read one plot, reducing it to what Tau can carry rather than refusing it.
     *
     * The reduction is decided for the plot as a whole. Traces in a transient
     * plot share a single `time` vector, and the frontend drops any trace whose
     * length disagrees with it, so a per-vector decision would silently delete
     * currents from a long run instead of shortening them.
     *
     * `notices` collects an engine-style warning when anything was dropped. A
     * quietly subsampled waveform would be worse than the error this replaces.
     */
    fn read_vectors(
        &self,
        plot: &str,
        transfer_values: &mut usize,
        transfer_limit: usize,
        notices: &mut Vec<String>,
    ) -> Result<Vec<SpiceVector>, String> {
        let names = self.vector_names(plot)?;

        // Measure before reading: the whole plot has to agree on one ratio.
        let mut widest = 0_usize;
        let mut scalars = 0_usize;
        let mut counted = 0_usize;
        for name in &names {
            let Some(info) = self.vector_info(plot, name)? else {
                continue;
            };
            let length = vector_length(info, name)?;
            counted += 1;
            widest = widest.max(length);
            scalars = scalars.saturating_add(length.saturating_mul(value_width(info)));
        }
        let budget = transfer_limit.saturating_sub(*transfer_values);
        let keep = transfer_keep_ratio(widest, scalars, counted, budget)?;

        let mut result = Vec::new();
        let mut reduced_from = 0_usize;
        let mut reduced_to = 0_usize;
        for name in names {
            let Some(info) = self.vector_info(plot, &name)? else {
                continue;
            };
            let length = vector_length(info, &name)?;
            let target = resampled_length(length, keep);
            let (real, imaginary) = if !info.real_data.is_null() {
                let values = unsafe { slice::from_raw_parts(info.real_data, length) };
                (resample(values, target), None)
            } else if !info.complex_data.is_null() {
                let values = unsafe { slice::from_raw_parts(info.complex_data, length) };
                let (real, imaginary) = resample_complex(values, target);
                (real, Some(imaginary))
            } else {
                (Vec::new(), None)
            };
            if !real.is_empty() && target < length {
                reduced_from = reduced_from.max(length);
                reduced_to = reduced_to.max(real.len());
            }
            *transfer_values = transfer_values
                .checked_add(real.len() * if imaginary.is_some() { 2 } else { 1 })
                .ok_or_else(|| "ngspice result overflowed Tau's transfer budget.".to_string())?;
            if *transfer_values > transfer_limit {
                // The ratio above sized the plot to fit, so reaching this means
                // the measure pass and the read pass disagreed - keep the guard
                // rather than let a mismatch grow the transfer unbounded.
                return Err(format!(
                    "ngspice result has more than Tau's {transfer_limit} scalar-value transfer limit. Reduce stop time, output resolution, or circuit size."
                ));
            }
            result.push(SpiceVector {
                name,
                real,
                imaginary,
            });
        }
        if worth_reporting(reduced_from, reduced_to) {
            notices.push(format!(
                "Warning: this run produced {reduced_from} points per trace, more than Tau transfers at once. \
                 Tau kept {reduced_to} of them, evenly spaced across the full window; every plotted value is a real \
                 solver sample, but detail between them is not shown. Shorten the circuit duration or lower the \
                 output points to see the run at full rate."
            ));
        }
        Ok(result)
    }
}

/** Scalars one sample of this vector costs: complex data carries re and im. */
fn value_width(info: &VectorInfo) -> usize {
    if info.real_data.is_null() {
        2
    } else {
        1
    }
}

fn vector_length(info: &VectorInfo, name: &str) -> Result<usize, String> {
    usize::try_from(info.length)
        .map_err(|_| format!("ngspice returned an invalid length for {name}."))
}

/**
 * The fraction of each vector's samples that fits, decided for a whole plot.
 * 1.0 - the common case - means transfer everything untouched.
 */
fn transfer_keep_ratio(
    widest: usize,
    scalars: usize,
    vectors: usize,
    budget: usize,
) -> Result<f64, String> {
    let mut ratio = 1.0_f64;
    if widest > MAX_VECTOR_LENGTH {
        ratio = ratio.min(MAX_VECTOR_LENGTH as f64 / widest as f64);
    }
    if scalars > budget {
        // Two samples per vector - the endpoints - is the floor a resample can
        // reach. Under that there is no honest reduction left to make.
        if budget < vectors.saturating_mul(4) {
            return Err(format!(
                "ngspice returned {scalars} values, past what Tau can transfer even after reducing the sample rate. Reduce stop time, output resolution, or circuit size."
            ));
        }
        ratio = ratio.min(budget as f64 / scalars as f64);
    }
    Ok(ratio)
}

/**
 * Whether a reduction is large enough to tell the reader about.
 *
 * ngspice adds a handful of breakpoints past the requested output step on
 * almost every run, so trimming 15 samples from two million is a rounding
 * artifact, not news. Warning about it would train the reader to ignore the
 * warning that matters.
 */
fn worth_reporting(from: usize, to: usize) -> bool {
    to > 0 && (to as f64) < from as f64 * RESAMPLE_NOTICE_RATIO
}

/** How many samples of a `length`-point vector survive at `keep`. */
fn resampled_length(length: usize, keep: f64) -> usize {
    if keep >= 1.0 || length <= 2 {
        return length;
    }
    // Floor, so the sum over a plot cannot climb back over the budget.
    ((length as f64 * keep).floor() as usize).clamp(2, length)
}

/**
 * Pick `target` of `values`, evenly spaced, keeping the first and the last.
 *
 * Nearest-sample: every transferred number is one the solver actually
 * produced. Averaging neighbours would read as a smoother, better-behaved
 * circuit than the one that was simulated, and the endpoints are load-bearing
 * because the frontend takes the run's stop time from the last sample.
 */
fn resample<T: Copy>(values: &[T], target: usize) -> Vec<T> {
    if target >= values.len() || values.len() < 2 || target < 2 {
        return values.to_vec();
    }
    let last = values.len() - 1;
    let span = (target - 1) as f64;
    (0..target)
        .map(|index| {
            let source = ((index as f64) * (last as f64) / span).round() as usize;
            values[source.min(last)]
        })
        .collect()
}

/// Resample a complex ngspice vector directly into Tau's split transfer
/// format. Building `Vec<NgComplex>` with [`resample`] and then mapping its
/// components kept an otherwise unnecessary 16-byte temporary for every
/// retained AC sample. Large AC sweeps can retain millions of samples, so
/// write the two arrays in the one pass that the IPC result already requires.
///
/// Its index calculation intentionally matches [`resample`] exactly: every
/// returned number remains an original solver sample and both endpoints stay
/// present whenever reduction happens.
fn resample_complex(values: &[NgComplex], target: usize) -> (Vec<f64>, Vec<f64>) {
    let output_len = if target >= values.len() || values.len() < 2 || target < 2 {
        values.len()
    } else {
        target
    };
    let mut real = Vec::with_capacity(output_len);
    let mut imaginary = Vec::with_capacity(output_len);

    if output_len == values.len() {
        for value in values {
            real.push(value.real);
            imaginary.push(value.imag);
        }
        return (real, imaginary);
    }

    let last = values.len() - 1;
    let span = (output_len - 1) as f64;
    for index in 0..output_len {
        let source = ((index as f64) * (last as f64) / span).round() as usize;
        let value = values[source.min(last)];
        real.push(value.real);
        imaginary.push(value.imag);
    }
    (real, imaginary)
}

/** Where a result first stops being a number. Borrows the names it reports so
 * that scanning a result costs no allocation on the overwhelmingly common path
 * where there is nothing to report. */
struct NonFiniteSample<'a> {
    plot: &'a str,
    vector: &'a str,
    /** Set when the offending number is the imaginary half of an AC sample,
     * which is worth saying: the real half can look perfectly reasonable. */
    imaginary: bool,
    index: usize,
    length: usize,
    value: f64,
}

fn first_non_finite(values: &[f64]) -> Option<(usize, f64)> {
    values
        .iter()
        .position(|value| !value.is_finite())
        .map(|index| (index, values[index]))
}

/**
 * Walk every vector this run produced - the current plot and the secondary
 * ones a `.noise` or expanded `.step` leaves behind - and report the first
 * non-finite sample, how many vectors carry one, and how many there are.
 *
 * The counts matter to the reader: one bad vector out of forty is a single
 * misbehaving branch current, while forty out of forty is a solve that fell
 * over altogether, and those call for different things from the engineer.
 */
fn scan_non_finite(result: &SpiceResult) -> (Option<NonFiniteSample<'_>>, usize, usize) {
    let plots = std::iter::once((result.plot.as_str(), &result.vectors)).chain(
        result
            .extra_plots
            .iter()
            .map(|plot| (plot.name.as_str(), &plot.vectors)),
    );
    let mut first = None;
    let mut affected = 0_usize;
    let mut total = 0_usize;
    for (plot, vectors) in plots {
        for vector in vectors {
            total += 1;
            let hit = first_non_finite(&vector.real)
                .map(|(index, value)| (false, index, vector.real.len(), value))
                .or_else(|| {
                    let imaginary = vector.imaginary.as_deref()?;
                    first_non_finite(imaginary)
                        .map(|(index, value)| (true, index, imaginary.len(), value))
                });
            let Some((imaginary, index, length, value)) = hit else {
                continue;
            };
            affected += 1;
            first.get_or_insert(NonFiniteSample {
                plot,
                vector: &vector.name,
                imaginary,
                index,
                length,
                value,
            });
        }
    }
    (first, affected, total)
}

/** How to name a value that is not a number, in the words an engineer would
 * use for it rather than in Rust's. */
pub(crate) fn non_finite_kind(value: f64) -> &'static str {
    if value.is_nan() {
        "a NaN (not a number)"
    } else if value.is_sign_positive() {
        "+infinity"
    } else {
        "-infinity"
    }
}

/**
 * Where in the sweep the divergence happened, when the plot carries an axis
 * Tau can name. A sample index alone tells the reader nothing they can act on;
 * "at t = 3.6e-3 s" points straight at the part of the waveform to look at.
 *
 * Only ngspice's two universal scale vectors are recognised. A `.dc` sweep
 * names its axis after the swept source, and guessing which vector that is
 * would risk labelling an ordinary node voltage as the axis - so those runs
 * simply report the index, which is at least true.
 */
fn sweep_position(result: &SpiceResult, plot: &str, index: usize) -> Option<String> {
    let vectors = if plot == result.plot {
        &result.vectors
    } else {
        &result
            .extra_plots
            .iter()
            .find(|extra| extra.name == plot)?
            .vectors
    };
    for vector in vectors {
        let (label, unit) = if vector.name.eq_ignore_ascii_case("time") {
            ("t", "s")
        } else if vector.name.eq_ignore_ascii_case("frequency") {
            ("f", "Hz")
        } else {
            continue;
        };
        let value = vector.real.get(index).copied()?;
        // A scale vector that is itself non-finite cannot locate anything.
        return value
            .is_finite()
            .then(|| format!(", at {label} = {value:e} {unit}"));
    }
    None
}

/**
 * Refuse a result that contains a value which is not a number, before it is
 * ever serialised.
 *
 * JSON has no spelling for NaN or ±Inf. `serde_json` writes `null` in their
 * place and the *encode still succeeds*, so the worker hands over a payload
 * that looks complete; the parent then cannot read that `null` back into an
 * `f64` and throws the entire `SpiceResult` away - `messages` included, which
 * was the only record of why the solve went wrong. The user is left holding
 * "invalid type: null, expected f64" as the explanation for a circuit that
 * did not converge. Diagnosing it here, in the process that still holds the
 * deck and the engine log, is the only place the real cause is knowable.
 *
 * Why the whole run is refused instead of truncated at the first bad sample.
 * A partial result has to be drawn by a viewer with no way to say "this
 * stopped early because it failed": the viewer takes the run's stop time from
 * the last sample it is given (see `resample`), so a transient cut short at a
 * divergence is indistinguishable from a shorter transient that succeeded -
 * same axes, same clean curve, with the failure demoted to one line in a
 * message list sitting next to a plot that looks right. Tau does not invent
 * simulation values, and presenting a diverged solve as a finished waveform is
 * that same lie told with real numbers. A run that reached no trustworthy
 * answer says so, and shows the engine's log in place of a trace.
 *
 * On scope, honestly: this is a fail-closed guard at the serialisation
 * boundary, not the fix for a divergence anyone has reproduced through Tau.
 * Probing the engine directly - behavioural domain errors, division by zero,
 * an unstable `s_xfer` pole, degenerate `aswitch` thresholds, `.noise` with
 * zero gain, `.ac` down at DC - never got a non-finite number into a vector,
 * because ngspice saturates behavioural arithmetic at ±1e32 and its code
 * models guard their own divisions. The guard stays because the paths that
 * are *not* guarded - `slice::from_raw_parts` over memory the engine owns,
 * user-supplied OSDI or Verilog-A devices, any code model added later - fail
 * mutely and take the log with them, which is the worst way for a simulator
 * to be wrong.
 */
fn non_finite_failure(result: &SpiceResult) -> Option<String> {
    let (sample, affected, total) = scan_non_finite(result);
    let sample = sample?;
    let position = sweep_position(result, sample.plot, sample.index).unwrap_or_default();
    Some(format!(
        "ngspice's {plot} analysis returned values that are not finite numbers, so it did not \
         converge on a usable solution. First occurrence: {kind} in {vector}{part} at sample \
         {ordinal} of {length}{position}. Affected result vectors: {affected} of {total}. Tau \
         will not plot this run - the finite samples on either side of a divergence are not a \
         solution to the circuit, and drawing only those would present a failed solve as a \
         clean waveform.",
        plot = sample.plot,
        kind = non_finite_kind(sample.value),
        vector = sample.vector,
        part = if sample.imaginary {
            " (imaginary part)"
        } else {
            ""
        },
        // Counted from one: every other place a person meets these samples -
        // a cursor readout, an exported CSV row - counts them that way.
        ordinal = sample.index + 1,
        length = sample.length,
    ))
}

/**
 * The newest engine log lines, bounded, for an error to carry.
 *
 * When lines are left out the count says so, the same way `take_messages`
 * accounts for what its own overflow discarded. A silently shortened log
 * invites the reader to conclude the engine said nothing more.
 */
pub(crate) fn engine_log_tail(messages: &[String]) -> Vec<String> {
    if messages.len() <= MAX_ERROR_LOG_MESSAGES {
        return messages.to_vec();
    }
    let mut tail = Vec::with_capacity(MAX_ERROR_LOG_MESSAGES + 1);
    tail.push(format!(
        "Tau kept the last {MAX_ERROR_LOG_MESSAGES} of this run's {} engine log lines.",
        messages.len()
    ));
    tail.extend_from_slice(&messages[messages.len() - MAX_ERROR_LOG_MESSAGES..]);
    tail
}

/** Reunite a worker failure with the engine's own account of it, in the one
 * string shape `simulate_spice` is able to return. */
fn with_worker_engine_log(error: String, engine_log: &[String]) -> String {
    if engine_log.is_empty() {
        error
    } else {
        format!("{error} Engine log: {}", engine_log.join(" | "))
    }
}

#[tauri::command]
pub async fn simulate_spice(
    app: AppHandle,
    state: State<'_, NativeSpiceState>,
    request: SpiceRequest,
) -> Result<SpiceResult, String> {
    // Reject malformed or oversized input before starting another process.
    // The worker repeats this check before libngspice sees the deck.
    deck_lines(&request.netlist)?;

    // One engine at a time, across both paths. Held for the whole command by
    // RAII so every early return, cancellation and panic releases it; the
    // bounded-vs-bounded refusal below is left in place because it is the
    // narrower statement and predates the interlock.
    let _engine_lease = crate::live_spice::acquire_engine(crate::live_spice::EngineUse::Bounded)?;

    let cancellation = Arc::new(AtomicBool::new(false));
    let active_cancellation = Arc::clone(&state.active_cancellation);
    {
        let mut active = active_cancellation
            .lock()
            .map_err(|_| "ngspice worker lock was poisoned.".to_string())?;
        if active.is_some() {
            return Err("Another native ngspice analysis is already running.".to_string());
        }
        *active = Some(Arc::clone(&cancellation));
    }

    let worker_request = WorkerRequest {
        request,
        library_candidates: library_candidates(&app),
    };
    let task_result = tauri::async_runtime::spawn_blocking(move || {
        run_spice_worker_process(worker_request, cancellation, WORKER_TIMEOUT)
    })
    .await;

    if let Ok(mut active) = active_cancellation.lock() {
        *active = None;
    }
    task_result.map_err(|error| format!("Tau's ngspice worker task failed: {error}"))?
}

#[tauri::command]
pub fn cancel_spice(state: State<'_, NativeSpiceState>) -> Result<bool, String> {
    let active = state
        .active_cancellation
        .lock()
        .map_err(|_| "ngspice worker lock was poisoned.".to_string())?;
    if let Some(cancellation) = active.as_ref() {
        cancellation.store(true, Ordering::Release);
        Ok(true)
    } else {
        Ok(false)
    }
}

/** Runs before Tauri starts. A libngspice crash or non-converging solve is
 * therefore confined to this disposable process instead of Tau's UI process. */
pub fn maybe_run_spice_worker() -> bool {
    if std::env::args_os().nth(1).as_deref() != Some(std::ffi::OsStr::new(WORKER_ARG)) {
        return false;
    }

    let failed = |error: String| WorkerResponse {
        result: None,
        error: Some(error),
        engine_log: Vec::new(),
    };
    let response = match read_worker_request() {
        Ok(worker) => match SpiceEngine::load(worker.library_candidates)
            .and_then(|mut engine| engine.run(worker.request))
        {
            // Solving is not the same as answering. A result whose samples are
            // not all numbers cannot survive the hop to the parent process
            // (see `non_finite_failure`), and it is only here, beside the
            // engine log that explains it, that the failure can be named. The
            // log travels with the refusal because the refusal replaces the
            // `SpiceResult` that would otherwise have carried it.
            Ok(result) => match non_finite_failure(&result) {
                Some(error) => WorkerResponse {
                    result: None,
                    error: Some(error),
                    engine_log: engine_log_tail(&result.messages),
                },
                None => WorkerResponse {
                    result: Some(result),
                    error: None,
                    engine_log: Vec::new(),
                },
            },
            // Every other failure path already folds the engine's messages
            // into its own text on the way out (`with_engine_messages`,
            // `fatal_engine_messages`), so repeating them here would print
            // the log twice.
            Err(error) => failed(error),
        },
        Err(error) => failed(error),
    };

    // A large waveform is already resident in `response`. Keeping a second
    // complete JSON `Vec` here doubled that answer's worker-side transfer
    // memory immediately before it crossed the pipe. Stream it through a
    // fixed buffer instead: the parent still owns its bounded response buffer,
    // but the disposable worker needs only this 64 KiB serialization scratch.
    let stdout = std::io::stdout().lock();
    let mut stdout = std::io::BufWriter::with_capacity(WORKER_RESPONSE_BUFFER_BYTES, stdout);
    let _ = write_worker_response(&mut stdout, &response);
    true
}

/** Write exactly the worker protocol marker followed by one JSON response.
 *
 * `WorkerResponse` contains only strings, finite samples (checked above), and
 * finite-derived JSON primitives, so serde has no data-level failure mode at
 * this boundary. A pipe write failure means the parent has gone away; there is
 * no useful fallback response to send in that case. */
fn write_worker_response<W: Write>(output: &mut W, response: &WorkerResponse) -> Result<(), ()> {
    output.write_all(WORKER_RESPONSE_MARKER).map_err(|_| ())?;
    serde_json::to_writer(&mut *output, response).map_err(|_| ())?;
    output.flush().map_err(|_| ())
}

fn read_worker_request() -> Result<WorkerRequest, String> {
    let mut input = Vec::new();
    std::io::stdin()
        .lock()
        .take((MAX_WORKER_INPUT_BYTES + 1) as u64)
        .read_to_end(&mut input)
        .map_err(|error| format!("Could not read Tau's ngspice worker request: {error}"))?;
    if input.len() > MAX_WORKER_INPUT_BYTES {
        return Err("Tau's ngspice worker request exceeded its input limit.".to_string());
    }
    let worker: WorkerRequest = serde_json::from_slice(&input)
        .map_err(|error| format!("Tau's ngspice worker request was invalid: {error}"))?;
    deck_lines(&worker.request.netlist)?;
    Ok(worker)
}

/** How long to wait before checking a worker again, given how long its run has
 * already taken. Walks `WORKER_POLL_RAMP` in order and falls through to the
 * settled interval, so the wait only ever grows as a run gets longer, and is
 * never zero — the not-ready path must sleep, or this loop becomes a spin
 * competing with the solver it is waiting on. */
fn worker_poll_interval(elapsed: Duration) -> Duration {
    for (until, interval) in WORKER_POLL_RAMP {
        if elapsed < until {
            return interval;
        }
    }
    WORKER_POLL_INTERVAL
}

fn run_spice_worker_process(
    request: WorkerRequest,
    cancellation: Arc<AtomicBool>,
    timeout: Duration,
) -> Result<SpiceResult, String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("Could not locate Tau's ngspice worker executable: {error}"))?;
    let mut child = Command::new(executable)
        .arg(WORKER_ARG)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start Tau's isolated ngspice worker: {error}"))?;

    let encoded = serde_json::to_vec(&request)
        .map_err(|error| format!("Could not encode Tau's ngspice worker request: {error}"))?;
    if encoded.len() > MAX_WORKER_INPUT_BYTES {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Tau's ngspice worker request exceeded its input limit.".to_string());
    }
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Tau's ngspice worker stdin was unavailable.".to_string())?;
    stdin.write_all(&encoded).map_err(|error| {
        let _ = child.kill();
        let _ = child.wait();
        format!("Could not send the circuit to Tau's ngspice worker: {error}")
    })?;
    drop(stdin);

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Tau's ngspice worker stdout was unavailable.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Tau's ngspice worker stderr was unavailable.".to_string())?;
    let stdout_reader = thread::spawn(move || read_bounded(stdout, MAX_WORKER_OUTPUT_BYTES));
    let stderr_reader = thread::spawn(move || read_bounded(stderr, MAX_WORKER_STDERR_BYTES));

    let started = Instant::now();
    let (status, stop_reason) = loop {
        if cancellation.load(Ordering::Acquire) {
            let _ = child.kill();
            break (child.wait().ok(), Some("Simulation cancelled.".to_string()));
        }
        // One reading of the clock serves both decisions below: whether the run
        // has outlived its limit, and how long to wait before looking again.
        let elapsed = started.elapsed();
        if elapsed >= timeout {
            let _ = child.kill();
            break (
                child.wait().ok(),
                Some(format!(
                    "ngspice exceeded Tau's {}-second execution limit and was stopped.",
                    timeout.as_secs()
                )),
            );
        }
        match child.try_wait() {
            Ok(Some(status)) => break (Some(status), None),
            // Cancellation and the timeout are re-tested on every one of these
            // iterations, so a shorter wait early makes the Stop button more
            // responsive too, never less.
            Ok(None) => thread::sleep(worker_poll_interval(elapsed)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                break (
                    None,
                    Some(format!("Could not monitor Tau's ngspice worker: {error}")),
                );
            }
        }
    };

    let (stdout, stdout_overflow) = stdout_reader
        .join()
        .map_err(|_| "Tau's ngspice worker stdout reader crashed.".to_string())??;
    let (stderr, _) = stderr_reader
        .join()
        .map_err(|_| "Tau's ngspice worker stderr reader crashed.".to_string())??;
    let stderr = String::from_utf8_lossy(&stderr).trim().to_string();
    if let Some(reason) = stop_reason {
        return Err(if stderr.is_empty() {
            reason
        } else {
            format!("{reason} Worker diagnostics: {stderr}")
        });
    }
    if stdout_overflow {
        return Err("ngspice produced more data than Tau's worker transfer limit. Reduce output resolution or circuit size.".to_string());
    }
    let status =
        status.ok_or_else(|| "Tau's ngspice worker ended without a status.".to_string())?;
    if !status.success() {
        return Err(format!(
            "Tau's isolated ngspice worker crashed or exited with {status}.{}",
            if stderr.is_empty() {
                String::new()
            } else {
                format!(" Worker diagnostics: {stderr}")
            }
        ));
    }
    let marker = last_worker_response_marker(&stdout).ok_or_else(|| {
        format!(
            "Tau's ngspice worker returned no structured response.{}",
            if stderr.is_empty() {
                String::new()
            } else {
                format!(" Worker diagnostics: {stderr}")
            }
        )
    })?;
    let payload = &stdout[marker + WORKER_RESPONSE_MARKER.len()..];
    let response: WorkerResponse = serde_json::from_slice(payload)
        .map_err(|error| format!("Tau's ngspice worker returned invalid data: {error}"))?;
    match (response.result, response.error) {
        (Some(result), None) => Ok(result),
        (None, Some(error)) => Err(with_worker_engine_log(error, &response.engine_log)),
        _ => Err("Tau's ngspice worker returned an inconsistent response.".to_string()),
    }
}

/**
 * Find the final worker protocol marker without making a slice comparison at
 * every byte of its (potentially 256 MiB) response. The prior
 * `windows(...).rposition(...)` has a 22-byte comparison for every candidate
 * start, making its adversarial cost O(response_bytes × marker_bytes). This
 * fixed-marker KMP scan returns the same *last* match in O(response_bytes),
 * including non-UTF-8 ngspice preamble bytes.
 */
fn last_worker_response_marker(output: &[u8]) -> Option<usize> {
    let mut matched = 0_usize;
    let mut last_match = None;
    for (index, byte) in output.iter().copied().enumerate() {
        while matched > 0 && byte != WORKER_RESPONSE_MARKER[matched] {
            matched = WORKER_RESPONSE_MARKER_FAILURE[matched - 1];
        }
        if byte == WORKER_RESPONSE_MARKER[matched] {
            matched += 1;
            if matched == WORKER_RESPONSE_MARKER.len() {
                last_match = Some(index + 1 - WORKER_RESPONSE_MARKER.len());
                // Continue through the failure state so overlapping markers
                // still select their final occurrence, as rposition did.
                matched = WORKER_RESPONSE_MARKER_FAILURE[matched - 1];
            }
        }
    }
    last_match
}

fn read_bounded<R: Read>(mut reader: R, limit: usize) -> Result<(Vec<u8>, bool), String> {
    let mut output = Vec::new();
    let mut overflow = false;
    let mut chunk = [0_u8; 8192];
    loop {
        let count = reader
            .read(&mut chunk)
            .map_err(|error| format!("Could not read ngspice worker output: {error}"))?;
        if count == 0 {
            break;
        }
        let remaining = limit.saturating_sub(output.len());
        output.extend_from_slice(&chunk[..count.min(remaining)]);
        overflow |= count > remaining;
    }
    Ok((output, overflow))
}

pub(crate) fn library_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let mut paths = Vec::new();

    // A developer may explicitly point a debug build at a custom library.
    // Release builds only load Tau's bundled, signed resource.
    #[cfg(debug_assertions)]
    if let Some(path) = env::var_os("TAU_NGSPICE_LIB") {
        paths.push(PathBuf::from(path));
    }

    // Tauri owns platform-specific resource resolution. This covers macOS app
    // bundles, Linux AppImages/packages, Windows installers, and debug builds
    // without coupling a release build to an arbitrary system ngspice install.
    if let Ok(resource_dir) = app.path().resource_dir() {
        paths.push(resource_dir.join("ngspice/lib").join(library_file_name()));
    }

    // Tauri development commands run from the crate directory. Keep these
    // source-tree paths out of release binaries so a packaged app cannot fall
    // back to a library supplied by its working directory.
    #[cfg(debug_assertions)]
    if let Ok(current_dir) = env::current_dir() {
        paths.push(
            current_dir
                .join("resources/ngspice/lib")
                .join(library_file_name()),
        );
        paths.push(
            current_dir
                .join("apps/desktop/src-tauri/resources/ngspice/lib")
                .join(library_file_name()),
        );
    }
    let mut unique = Vec::new();
    for path in paths {
        if !unique.contains(&path) {
            unique.push(path);
        }
    }
    unique
}

const fn library_file_name() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "ngspice.dll"
    }
    #[cfg(target_os = "macos")]
    {
        "libngspice.dylib"
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        "libngspice.so"
    }
}

/** Tau's own parts emit XSPICE A devices - a D flip-flop becomes an
 * adc_bridge / d_dff / dac_bridge trio, and sample-and-hold and modulator
 * parts are A devices too - and every one of them lives in a dynamically
 * loaded `.cm` module. An engine build that staged no modules does not say so:
 * it warns "Unknown model type" on the model card, then fails on the instance
 * with an MIF error naming neither the missing module nor the fix, which reads
 * like a broken schematic rather than an incomplete engine. */
pub(crate) fn missing_codemodel_message(
    lines: &[String],
    codemodels_loaded: usize,
) -> Option<String> {
    if codemodels_loaded > 0 {
        return None;
    }
    // Line 0 is the deck title: free text, never a device.
    let device = lines.iter().skip(1).find_map(|line| {
        let mut fields = line.split_whitespace();
        let name = fields.next()?;
        let is_device = name.len() > 1 && name.starts_with(['a', 'A']) && fields.next().is_some();
        is_device.then_some(name)
    })?;
    Some(format!(
        "This circuit uses the XSPICE device {device}, but Tau's ngspice engine loaded no code models, so digital and behavioral A devices cannot be simulated on this install. Rebuild the bundled engine with scripts/build-ngspice.sh so its code-model modules are staged beside the library."
    ))
}

pub(crate) fn deck_lines(netlist: &str) -> Result<Vec<String>, String> {
    if netlist.len() > MAX_NETLIST_BYTES {
        return Err(format!(
            "The ngspice netlist exceeds Tau's {MAX_NETLIST_BYTES} byte limit."
        ));
    }
    let lines = netlist
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    if lines.is_empty() {
        return Err("The ngspice netlist is empty.".to_string());
    }
    if lines.len() > MAX_DECK_LINES {
        return Err(format!(
            "The ngspice netlist exceeds Tau's {MAX_DECK_LINES} line limit."
        ));
    }
    if !lines
        .last()
        .is_some_and(|line| line.trim().eq_ignore_ascii_case(".end"))
    {
        return Err("The ngspice netlist must end with an .end card.".to_string());
    }
    for (index, line) in lines.iter().enumerate().skip(1) {
        let compact = compact_lower(line);
        screen_card(&compact, index + 1)?;
        if compact.starts_with('.') {
            let card = compact.split(' ').next().unwrap_or_default();
            if card == ".end" && index + 1 != lines.len() {
                return Err(format!(
                    "The .end card must be the final non-empty line (line {}).",
                    index + 1
                ));
            }
        }
        // A SPICE continuation line starts with '+'; strip it so a smuggled
        // "+ shell foo" is screened exactly like "shell foo" (defense in
        // depth: ngspice treats such lines as inert parameters, but the
        // sanitizer should not depend on that).
        let command = compact
            .trim_start_matches('+')
            .split_whitespace()
            .next()
            .unwrap_or_default();
        if matches!(
            command,
            "shell"
                | "system"
                | "source"
                | "load"
                | "quit"
                | "exit"
                | "destroy"
                | "reset"
                | "resume"
                | "alter"
                | "altermod"
                | "run"
                | "bg_run"
                | "stop"
                | "remcirc"
                | "set"
                | "unset"
                | "let"
                | "write"
                | "wrdata"
                | "cd"
                | "codemodel"
                | "pre_osdi"
        ) {
            return Err(format!(
                "Unsafe ngspice command on line {} is not permitted.",
                index + 1
            ));
        }
    }
    // Screening a physical line screens text ngspice never parses in that
    // form: it folds every '+' continuation onto the card above first, so a
    // parameter name and its '=' can be split across the fold and reassemble
    // only inside the engine. Screen the folded cards as well. The engine
    // still receives the original physical lines, unchanged.
    for card in stitch_cards(&lines)? {
        screen_card(&card.text, card.line_number)?;
    }
    Ok(lines)
}

/// One logical ngspice card: the opening line with every following '+'
/// continuation folded in, exactly as the engine stitches them.
struct StitchedCard {
    /// 1-based physical line the card opens on, for diagnostics.
    line_number: usize,
    /// Lowercased, whitespace-collapsed, continuations folded in.
    text: String,
}

/// Lowercase a deck line and collapse every whitespace run to a single space,
/// so that exotic spacing cannot hide a token from the screens below.
fn compact_lower(line: &str) -> String {
    line.to_ascii_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Fold the deck's continuation lines into logical cards. The title line is
/// never a card, so a deck whose first non-title line is a continuation has
/// nothing to continue and is rejected outright. A full-line '*' comment may
/// legitimately sit between a card and its continuation, so a comment neither
/// opens a card nor closes the one above it.
fn stitch_cards(lines: &[String]) -> Result<Vec<StitchedCard>, String> {
    let mut cards: Vec<StitchedCard> = Vec::new();
    let mut open: Option<usize> = None;
    for (index, line) in lines.iter().enumerate().skip(1) {
        let compact = compact_lower(line);
        if compact.is_empty() || compact.starts_with('*') {
            continue;
        }
        if compact.starts_with('+') {
            let Some(target) = open else {
                return Err(format!(
                    "Line {} continues an ngspice card that does not exist.",
                    index + 1
                ));
            };
            // ngspice replaces the '+' with a space, so tokens never glue
            // across the fold; join the same way.
            let card = &mut cards[target];
            card.text.push(' ');
            card.text
                .push_str(compact.trim_start_matches('+').trim_start());
            continue;
        }
        cards.push(StitchedCard {
            line_number: index + 1,
            text: compact,
        });
        open = Some(cards.len() - 1);
    }
    Ok(cards)
}

/// Screen one card, physical or stitched. `compact` must come from
/// [`compact_lower`]; `line_number` is 1-based and only used for diagnostics.
/// The last gate before a string reaches `ngSpice_Command`, shared by every
/// caller in the crate.
///
/// `ngSpice_Command` is the whole ngspice command interpreter, not the netlist
/// parser: `source`, `shell`, `destroy` and `write` are all reachable through it,
/// its text is split on whitespace and newlines, and it applies backquote and
/// `$` expansion. `screen_card`'s deck allowlist gives this channel no protection
/// at all, because nothing sent here is a deck card.
///
/// It screens two independent things, and needs both:
///
///  1. An ALLOWLIST of verbs. A metacharacter denylist alone would have passed
///     `source /etc/passwd` - no metacharacter, entirely dangerous. Writing the
///     test for this fix is what surfaced that, so the verb is checked first.
///  2. The characters that let one command become two, or that trigger
///     expansion, so a validated verb cannot carry a second command in its
///     arguments.
///
/// It lives in ONE place on purpose. Both channels - the batch runner's
/// `run_named_command` and the live session's `raw_command` - must agree, and the
/// vulnerability this closes existed precisely because they did not: the live
/// path validated its fields (`live_spice::alter_command`) while the batch path
/// grew `.step` source stepping later and spliced an unvalidated name from a
/// `.asc` straight into `alter`. Two lists would drift again.
pub(crate) fn reject_interpreter_metacharacters(command: &str) -> Result<(), String> {
    /// Every verb this crate legitimately sends. Adding one is a deliberate act.
    const ALLOWED_VERBS: [&str; 6] = ["remcirc", "run", "bg_run", "bg_halt", "bg_resume", "alter"];

    let verb = command.split_whitespace().next().unwrap_or_default();
    if !ALLOWED_VERBS.contains(&verb) {
        return Err(format!(
            "Refusing the ngspice command {verb:?}: Tau sends only its own fixed set of engine commands."
        ));
    }
    if let Some(bad) = command.chars().find(|c| {
        matches!(
            c,
            '`' | '$' | ';' | '|' | '&' | '<' | '>' | '(' | ')' | '\n' | '\r' | '\0'
        )
    }) {
        return Err(format!(
            "Refusing an ngspice command containing {bad:?}: Tau assembles engine commands from validated fields only."
        ));
    }
    Ok(())
}

fn screen_card(compact: &str, line_number: usize) -> Result<(), String> {
    // The embedded engine executes inside Tau's process and is not covered
    // by Tauri's filesystem scope. Reject every supported ngspice/XSPICE
    // file-backed form before the deck reaches it; model/source files must
    // be resolved and copied into a Tau-owned model representation instead.
    if references_a_file(compact) {
        return Err(format!(
            "File-backed ngspice primitives on line {line_number} are not permitted."
        ));
    }
    if compact.starts_with('.') {
        let card = compact.split(' ').next().unwrap_or_default();
        if !matches!(
            card,
            ".model"
                | ".option"
                | ".options"
                | ".tran"
                | ".op"
                | ".ac"
                | ".dc"
                | ".step"
                | ".meas"
                | ".measure"
                | ".noise"
                | ".tf"
                | ".param"
                | ".params"
                | ".func"
                | ".temp"
                | ".ic"
                | ".nodeset"
                | ".save"
                | ".four"
                | ".global"
                | ".subckt"
                | ".ends"
                | ".end"
        ) {
            return Err(format!(
                "Unsupported ngspice card on line {line_number}: {card}."
            ));
        }
    }
    Ok(())
}

/// True when a card names a file-backed ngspice/XSPICE primitive. `compact`
/// is already lowercase, so this is the case-insensitive equivalent of
/// `/(filesource|pwl\(file|[a-z0-9_]*file(name)?\s*=)/i`: every parameter
/// whose name ends in `file` or `filename` (`file=`, `file =`, `filename=`,
/// `input_file =`, `state_file=`, and any future spelling) plus the two forms
/// that carry no '=' at all. Matching on the suffix rather than a fixed set
/// of names keeps parameters Tau has not seen yet inside the screen.
fn references_a_file(compact: &str) -> bool {
    if compact.contains("filesource") || compact.contains("pwl(file") {
        return true;
    }
    let bytes = compact.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if !is_parameter_byte(bytes[index]) {
            index += 1;
            continue;
        }
        let start = index;
        while index < bytes.len() && is_parameter_byte(bytes[index]) {
            index += 1;
        }
        // Slicing is safe: both bounds sit on ASCII bytes, never inside a
        // multi-byte character.
        let word = &compact[start..index];
        if !word.ends_with("file") && !word.ends_with("filename") {
            continue;
        }
        let mut cursor = index;
        while bytes.get(cursor).is_some_and(u8::is_ascii_whitespace) {
            cursor += 1;
        }
        if bytes.get(cursor) == Some(&b'=') {
            return true;
        }
    }
    false
}

fn is_parameter_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

pub(crate) unsafe fn c_string(pointer: *mut c_char) -> Option<String> {
    if pointer.is_null() {
        None
    } else {
        Some(
            unsafe { CStr::from_ptr(pointer) }
                .to_string_lossy()
                .into_owned(),
        )
    }
}

pub(crate) fn clear_callback_state(state: &CallbackState) {
    if let Ok(mut messages) = state.messages.lock() {
        messages.clear();
    }
    if let Ok(mut dropped) = state.dropped_messages.lock() {
        *dropped = 0;
    }
    if let Ok(mut exit) = state.exit_message.lock() {
        *exit = None;
    }
}

pub(crate) fn take_messages(state: &CallbackState) -> Vec<String> {
    let mut messages = state
        .messages
        .lock()
        .map(|mut messages| std::mem::take(&mut *messages))
        .unwrap_or_default();
    let dropped = state
        .dropped_messages
        .lock()
        .map(|mut dropped| std::mem::take(&mut *dropped))
        .unwrap_or_default();
    if dropped > 0 {
        messages.insert(
            0,
            format!("Tau omitted {dropped} earlier ngspice diagnostic messages."),
        );
    }
    messages
}

fn with_engine_messages(state: &CallbackState, message: String) -> String {
    let messages = take_messages(state);
    if messages.is_empty() {
        message
    } else {
        format!("{message}: {}", messages.join(" | "))
    }
}

/** Read the engine's diagnostics without consuming them.
 *
 * `take_messages` is a drain, and a drain is where a diagnostic goes to die:
 * the live path folds this same buffer into the `engineLog` of every telemetry
 * frame, so a caller that only wants to *ask a question* of the log must not be
 * the reason the engineer never sees it. `fatal_engine_messages` peeks for
 * exactly that reason; this is the same read for a caller with a different
 * question. */
pub(crate) fn peek_messages(state: &CallbackState) -> Vec<String> {
    state
        .messages
        .lock()
        .map(|messages| messages.clone())
        .unwrap_or_default()
}

/** ngSpice_Circ can return status 0 even after a parser/MIF failure. Without
 * this guard ngSpice_CurPlot then points at the previous successful circuit,
 * and Tau can accidentally receive stale vectors as if they belonged to the
 * new run. Treat only explicit fatal/error callback lines as failures; ordinary
 * convergence warnings stay attached to a valid result. */
pub(crate) fn fatal_engine_messages(state: &CallbackState) -> Option<String> {
    let messages = state.messages.lock().ok()?;
    let fatal = messages.iter().any(|message| {
        let lower = message.to_ascii_lowercase();
        lower.contains("stderr error")
            || lower.contains("mif-error")
            || lower.contains("circuit not parsed")
            || lower.contains("fatal error")
    });
    fatal.then(|| format!("ngspice rejected the circuit: {}", messages.join(" | ")))
}

/** libngspice owns process-global callback and circuit state, and so does the
 * engine-lease slot the bounded and live paths share. Cargo runs tests in
 * parallel by default, so independent `SpiceEngine` instances - and independent
 * lease acquisitions - can otherwise race inside the same process and abort the
 * test binary. Lives outside the test module so `live_spice`'s proofs serialise
 * against these ones rather than against a private copy that would not.
 *
 * Keeps the real-library proofs deterministic without weakening ordinary
 * unit-test parallelism. */
#[cfg(test)]
pub(crate) static REAL_ENGINE_TEST: Mutex<()> = Mutex::new(());

#[cfg(test)]
pub(crate) fn real_engine_test_guard() -> std::sync::MutexGuard<'static, ()> {
    REAL_ENGINE_TEST
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use std::{
        ffi::{c_char, c_int, c_void, CString},
        io::Cursor,
        path::PathBuf,
        process::Command,
        ptr, slice,
        sync::{atomic::Ordering, Mutex},
        thread,
        time::{Duration, Instant},
    };

    use super::real_engine_test_guard;
    use super::{
        deck_lines, engine_log_tail, fatal_engine_messages, last_worker_response_marker,
        library_file_name, missing_codemodel_message, non_finite_failure, on_bg_thread, on_char,
        on_exit, on_stat, read_bounded, record_engine_message, resample, resample_complex,
        resampled_length, take_messages, transfer_keep_ratio, with_worker_engine_log,
        worker_poll_interval, worth_reporting, write_worker_response, CallbackState, Library,
        NgComplex, SpiceApi, SpiceEngine, SpiceRequest, SpiceResult, SpiceVector, WorkerResponse,
        MAX_ENGINE_MESSAGES, MAX_ENGINE_MESSAGE_BYTES, MAX_ERROR_LOG_MESSAGES, MAX_TRANSFER_VALUES,
        MAX_VECTOR_LENGTH, WORKER_POLL_INTERVAL, WORKER_POLL_RAMP, WORKER_RESPONSE_MARKER,
    };

    /** What `read_vectors` does to one plot, without a live engine: measure,
     * pick one ratio, apply it to every vector. */
    fn plan(lengths: &[usize], budget: usize) -> Result<Vec<usize>, String> {
        let widest = lengths.iter().copied().max().unwrap_or(0);
        let scalars: usize = lengths.iter().sum();
        let keep = transfer_keep_ratio(widest, scalars, lengths.len(), budget)?;
        Ok(lengths
            .iter()
            .map(|length| resampled_length(*length, keep))
            .collect())
    }

    #[test]
    fn a_short_run_is_noticed_promptly_and_a_long_one_still_costs_almost_nothing() {
        // A zero interval anywhere in the ramp would turn the worker wait into
        // a spin on the same machine that is trying to solve the circuit.
        assert!(
            WORKER_POLL_RAMP
                .iter()
                .all(|(_, interval)| *interval > Duration::ZERO),
            "{WORKER_POLL_RAMP:?} would busy-wait"
        );
        // Phases have to ascend in both columns. A ramp that dipped back to a
        // faster interval later would charge a long run for latency it cannot
        // use, which is the whole thing this schedule exists to avoid.
        assert!(
            WORKER_POLL_RAMP
                .windows(2)
                .all(|pair| pair[0].0 < pair[1].0 && pair[0].1 <= pair[1].1),
            "{WORKER_POLL_RAMP:?} is not monotonic"
        );
        assert!(WORKER_POLL_RAMP[WORKER_POLL_RAMP.len() - 1].1 <= WORKER_POLL_INTERVAL);

        // The case the ramp exists for: a run that answers in ~1 ms is seen
        // within a quarter of a millisecond rather than within 20 ms.
        assert_eq!(
            worker_poll_interval(Duration::from_millis(1)),
            Duration::from_micros(250)
        );
        // Each boundary belongs to the slower phase, and past the ramp the
        // wait is exactly the flat one a long run always had.
        assert_eq!(
            worker_poll_interval(Duration::from_millis(5)),
            Duration::from_millis(1)
        );
        assert_eq!(
            worker_poll_interval(Duration::from_millis(20)),
            Duration::from_millis(5)
        );
        assert_eq!(
            worker_poll_interval(Duration::from_millis(100)),
            WORKER_POLL_INTERVAL
        );
        assert_eq!(
            worker_poll_interval(Duration::from_secs(90)),
            WORKER_POLL_INTERVAL
        );

        // The wakeup budget the ramp's comment claims, counted instead of
        // asserted: 51 checks before it settles. A flat 20 ms poll would have
        // spent 5 over the same span, so a multi-second run pays 46 extra
        // wakeups once and nothing after that.
        let mut elapsed = Duration::ZERO;
        let mut wakeups = 0_usize;
        while elapsed < Duration::from_millis(100) {
            elapsed += worker_poll_interval(elapsed);
            wakeups += 1;
        }
        assert_eq!(wakeups, 51);
    }

    #[test]
    fn a_plot_that_fits_is_transferred_untouched() {
        let lengths = vec![240_usize; 12];
        assert_eq!(plan(&lengths, MAX_TRANSFER_VALUES).unwrap(), lengths);
        let values: Vec<f64> = (0..240).map(|i| i as f64).collect();
        assert_eq!(resample(&values, 240), values);
    }

    #[test]
    fn complex_resample_keeps_the_exact_real_and_imaginary_solver_samples() {
        let values: Vec<NgComplex> = (0..10)
            .map(|index| NgComplex {
                real: index as f64,
                imag: -(index as f64),
            })
            .collect();

        // Compare every boundary behavior to the generic resampler. The split
        // transfer must make exactly the same choice without first allocating
        // a complex copy (target 3, for example, selects 0, 5, and 9).
        for target in [0_usize, 1, 2, 3, 4, 9, 10, 16] {
            let expected = resample(&values, target);
            let (real, imaginary) = resample_complex(&values, target);
            assert_eq!(
                real,
                expected.iter().map(|value| value.real).collect::<Vec<_>>()
            );
            assert_eq!(
                imaginary,
                expected.iter().map(|value| value.imag).collect::<Vec<_>>()
            );
        }
    }

    #[test]
    fn a_marginal_overrun_costs_a_marginal_number_of_samples() {
        // The exact shape of the failure this replaces: a 60 s transient asked
        // for 1,999,999 output points and ngspice returned 2,000,014, so the
        // whole run was discarded. Halving it (a plain stride of 2) would be
        // nearly as bad an answer as refusing it.
        let length = 2_000_014;
        let target = plan(&[length], MAX_TRANSFER_VALUES).unwrap()[0];
        // Count what the resampler actually returns, not what was planned for
        // it: a stride-based reduction hits the plan and still halves the data.
        let values: Vec<f64> = (0..length).map(|index| index as f64).collect();
        let kept = resample(&values, target).len();
        assert!(kept <= MAX_VECTOR_LENGTH, "kept {kept} past the ceiling");
        assert!(
            kept as f64 > length as f64 * 0.9999,
            "kept only {kept} of {length}"
        );
    }

    #[test]
    fn resampling_keeps_both_endpoints_and_never_repeats_a_sample() {
        let values: Vec<f64> = (0..10_000).map(|i| i as f64 * 0.5).collect();
        for target in [2_usize, 3, 7, 999, 5_000, 9_999] {
            let kept = resample(&values, target);
            assert_eq!(kept.len(), target);
            assert_eq!(kept[0], values[0], "first sample lost at {target}");
            assert_eq!(
                kept[target - 1],
                values[values.len() - 1],
                "last sample lost at {target}"
            );
            // Strictly increasing sources: a repeat would show as a waveform
            // that stalls, and the time axis would stop being monotonic.
            assert!(
                kept.windows(2).all(|pair| pair[1] > pair[0]),
                "repeated sample at {target}"
            );
        }
    }

    #[test]
    fn every_trace_in_a_plot_keeps_the_same_length_as_its_time_axis() {
        // The frontend drops any trace whose length disagrees with `time`, so a
        // per-vector reduction would delete currents rather than shorten them.
        let lengths = vec![3_000_000_usize; 6];
        let kept = plan(&lengths, MAX_TRANSFER_VALUES).unwrap();
        assert!(kept.windows(2).all(|pair| pair[0] == pair[1]), "{kept:?}");
        assert!(kept[0] <= MAX_VECTOR_LENGTH);
    }

    #[test]
    fn a_wide_plot_is_reduced_to_the_scalar_budget() {
        // No single vector is over the per-trace ceiling; the plot as a whole
        // is over the transfer budget, which used to be its own hard error.
        let lengths = vec![1_000_000_usize; 40];
        let kept = plan(&lengths, MAX_TRANSFER_VALUES).unwrap();
        let total: usize = kept.iter().sum();
        assert!(
            total <= MAX_TRANSFER_VALUES,
            "{total} values past the {MAX_TRANSFER_VALUES} budget"
        );
        assert!(kept.iter().all(|length| *length >= 2));
    }

    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn a_long_transient_past_the_transfer_ceiling_returns_a_result() {
        // The reported failure, end to end: a long run whose output overshoots
        // the per-trace ceiling used to be discarded after solving. ngspice
        // adds breakpoints past the requested output step, so a request sized
        // at the ceiling cannot stay under it - the boundary has to bend.
        let _guard = real_engine_test_guard();
        let library = std::env::var_os("TAU_NGSPICE_LIB")
            .map(PathBuf::from)
            .expect("TAU_NGSPICE_LIB must point to a shared ngspice library");
        let mut engine = SpiceEngine::load(vec![library]).expect("ngspice library should load");
        let step = 60.0 / 2_100_000.0;
        let result = engine
            .run(SpiceRequest {
                netlist: format!(
                    "Tau long transient\nV1 in 0 SIN(0 1 1)\nR1 in mid 1k\nC1 mid 0 100n\n.tran {step} 60\n.end"
                ),
            })
            .expect("a long transient must return data, not an error");

        let time = result
            .vectors
            .iter()
            .find(|vector| vector.name.eq_ignore_ascii_case("time"))
            .expect("transient plot must carry a time vector");
        // Landing on the ceiling is the reduction's own signature; ngspice does
        // not stop there by itself. If this ever reads well under the ceiling,
        // the fixture stopped overshooting and the test stopped proving
        // anything - fail loudly rather than pass by accident.
        assert!(
            (MAX_VECTOR_LENGTH - 1..=MAX_VECTOR_LENGTH).contains(&time.real.len()),
            "expected the reduction to land on the {MAX_VECTOR_LENGTH} ceiling, got {} points",
            time.real.len()
        );
        // The window is still the whole 60 s, and it still reads as time.
        assert!(
            (time.real.last().copied().unwrap_or_default() - 60.0).abs() < 1e-6,
            "run stops at {:?}",
            time.real.last()
        );
        assert!(time.real.windows(2).all(|pair| pair[1] > pair[0]));
        // This fixture loses ~5% of its samples, which the reader is told about
        // rather than left to discover. `engineWarnings` on the TypeScript side
        // only forwards messages that read as warnings.
        assert!(
            result
                .messages
                .iter()
                .any(|message| message.starts_with("Warning:") && message.contains("full rate")),
            "no reduction notice in {:?}",
            result.messages
        );
        for vector in &result.vectors {
            assert_eq!(
                vector.real.len(),
                time.real.len(),
                "{} desynchronised from the time axis",
                vector.name
            );
        }
    }

    #[test]
    fn only_a_reduction_the_reader_would_notice_is_reported() {
        assert!(!worth_reporting(0, 0), "an untouched plot says nothing");
        // The reported case: 15 breakpoints past a 2,000,000 request.
        assert!(!worth_reporting(2_000_015, 2_000_000));
        // Losing a fifth of the samples changes what the plot can show.
        assert!(worth_reporting(2_500_000, 2_000_000));
    }

    #[test]
    fn a_budget_too_small_for_endpoints_is_still_an_error() {
        // There is no honest reduction below two samples per trace.
        assert!(transfer_keep_ratio(1_000, 10_000, 5_000, 8).is_err());
        assert!(transfer_keep_ratio(1_000, 10_000, 4, 8_000).is_ok());
    }

    #[test]
    fn accepts_a_complete_deck() {
        let deck = deck_lines("Tau\nR1 1 0 1k\n.op\n.end\n").expect("deck should parse");
        assert_eq!(deck.last().map(String::as_str), Some(".end"));
    }

    #[test]
    fn requires_an_end_card() {
        assert!(deck_lines("Tau\n.op\n").is_err());
    }

    /// The sink gate, tested directly. Both command channels route through this
    /// one function precisely so they cannot drift apart again - the batch path
    /// spliced an unvalidated `.step` name into `alter` while the live path
    /// validated its fields.
    #[test]
    fn refuses_interpreter_metacharacters_on_the_command_channel() {
        for hostile in [
            "alter v1`id`=1",
            "alter v1=1;shell touch /tmp/x",
            "alter v1=1|tee /tmp/x",
            "alter $foo=1",
            "alter v1=1 && whoami",
            "alter v1=1\nshell id",
            "alter v1=1 > /tmp/x",
            "source /etc/passwd",
        ] {
            assert!(
                super::reject_interpreter_metacharacters(hostile).is_err(),
                "let a metacharacter through: {hostile:?}"
            );
        }
        // Everything this crate legitimately sends still passes.
        for real in [
            "remcirc",
            "run",
            "bg_run",
            "bg_halt",
            "bg_resume",
            "alter v1 = 5",
            "alter r2 resistance = 1000",
        ] {
            assert!(
                super::reject_interpreter_metacharacters(real).is_ok(),
                "refused a real engine command: {real}"
            );
        }
    }

    #[test]
    fn rejects_control_cards_and_shell_commands() {
        assert!(deck_lines("Tau\n.control\nshell touch /tmp/nope\n.end\n").is_err());
        assert!(deck_lines("Tau\nR1 1 0 1k\n.include outside.lib\n.op\n.end\n").is_err());
    }

    #[test]
    fn accepts_safe_inline_models_and_analysis_cards_without_file_access() {
        let netlist = r#"Tau safe complex deck
.param gain=2
.params offset=1
.func twice(x) {2*x}
.global vdd
.subckt cell in out params: r=1k
R1 in out {r}
.ends cell
X1 in out cell r=2k
V1 in 0 1
.ic v(out)=0
.nodeset v(out)=0.5
.temp 27
.save v(in) v(out)
.tran 1u 1m
.dc V1 0 1 .1
.ac dec 10 1 1Meg
.noise v(out) V1 dec 10 1 1Meg
.tf v(out) V1
.step param gain 1 3 1
.meas tran peak MAX v(out)
.four 1k v(out)
.end"#;
        assert!(deck_lines(netlist).is_ok());
    }

    /// The device-current `.save` a transient or operating-point deck carries
    /// for every semiconductor on the schematic. The corpus proof runs the
    /// ngspice binary directly, which never sees this sanitizer - so without
    /// this test a card the screen rejected would break every transistor
    /// transient and every operating point in the app while every TypeScript
    /// gate stayed green.
    #[test]
    fn accepts_the_device_current_save_card_and_its_continuations() {
        let netlist = r#"Tau device currents
V1 vcc 0 5
Q1 coll base 0 TAU_NPN
D1 coll out TAU_DIODE
M1 out gate 0 0 TAU_NMOS
.model TAU_NPN NPN(BF=200)
.model TAU_DIODE D(IS=1e-14)
.model TAU_NMOS NMOS(LEVEL=1)
.save all @q1[ic] @d1[id]
+ @m1[id]
.tran 1u 1m
.end"#;
        assert!(deck_lines(netlist).is_ok());
        // The same card now precedes an `.op`, which is the analysis the whole
        // acceptance corpus runs through.
        assert!(deck_lines(&netlist.replace(".tran 1u 1m", ".op")).is_ok());
    }

    #[test]
    fn rejects_external_files_control_flow_and_interpreter_commands() {
        for unsafe_line in [
            ".include /tmp/host-model.lib",
            ".inc ../host-model.lib",
            ".lib /tmp/host-model.lib",
            ".control",
            ".pre_osdi /tmp/foreign.osdi",
            "source /tmp/commands.cir",
            "load /tmp/plot.raw",
            "write /tmp/exfil.raw all",
            "wrdata /tmp/exfil.txt all",
            "shell touch /tmp/nope",
            "system touch /tmp/nope",
            "alter R1=0",
            "altermod M1 vto=0",
            "resume",
            "codemodel /tmp/foreign.cm",
            ".model input filesource(file=\"/tmp/secret.csv\")",
            ".model input filesource(filename = ../secret.csv)",
            "V1 in 0 PWL(file=/tmp/secret.csv)",
        ] {
            let deck = format!("Tau adversarial deck\n{unsafe_line}\n.end\n");
            assert!(
                deck_lines(&deck).is_err(),
                "unsafe line was accepted: {unsafe_line}"
            );
        }

        assert!(deck_lines("Tau\n.end\nR1 1 0 1k\n.end\n").is_err());
    }

    #[test]
    fn screens_continuation_lines_like_their_unfolded_form() {
        // A '+' continuation used to hide the command token from the
        // blocklist. ngspice treats these as inert parameters, but the
        // sanitizer must not depend on that.
        for unsafe_line in [
            "+ shell touch /tmp/nope",
            "+shell touch /tmp/nope",
            "+ quit",
            "+ write /tmp/exfil.raw",
        ] {
            let deck = format!("Tau adversarial deck\nV1 in 0 5\n{unsafe_line}\n.end\n");
            assert!(
                deck_lines(&deck).is_err(),
                "continuation-smuggled line was accepted: {unsafe_line}"
            );
        }
        // Ordinary continuation parameters still pass.
        let benign =
            "Tau deck\nV1 in 0 PULSE(0 5 0 1n\n+ 1n 0.5m 1m)\nR1 in 0 1k\n.tran 1u 1m\n.end\n";
        assert!(
            deck_lines(benign).is_ok(),
            "benign continuation was rejected"
        );
    }

    #[test]
    fn rejects_file_parameters_split_across_a_continuation() {
        // Each of these passes every single-physical-line screen: the opening
        // line carries no '=' and the continuation carries no file token. Only
        // the stitched card ngspice actually parses shows the file reference.
        for unsafe_deck in [
            // The audit's S1 proof of concept: XSPICE d_source input_file.
            "Tau adversarial deck\n.model dsrc d_source(input_file\n+ = \"/Users/victim/keys.txt\")\n.end\n",
            // The '=' opens the continuation with no space of its own.
            "Tau adversarial deck\n.model dsrc d_source(input_file\n+=\"/etc/passwd\")\n.end\n",
            // The parameter name itself is split across the fold.
            "Tau adversarial deck\n.model dsrc d_source(input_\n+ file = \"/etc/passwd\")\n.end\n",
            // PWL file, spaced so that the "pwl(file" substring never appears.
            "Tau adversarial deck\nV1 in 0 PWL ( file\n+ = \"/etc/passwd\" )\nR1 in 0 1k\n.tran 1u 1m\n.end\n",
            // d_state state_file, which the old substring set never listed.
            "Tau adversarial deck\n.model dstate d_state(state_file\n+ = \"/etc/passwd\")\n.end\n",
            // table2d file, folded twice.
            "Tau adversarial deck\n.model tbl table2d(file\n+\n+ = \"/etc/passwd\")\n.end\n",
            // A '*' comment between the card and its fold must not reopen it.
            "Tau adversarial deck\n.model dsrc d_source(input_file\n* datasheet note\n+ = \"/etc/passwd\")\n.end\n",
            // Inside a .subckt body, the way a downloaded vendor .lib reaches
            // the deck (userModelLibrary.ts captures blocks verbatim).
            "Tau adversarial deck\n.subckt vendor a b\nR1 a b 1k\n.model dsrc d_source(input_file\n+ = \"/etc/passwd\")\n.ends vendor\nX1 in 0 vendor\n.op\n.end\n",
        ] {
            assert!(
                deck_lines(unsafe_deck).is_err(),
                "continuation-split file parameter was accepted: {unsafe_deck}"
            );
        }

        // The same parameters on a single line stay rejected, including the
        // spellings the old fixed substring set did not enumerate.
        for unsafe_line in [
            ".model dsrc d_source(input_file = \"/etc/passwd\")",
            ".model dstate d_state(state_file=\"/etc/passwd\")",
            ".model tbl table2d(file = \"/etc/passwd\")",
            ".model src filesource(filename=\"/etc/passwd\")",
        ] {
            let deck = format!("Tau adversarial deck\n{unsafe_line}\n.end\n");
            assert!(
                deck_lines(&deck).is_err(),
                "file parameter was accepted: {unsafe_line}"
            );
        }

        // A continuation with no card above it cannot be screened as anything,
        // so it is refused outright rather than folded into the title.
        assert!(deck_lines("Tau adversarial deck\n+ = \"/etc/passwd\"\n.end\n").is_err());
    }

    #[test]
    fn accepts_vendor_macromodels_that_fold_long_parameter_lists() {
        // Real vendor .lib files continue long .model cards over many lines.
        // Folding them before screening must not make them look hostile.
        let vendor = "Tau vendor deck
.subckt opamp 1 2 99 50 45
Q1 4 2 6 QIN
.model QIN NPN(IS=8E-16 BF=110 VAF=130 IKF=2.2E-3
+ ISE=1.3E-16 NE=2 BR=2 VAR=20 IKR=2E-3 ISC=1E-16
+ NC=2 RB=2E3 RE=10 RC=100 CJE=1.3E-12 VJE=0.7
+ MJE=0.4 CJC=0.8E-12 VJC=0.55 MJC=0.5 TF=0.3E-9)
.model DX D(IS=1E-14)
.ends opamp
X1 in fb vcc vee out opamp
V1 in 0 PULSE(0 5 0 1n
+ 1n 0.5m 1m)
R1 out fb 10k
.tran 1u 1m
.end
";
        assert!(
            deck_lines(vendor).is_ok(),
            "a folded vendor parameter list was rejected"
        );
    }

    #[test]
    fn accepts_a_vendor_style_opamp_macromodel() {
        // Screened the way userModelLibrary.ts hands an attached library over:
        // verbatim, comments and all. The fixture is Tau's own, written to
        // carry the constructs published op-amp macromodels actually use and
        // that the allowlist has to survive - uppercase cards, numeric nodes,
        // tabbed comment art, POLY sources, a CCVS naming a vsource,
        // parenthesized switch control nodes, and comma-separated .model
        // parameter lists.
        let vendor = "* Tau vendor-style CMOS rail-to-rail op-amp macromodel
* Node Assignments
*\t\t\t\tnoninverting input
*\t\t\t\t|\tinverting input
*\t\t\t\t|\t|\t positive supply
*\t\t\t\t|\t|\t |\t negative supply
*\t\t\t\t|\t|\t |\t |\t output
.SUBCKT TAUOPA\t1\t2\t99\t50\t45
M1   4  1 8 8 PIX L=2.0E-6 W=98E-6
M2   6  7 8 8 PIX L=2.0E-6 W=98E-6
I1  99  8 1.77E-5
EOS  7  2 POLY(3) (22,98) (73,98) (81,0) 1.0E-3 1 1 1
GB1  1 50 POLY(3) (8,1) (4,1) (50,1) 0.5E-12 1E-12 1E-12 1E-12
ECM1 21 98 POLY(2) (1,98) (2,98) 0 .5 .5
VN1 80 0 0
HN  81 0 VN1 37
VFIX 90 98 DC 1
S1   90 91 (50,99) VSY_SWITCH
G1  98 30 POLY(2) (4,6) (11,12) 0 2.5E-5 2.5E-5
M5  45 46 99 99 POX L=2E-6 W=0.98E-3
.MODEL POX PMOS (LEVEL=2,KP=20E-6,VTO=-1,LAMBDA=0.067)
.MODEL PIX PMOS (LEVEL=2,KP=20E-6,VTO=-0.1,LAMBDA=0.01,KF=1E-31)
.MODEL VSY_SWITCH VSWITCH(ROFF=100E3,RON=1,VOFF=-4.2,VON=-3.5)
.ENDS TAUOPA
";
        let deck = format!(
            "Tau buffer\n{vendor}\nX1 in 0 vcc vee out TAUOPA\nV1 in 0 1\nR1 out 0 10k\n.tran 1u 1m\n.end\n"
        );
        assert!(
            deck_lines(&deck).is_ok(),
            "a vendor-style op-amp macromodel was rejected"
        );
    }

    #[test]
    fn bounds_noisy_engine_diagnostics_and_keeps_the_latest_fatal_error() {
        let state = CallbackState::default();
        for index in 0..(MAX_ENGINE_MESSAGES * 3) {
            record_engine_message(&state, format!("stdout warning {index}").as_bytes());
        }
        let oversized = format!("stderr Error: {}", "x".repeat(MAX_ENGINE_MESSAGE_BYTES * 2));
        record_engine_message(&state, oversized.as_bytes());

        let fatal = fatal_engine_messages(&state).expect("latest fatal message must survive");
        assert!(fatal.contains("stderr Error"));

        let messages = take_messages(&state);
        assert!(messages.len() <= MAX_ENGINE_MESSAGES + 1);
        assert!(messages[0].contains("omitted"));
        assert!(messages.last().is_some_and(|message| {
            message.starts_with("stderr Error") && message.len() <= MAX_ENGINE_MESSAGE_BYTES
        }));
    }

    #[test]
    fn uses_the_platform_library_name() {
        let name = PathBuf::from(library_file_name());
        assert!(name.file_name().is_some());
    }

    #[test]
    fn bounded_worker_reader_drains_but_does_not_retain_excess_output() {
        let input = vec![b'x'; 24_000];
        let (output, overflow) = read_bounded(Cursor::new(input), 1024).expect("reader succeeds");
        assert_eq!(output.len(), 1024);
        assert!(overflow);
    }

    #[test]
    fn worker_marker_scan_keeps_the_exact_last_marker_semantics_for_any_bytes() {
        let mut preamble_then_response = b"ngspice startup\xff\n".to_vec();
        preamble_then_response.extend_from_slice(WORKER_RESPONSE_MARKER);
        preamble_then_response.extend_from_slice(br#"{"result":null,"error":"none"}"#);

        let mut repeated_marker = WORKER_RESPONSE_MARKER.to_vec();
        repeated_marker.extend_from_slice(b"first response diagnostic ");
        repeated_marker.extend_from_slice(WORKER_RESPONSE_MARKER);
        repeated_marker.extend_from_slice(b"final response");

        let mut near_match = b"no marker: TAU_SPICE_RESPONSE_V1".to_vec();
        near_match.extend_from_slice(b"!\0\xff");

        for output in [
            Vec::new(),
            preamble_then_response,
            repeated_marker,
            near_match,
        ] {
            let legacy = output
                .windows(WORKER_RESPONSE_MARKER.len())
                .rposition(|window| window == WORKER_RESPONSE_MARKER);
            assert_eq!(
                last_worker_response_marker(&output),
                legacy,
                "marker scan changed protocol framing for {output:?}"
            );
        }
    }

    #[test]
    fn worker_error_response_round_trips_without_an_ambiguous_success() {
        let response = WorkerResponse {
            result: None,
            error: Some("intentional failure".to_string()),
            engine_log: vec!["stderr Error: Timestep too small".to_string()],
        };
        let encoded = serde_json::to_vec(&response).expect("response encodes");
        let decoded: WorkerResponse = serde_json::from_slice(&encoded).expect("response decodes");
        assert!(decoded.result.is_none());
        assert_eq!(decoded.error.as_deref(), Some("intentional failure"));
        assert_eq!(decoded.engine_log, response.engine_log);

        // A payload without the field at all still decodes. The field was
        // added to stop one missing value from destroying a whole response,
        // so it must not become a new way to destroy a whole response.
        let legacy: WorkerResponse =
            serde_json::from_slice(br#"{"result":null,"error":"older worker"}"#)
                .expect("a response without engineLog still decodes");
        assert!(legacy.engine_log.is_empty());
        assert_eq!(legacy.error.as_deref(), Some("older worker"));
    }

    #[test]
    fn streamed_worker_response_is_byte_identical_to_the_existing_protocol() {
        let response = WorkerResponse {
            result: Some(SpiceResult {
                plot: "ac1".to_string(),
                vectors: vec![SpiceVector {
                    name: "v(out)".to_string(),
                    real: vec![0.0, 1.25, -2.5],
                    imaginary: Some(vec![3.0, -4.0, 5.0]),
                }],
                extra_plots: Vec::new(),
                messages: vec!["Warning: exact bytes matter".to_string()],
                library_path: "/tmp/libngspice.dylib".to_string(),
            }),
            error: None,
            engine_log: Vec::new(),
        };
        let payload = serde_json::to_vec(&response).expect("response encodes");
        let mut expected = WORKER_RESPONSE_MARKER.to_vec();
        expected.extend_from_slice(&payload);

        let mut streamed = Vec::new();
        write_worker_response(&mut streamed, &response).expect("streamed response writes");
        assert_eq!(streamed, expected);
    }

    /**
     * The premise the non-finite guard is built on, pinned at the exact layer
     * where it bites, because it is invisible everywhere else.
     *
     * JSON has no spelling for NaN or ±Inf, so `serde_json` writes `null` in
     * their place and the *encode still succeeds*. Nothing in the worker
     * notices. The loss only becomes an error one process later, when the
     * parent tries to read that `null` back into an `f64` — and the error it
     * raises talks about JSON types, not about a circuit that failed to
     * converge. That asymmetry is the whole reason the guard has to live in
     * the worker: the parent cannot tell a diverged solve from a corrupt pipe.
     */
    #[test]
    fn a_non_finite_sample_encodes_as_null_and_then_refuses_to_decode() {
        let vector = SpiceVector {
            name: "v(out)".to_string(),
            real: vec![0.0, 1.5, f64::NAN, f64::INFINITY, f64::NEG_INFINITY],
            imaginary: None,
        };
        let encoded = serde_json::to_vec(&vector).expect("encoding a NaN must NOT fail");
        let text = String::from_utf8(encoded.clone()).expect("payload is UTF-8");
        assert!(
            text.contains("null"),
            "serde_json must have substituted null for the non-finite samples: {text}"
        );

        let error = serde_json::from_slice::<SpiceVector>(&encoded)
            .expect_err("decoding null back into f64 must fail")
            .to_string();
        assert!(
            error.contains("invalid type: null, expected f64"),
            "the decode failure must be the one the parent reports verbatim: {error}"
        );

        // And the same payload nested in a real worker response, which is the
        // shape that actually crosses the process boundary: one NaN anywhere
        // in the vectors discards `messages` as well, so the engine log that
        // would have explained the divergence never reaches the user.
        let response = WorkerResponse {
            result: Some(SpiceResult {
                plot: "tran1".to_string(),
                vectors: vec![SpiceVector {
                    name: "v(out)".to_string(),
                    real: vec![0.0, f64::NAN],
                    imaginary: None,
                }],
                extra_plots: Vec::new(),
                messages: vec!["Warning: Timestep too small".to_string()],
                library_path: String::new(),
            }),
            error: None,
            engine_log: Vec::new(),
        };
        let encoded = serde_json::to_vec(&response).expect("response encodes");
        let error = serde_json::from_slice::<WorkerResponse>(&encoded)
            .expect_err("a NaN anywhere in the result must sink the whole response")
            .to_string();
        assert!(
            error.contains("invalid type: null, expected f64"),
            "{error}"
        );
    }

    fn tran_result(out: Vec<f64>) -> SpiceResult {
        SpiceResult {
            plot: "tran1".to_string(),
            vectors: vec![
                SpiceVector {
                    name: "time".to_string(),
                    real: vec![0.0, 1e-3, 2e-3, 3e-3, 4e-3],
                    imaginary: None,
                },
                SpiceVector {
                    name: "v(out)".to_string(),
                    real: out,
                    imaginary: None,
                },
            ],
            extra_plots: Vec::new(),
            messages: Vec::new(),
            library_path: String::new(),
        }
    }

    /**
     * The fix for the hazard above: the worker names the divergence itself, so
     * the parent never has to guess at a JSON type error, and the refusal it
     * sends in place of the result is a payload that actually survives the hop.
     */
    #[test]
    fn a_diverged_run_is_named_and_refused_instead_of_becoming_a_decode_error() {
        let mut result = tran_result(vec![0.0, 0.4, 0.9, f64::NAN, f64::NAN]);
        result.messages = vec![
            "stdout Circuit: probe".to_string(),
            "stderr Warning: Dynamic gmin stepping failed".to_string(),
            "stderr Error: Timestep too small; cause unrecorded.".to_string(),
        ];

        let error = non_finite_failure(&result).expect("a NaN in a trace must refuse the run");
        // What actually happened, in the terms the engineer is working in.
        assert!(error.contains("did not converge"), "{error}");
        assert!(error.contains("not finite numbers"), "{error}");
        // Named down to the trace, the sample, and the point on the sweep.
        assert!(error.contains("v(out)"), "{error}");
        assert!(error.contains("a NaN"), "{error}");
        assert!(error.contains("sample 4 of 5"), "{error}");
        assert!(error.contains("t = 3e-3 s"), "{error}");
        assert!(error.contains("Affected result vectors: 1 of 2"), "{error}");
        // And it says why no waveform is drawn, so the absence of a plot does
        // not read as Tau having lost the data.
        assert!(error.contains("will not plot"), "{error}");
        // The engine's own diagnosis, which the old path discarded wholesale.
        let carried = with_worker_engine_log(error, &engine_log_tail(&result.messages));
        assert!(carried.contains("Timestep too small"), "{carried}");

        // The refusal the worker sends in place of the result crosses the
        // process boundary intact - which the result itself could not have.
        let response = WorkerResponse {
            result: None,
            error: Some(non_finite_failure(&result).expect("still refused")),
            engine_log: engine_log_tail(&result.messages),
        };
        let encoded = serde_json::to_vec(&response).expect("refusal encodes");
        let decoded: WorkerResponse =
            serde_json::from_slice(&encoded).expect("refusal decodes, unlike the NaN it replaced");
        assert!(decoded.result.is_none());
        assert!(decoded
            .error
            .as_deref()
            .is_some_and(|error| error.contains("v(out)")));
        assert_eq!(decoded.engine_log, result.messages);
    }

    /**
     * The guard must not cost anyone a working run. ngspice saturates
     * behavioural arithmetic at ±1e32 rather than overflowing, and a rail that
     * pegs there is an ordinary - if unhappy - result, not a divergence.
     */
    #[test]
    fn an_ordinary_run_including_ngspices_own_saturated_rail_is_left_alone() {
        let pegged = vec![0.0, -0.0, 1e32, -1e32, f64::MIN_POSITIVE];
        assert_eq!(non_finite_failure(&tran_result(pegged)), None);
        assert_eq!(non_finite_failure(&tran_result(vec![f64::MAX, 0.0])), None);
    }

    /**
     * A `.noise` run answers across two plots and an `.ac` run answers in
     * complex pairs, so a scan that only looked at the current plot's real
     * halves would pass the exact payloads that break the decode.
     */
    #[test]
    fn a_secondary_plot_and_an_imaginary_half_are_both_caught() {
        let mut result = tran_result(vec![0.0, 0.4, 0.9, 1.0, 1.0]);
        result.plot = "ac1".to_string();
        result.vectors[0].name = "frequency".to_string();
        result.vectors[1].imaginary = Some(vec![0.0, 0.0, f64::NEG_INFINITY, 0.0, 0.0]);
        let error = non_finite_failure(&result).expect("an imaginary half counts");
        assert!(error.contains("(imaginary part)"), "{error}");
        assert!(error.contains("-infinity"), "{error}");
        assert!(error.contains("f = 2e-3 Hz"), "{error}");

        let mut clean = tran_result(vec![0.0, 0.4, 0.9, 1.0, 1.0]);
        clean.extra_plots = vec![super::SpicePlot {
            name: "noise1".to_string(),
            vectors: vec![SpiceVector {
                name: "onoise_spectrum".to_string(),
                real: vec![1e-9, f64::INFINITY],
                imaginary: None,
            }],
        }];
        let error = non_finite_failure(&clean).expect("a secondary plot counts");
        assert!(error.contains("onoise_spectrum"), "{error}");
        assert!(error.contains("+infinity"), "{error}");
        // The plot named is the one the bad sample is actually in, and the
        // primary plot's sweep axis is not borrowed to locate it.
        assert!(error.contains("noise1"), "{error}");
        assert!(!error.contains("t = "), "{error}");
    }

    #[test]
    fn a_carried_engine_log_keeps_the_newest_lines_and_admits_what_it_dropped() {
        let messages: Vec<String> = (0..300).map(|index| format!("line {index}")).collect();
        let tail = engine_log_tail(&messages);
        // The bound, plus the one line that accounts for the bound.
        assert_eq!(tail.len(), MAX_ERROR_LOG_MESSAGES + 1);
        assert!(tail[0].contains("300"), "{:?}", tail[0]);
        assert_eq!(tail.last().map(String::as_str), Some("line 299"));
        assert!(!tail.iter().any(|line| line == "line 0"));

        // A log that fits is carried whole, with no note about nothing.
        let short = vec!["only line".to_string()];
        assert_eq!(engine_log_tail(&short), short);
        assert_eq!(
            with_worker_engine_log("Run failed.".to_string(), &short),
            "Run failed. Engine log: only line"
        );
        // No log means no trailing "Engine log:" with nothing behind it.
        assert_eq!(
            with_worker_engine_log("Run failed.".to_string(), &[]),
            "Run failed."
        );
    }

    #[test]
    fn an_engine_without_code_models_names_the_xspice_device_it_cannot_run() {
        let lines = vec![
            "Tau two-bit register".to_string(),
            "VD0 d0 0 DC 5".to_string(),
            "A_a1_adc [d0 clk 0 0] [a1_dd a1_dclk a1_dpre a1_dclr] a1_adc".to_string(),
            ".end".to_string(),
        ];
        let message =
            missing_codemodel_message(&lines, 0).expect("an A device on an engine with no modules");
        assert!(message.contains("A_a1_adc"), "{message}");
        assert!(message.contains("code models"), "{message}");
        // The same deck on an engine that did load its modules is fine, so the
        // message reports the engine build rather than the circuit.
        assert_eq!(
            missing_codemodel_message(&lines, crate::staged_engine::REQUIRED_CODEMODELS.len()),
            None
        );
    }

    #[test]
    fn an_analog_deck_is_not_refused_for_missing_code_models() {
        // The modules only matter to A devices. A deck title is free text and
        // is the one line that can start with an A without being a device, so
        // a title like this one would refuse an entirely analog circuit.
        let lines = vec![
            "Amplifier bias point".to_string(),
            "V1 in 0 5".to_string(),
            "R1 in 0 1k".to_string(),
            ".op".to_string(),
            ".end".to_string(),
        ];
        assert_eq!(missing_codemodel_message(&lines, 0), None);
    }

    /**
     * The guard's cost, measured against the real engine rather than against
     * hand-built vectors: every analysis Tau routinely runs has to pass
     * through it untouched. A refusal that fires on a healthy solve would be
     * far worse than the decode failure it replaces, because that failure at
     * least only struck runs that were already lost.
     *
     * These decks also stand as the record of what the engine does with
     * arithmetic that has no finite answer. ngspice saturates rather than
     * overflowing - the divide-by-zero deck below returns ±1e32, not an
     * infinity - which is why no live reproduction of the decode failure
     * exists and why `non_finite_failure` is written as a boundary guard
     * instead of as a handler for a known circuit.
     */
    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn the_non_finite_guard_passes_every_healthy_analysis_the_real_engine_produces() {
        let _guard = real_engine_test_guard();
        let library = std::env::var_os("TAU_NGSPICE_LIB")
            .map(PathBuf::from)
            .expect("TAU_NGSPICE_LIB must point to a shared ngspice library");
        let decks = [
            ("op", "Tau op\nV1 in 0 5\nR1 in out 1k\nR2 out 0 1k\n.op\n.end"),
            (
                "tran",
                "Tau tran\nV1 in 0 PULSE(0 5 0 1u 1u 1m 2m)\nR1 in out 1k\nC1 out 0 1u\n.tran 10u 4m\n.end",
            ),
            (
                "ac",
                "Tau ac\nV1 in 0 AC 1\nR1 in out 1k\nC1 out 0 1u\n.ac dec 20 1 100k\n.end",
            ),
            (
                "dc",
                "Tau dc\nV1 in 0 0\nR1 in out 1k\nR2 out 0 1k\n.dc V1 0 5 0.1\n.end",
            ),
            (
                "noise",
                "Tau noise\nV1 in 0 AC 1\nR1 in out 10k\nC1 out 0 10n\n.noise V(out) V1 dec 10 1 1meg\n.end",
            ),
            // Arithmetic with no finite answer, reached three different ways.
            // All three come back saturated, so all three must be accepted.
            (
                "divide by zero",
                "Tau divzero\nV1 in 0 0\nB1 out 0 V=1/V(in)\nR1 out 0 1k\n.tran 1u 10u\n.end",
            ),
            (
                "log of zero",
                "Tau logzero\nV1 in 0 0\nB1 out 0 V=ln(V(in))\nR1 out 0 1k\n.op\n.end",
            ),
            (
                "unstable laplace pole",
                "Tau rhp\nV1 in 0 PULSE(0 1 1n 1n 1n 1 2)\nA1 in out xfer\n.model xfer s_xfer(num_coeff=[1] den_coeff=[-1e6 1] int_ic=[0] denormalized_freq=1)\nR1 out 0 1k\n.tran 1u 1m\n.end",
            ),
        ];
        for (label, netlist) in decks {
            let mut engine = SpiceEngine::load(vec![library.clone()]).expect("library loads");
            let result = engine
                .run(SpiceRequest {
                    netlist: netlist.to_string(),
                })
                .unwrap_or_else(|error| panic!("{label} should solve: {error}"));
            assert!(
                !result.vectors.is_empty(),
                "{label} produced no vectors at all"
            );
            assert_eq!(
                non_finite_failure(&result),
                None,
                "{label} was refused by the non-finite guard"
            );
        }
    }

    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn runs_an_operating_point_with_the_real_ngspice_library() {
        let _guard = real_engine_test_guard();
        let library = std::env::var_os("TAU_NGSPICE_LIB")
            .map(PathBuf::from)
            .expect("TAU_NGSPICE_LIB must point to a shared ngspice library");
        let mut engine = SpiceEngine::load(vec![library]).expect("ngspice library should load");
        let result = engine
            .run(SpiceRequest {
                netlist: "Tau FFI smoke test\nV1 in 0 5\nR1 in 0 1k\n.op\n.end".to_string(),
            })
            .expect("operating point should solve");
        let voltage = result
            .vectors
            .iter()
            .find(|vector| vector.name.eq_ignore_ascii_case("in"))
            .and_then(|vector| vector.real.first())
            .copied();
        assert_eq!(
            voltage,
            Some(5.0),
            "vectors: {:?}; messages: {:?}",
            result
                .vectors
                .iter()
                .map(|vector| &vector.name)
                .collect::<Vec<_>>(),
            result.messages,
        );

        let second = engine
            .run(SpiceRequest {
                netlist: "Tau second run\nV1 in 0 2\nR1 in 0 1k\n.op\n.end".to_string(),
            })
            .expect("a second circuit should replace the first one");
        let second_voltage = second
            .vectors
            .iter()
            .find(|vector| vector.name.eq_ignore_ascii_case("in"))
            .and_then(|vector| vector.real.first())
            .copied();
        assert_eq!(second_voltage, Some(2.0));

        let mosfet = engine
            .run(SpiceRequest {
                netlist: "Tau MOSFET smoke test\n.model TAU_NMOS NMOS(Level=1 Vto=1 Kp=200u Lambda=0.02)\nVDD drain 0 5\nVG gate 0 5\nM1 drain gate 0 0 TAU_NMOS\nR1 drain 0 10k\n.op\n.end".to_string(),
            })
            .expect("generic MOSFET model should solve");
        assert!(mosfet
            .vectors
            .iter()
            .any(|vector| vector.name.eq_ignore_ascii_case("drain")));

        let transient = engine
            .run(SpiceRequest {
                netlist: "Tau transient smoke test\nV1 in 0 SIN(0 1 1k)\nR1 in out 1k\nC1 out 0 1u\n.tran 10u 1m\n.end".to_string(),
            })
            .expect("transient analysis should solve");
        assert!(transient
            .vectors
            .iter()
            .any(|vector| { vector.name.eq_ignore_ascii_case("time") && vector.real.len() > 10 }));

        // AC analysis is the only path whose vectors come back COMPLEX, so it is
        // the only one that exercises the `complex_data` branch of the vector
        // read. R=1k with C=159.1549n puts the pole at 1 kHz, and a `dec 10`
        // sweep from 100 Hz lands on it exactly at index 10, so the phasor is
        // known in closed form at two indices rather than only in shape:
        // H(jw) = 1/(1+jx) with x = w*R*C, giving 0.5 - 0.5j at the pole and
        // 0.009901 - 0.09901j a decade above it.
        let ac = engine
            .run(SpiceRequest {
                netlist: "Tau AC smoke test\nV1 in 0 AC 1\nR1 in out 1k\nC1 out 0 159.1549n\n.ac dec 10 100 10k\n.end".to_string(),
            })
            .expect("AC analysis should solve");
        let frequency = ac
            .vectors
            .iter()
            .find(|vector| vector.name.eq_ignore_ascii_case("frequency"))
            .expect("AC run reports a frequency scale");
        assert_eq!(frequency.real.len(), 21);
        // ngspice types the scale itself complex, with a zero imaginary part -
        // the axis is its real part, so a reader taking the magnitude or the
        // imaginary half would silently plot against nothing.
        assert!((frequency.real[10] - 1000.0).abs() < 1e-6);
        assert!((frequency.real[20] - 10_000.0).abs() < 1e-3);
        if let Some(imaginary) = &frequency.imaginary {
            assert!(imaginary.iter().all(|value| *value == 0.0));
        }

        let out = ac
            .vectors
            .iter()
            .find(|vector| vector.name.eq_ignore_ascii_case("out"))
            .expect("AC run reports the output node");
        let out_imaginary = out
            .imaginary
            .as_ref()
            .expect("an AC node vector carries an imaginary part");
        assert_eq!(out.real.len(), 21);
        assert_eq!(out_imaginary.len(), 21);
        // At the pole the two parts are equal in magnitude, which pins the sign
        // convention (the low-pass lags, so the imaginary part is negative) but
        // not the pairing. A decade above, the imaginary part is ten times the
        // real one, so a swapped pair or a mis-strided read of the interleaved
        // complex array cannot pass both.
        assert!(
            (out.real[10] - 0.5).abs() < 1e-4,
            "real at pole: {}",
            out.real[10]
        );
        assert!(
            (out_imaginary[10] + 0.5).abs() < 1e-4,
            "imaginary at pole: {}",
            out_imaginary[10]
        );
        assert!(
            (out.real[20] - 0.009_901).abs() < 1e-5,
            "real a decade above the pole: {}",
            out.real[20]
        );
        assert!(
            (out_imaginary[20] + 0.099_010).abs() < 1e-5,
            "imaginary a decade above the pole: {}",
            out_imaginary[20]
        );

        // Common-emitter BJT bias point: with VCC=12, RC=4.7k, base fed through
        // RB=100k from a 0.8 V supply, the generic NPN sits in the active region
        // so the collector stays well below the rail and the base near a diode drop.
        let bjt = engine
            .run(SpiceRequest {
                netlist: "Tau BJT bias\n.model TAU_NPN NPN(Is=1e-14 Bf=100 Vaf=100)\nVCC vcc 0 12\nVBB vbb 0 0.8\nRC vcc coll 4.7k\nRB vbb base 100k\nQ1 coll base 0 TAU_NPN\n.op\n.end".to_string(),
            })
            .expect("BJT bias point should solve");
        let collector = bjt
            .vectors
            .iter()
            .find(|vector| vector.name.eq_ignore_ascii_case("coll"))
            .and_then(|vector| vector.real.first())
            .copied()
            .expect("collector node present");
        assert!(
            collector > 0.0 && collector < 12.0,
            "collector should sit inside the rails, got {collector}"
        );

        // Half-wave rectifier: the diode passes the positive half of a 5 V swing
        // to the 1k load, so the load node must reach a few volts at its peak.
        let rectifier = engine
            .run(SpiceRequest {
                netlist: "Tau rectifier\n.model TAU_DIODE D(Is=1e-14 N=1)\nV1 in 0 SIN(0 5 1k)\nD1 in out TAU_DIODE\nRL out 0 1k\n.tran 10u 2m\n.end".to_string(),
            })
            .expect("rectifier transient should solve");
        let load_peak = rectifier
            .vectors
            .iter()
            .find(|vector| vector.name.eq_ignore_ascii_case("out"))
            .map(|vector| vector.real.iter().cloned().fold(f64::MIN, f64::max))
            .expect("load node present");
        assert!(
            load_peak > 3.0,
            "rectified output should peak above 3 V, got {load_peak}"
        );
        let load_min = rectifier
            .vectors
            .iter()
            .find(|vector| vector.name.eq_ignore_ascii_case("out"))
            .map(|vector| vector.real.iter().cloned().fold(f64::MAX, f64::min))
            .expect("load node present");
        assert!(
            load_min > -0.5,
            "rectifier should block the negative half-cycle, got {load_min}"
        );
    }

    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn runs_a_current_controlled_switch_with_the_real_ngspice_library() {
        let _guard = real_engine_test_guard();
        let library = std::env::var_os("TAU_NGSPICE_LIB")
            .map(PathBuf::from)
            .expect("TAU_NGSPICE_LIB must point to a shared ngspice library");
        let mut engine = SpiceEngine::load(vec![library]).expect("ngspice library should load");

        let output_for = |engine: &mut SpiceEngine, control: &str| {
            let result = engine
                .run(SpiceRequest {
                    netlist: format!(
                        "Tau W-device proof\n.model MYSW CSW(Ron=1 Roff=1Meg It=.5m Ih=0)\nVload in 0 5\nW1 in out Vsense MYSW\nRload out 0 1k\nIctl 0 sense {control}\nVsense sense 0 0\n.op\n.end"
                    ),
                })
                .expect("the current-controlled switch should solve");
            result
                .vectors
                .iter()
                .find(|vector| vector.name.eq_ignore_ascii_case("out"))
                .and_then(|vector| vector.real.first())
                .copied()
                .unwrap_or_else(|| panic!("out vector missing; messages: {:?}", result.messages))
        };

        let on = output_for(&mut engine, "1m");
        let off = output_for(&mut engine, ".1m");
        assert!(on > 4.99, "on-state output was {on}");
        assert!(off > 0.0 && off < 0.01, "off-state output was {off}");
        assert!(on / off > 900.0, "on/off ratio was {}", on / off);
    }

    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn mixed_jfet_operating_point_vectors_do_not_crash_the_native_boundary() {
        let _guard = real_engine_test_guard();
        let library = std::env::var_os("TAU_NGSPICE_LIB")
            .map(PathBuf::from)
            .expect("TAU_NGSPICE_LIB must point to a shared ngspice library");
        let mut engine = SpiceEngine::load(vec![library]).expect("ngspice library should load");
        let result = engine
            .run(SpiceRequest {
                netlist: r#"Tau JFET operating-point vectors
.model J NJF(Is=.25p Vto=-1.5 Beta=3m Lambda=10m)
VDD drain 0 10
J1 drain gate 0 J
R1 gate 0 100k
.save all @j1[id] @j1[vgs] @j1[vds] @j1[vdsat] @j1[gm] @j1[gds]
.op
.end"#
                    .to_string(),
            })
            .expect("mixed JFET vectors should solve without entering the unused streaming callback path");
        assert!(!result.vectors.is_empty());
    }

    /** Exact assistant 2-bit register regression: ngspice XSPICE d_dff
     * controls are active-high, so PRE/CLR are held at zero. On clock rising
     * edges at 1/3/5 ms the two outputs must sample 01, 11, 10.
     *
     * Split out of the vector-read test above because it is the only case that
     * needs the `.cm` code-model modules staged beside the library. A build
     * without them fails here and nowhere else, so keeping the two together
     * meant one incomplete engine build hid every FFI assertion in the same
     * function. This test is the one that reports that state. */
    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice with its code models"]
    fn runs_a_digital_register_with_the_real_ngspice_code_models() {
        let _guard = real_engine_test_guard();
        let library = std::env::var_os("TAU_NGSPICE_LIB")
            .map(PathBuf::from)
            .expect("TAU_NGSPICE_LIB must point to a shared ngspice library");
        let mut engine = SpiceEngine::load(vec![library]).expect("ngspice library should load");
        assert!(
            engine.codemodels_loaded > 0,
            "this library staged no XSPICE code models, so no A device can run against it"
        );
        let register = engine
            .run(SpiceRequest {
                netlist: r#"Tau two-bit register
VD0 d0 0 DC 5 PWL(0 5 4m 5 4.001m 0 6m 0)
VD1 d1 0 DC 0 PWL(0 0 2m 0 2.001m 5 6m 5)
VCLK clk 0 DC 0 PULSE(0 5 1m 1n 1n .5m 2m)
.model a1_adc adc_bridge(in_low=2.5 in_high=2.5)
A_a1_adc [d0 clk 0 0] [a1_dd a1_dclk a1_dpre a1_dclr] a1_adc
.model a1_dff d_dff(ic=0 clk_delay=1n set_delay=1n reset_delay=1n rise_delay=1n fall_delay=1n)
A_a1 a1_dd a1_dclk a1_dpre a1_dclr a1_dq a1_dnq a1_dff
.model a1_dac dac_bridge(out_low=0 out_high=5)
A_a1_dac [a1_dq a1_dnq] [q0 q0bar] a1_dac
.model a2_adc adc_bridge(in_low=2.5 in_high=2.5)
A_a2_adc [d1 clk 0 0] [a2_dd a2_dclk a2_dpre a2_dclr] a2_adc
.model a2_dff d_dff(ic=0 clk_delay=1n set_delay=1n reset_delay=1n rise_delay=1n fall_delay=1n)
A_a2 a2_dd a2_dclk a2_dpre a2_dclr a2_dq a2_dnq a2_dff
.model a2_dac dac_bridge(out_low=0 out_high=5)
A_a2_dac [a2_dq a2_dnq] [q1 q1bar] a2_dac
.tran 1u 6m
.end"#
                    .to_string(),
            })
            .expect("two-bit register transient should solve");
        let times = register
            .vectors
            .iter()
            .find(|vector| vector.name.eq_ignore_ascii_case("time"))
            .expect("register time vector present");
        let value_near = |name: &str, target: f64| {
            let values = register
                .vectors
                .iter()
                .find(|vector| vector.name.eq_ignore_ascii_case(name))
                .unwrap_or_else(|| {
                    panic!(
                        "register vector {name} present; got {:?}; messages {:?}",
                        register
                            .vectors
                            .iter()
                            .map(|vector| &vector.name)
                            .collect::<Vec<_>>(),
                        register.messages
                    )
                });
            let index = times
                .real
                .iter()
                .enumerate()
                .min_by(|(_, a), (_, b)| {
                    (*a - target)
                        .abs()
                        .partial_cmp(&(*b - target).abs())
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
                .map(|(index, _)| index)
                .expect("register has time samples");
            values.real[index]
        };
        assert!(value_near("q0", 0.0011) > 4.0 && value_near("q1", 0.0011) < 1.0);
        assert!(value_near("q0", 0.0031) > 4.0 && value_near("q1", 0.0031) > 4.0);
        assert!(value_near("q0", 0.0051) < 1.0 && value_near("q1", 0.0051) > 4.0);
    }

    /** The menu-first Class-D driver uses two asymmetric XSPICE event buffers:
     * both gate voltages follow PWM, but the turn-on edge is delayed while the
     * opposite device's turn-off edge is immediate. Prove the one shared
     * bundled source against the embedded-library API on bipolar and unipolar
     * rails, including an adjusted dead-time value and zero command overlap. */
    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice with its code models"]
    fn runs_the_bundled_deadtime_driver_with_accurate_nonoverlap() {
        let _guard = real_engine_test_guard();
        let library = std::env::var_os("TAU_NGSPICE_LIB")
            .map(PathBuf::from)
            .expect("TAU_NGSPICE_LIB must point to a shared ngspice library");
        let mut engine = SpiceEngine::load(vec![library]).expect("ngspice library should load");
        let block = include_str!("../../src/engine/bundled/tau_deadtime_driver.sub");

        let prove = |engine: &mut SpiceEngine, low: f64, high: f64, dead: f64| {
            let result = engine
                .run(SpiceRequest {
                    netlist: format!(
                        "Tau dead-time driver native proof\n\
                         VCC vcc 0 {high}\n\
                         VEE vee 0 {low}\n\
                         VPWM pwm 0 PULSE({low} {high} 1u 1n 1n 2u 4u)\n\
                         {block}\n\
                         XDRV vcc vee pwm gp gn TauDeadtimeDriver dead={dead} threshold=.5 hysteresis=.02 transition=10n rout=5\n\
                         Cgp gp 0 10p\nCgn gn 0 10p\nRgp gp 0 1G\nRgn gn 0 1G\n\
                         .tran 1n 6u\n.end"
                    ),
                })
                .expect("bundled dead-time driver transient should solve");
            let vector = |name: &str| {
                result
                    .vectors
                    .iter()
                    .find(|vector| vector.name.eq_ignore_ascii_case(name))
                    .unwrap_or_else(|| panic!("{name} missing; messages: {:?}", result.messages))
            };
            let time = &vector("time").real;
            let gp = &vector("gp").real;
            let gn = &vector("gn").real;
            let level = (low + high) / 2.0;
            let crossing = |values: &[f64], rising: bool, after: f64| {
                (1..time.len())
                    .find_map(|index| {
                        if time[index] < after {
                            return None;
                        }
                        let crossed = if rising {
                            values[index - 1] < level && values[index] >= level
                        } else {
                            values[index - 1] > level && values[index] <= level
                        };
                        if !crossed {
                            return None;
                        }
                        let fraction =
                            (level - values[index - 1]) / (values[index] - values[index - 1]);
                        Some(time[index - 1] + fraction * (time[index] - time[index - 1]))
                    })
                    .expect("gate threshold crossing should exist")
            };
            let gp_rise = crossing(gp, true, 0.5e-6);
            let gn_rise = crossing(gn, true, 0.5e-6);
            let gn_fall = crossing(gn, false, 2.5e-6);
            let gp_fall = crossing(gp, false, 2.5e-6);
            let tolerance = 2e-9;
            assert!(
                ((gn_rise - gp_rise) - dead).abs() <= tolerance,
                "rising non-overlap was {} s, requested {dead} s",
                gn_rise - gp_rise
            );
            assert!(
                ((gp_fall - gn_fall) - dead).abs() <= tolerance,
                "falling non-overlap was {} s, requested {dead} s",
                gp_fall - gn_fall
            );
            assert!(
                gp.iter()
                    .zip(gn)
                    .all(|(gp_value, gn_value)| !(*gp_value < level && *gn_value > level)),
                "PMOS-on and NMOS-on commands overlapped"
            );
        };

        prove(&mut engine, -10.0, 10.0, 200e-9);
        prove(&mut engine, 0.0, 5.0, 400e-9);
    }

    /** Tau's LTspice vendor-library adapter relies on the patched OTA current
     * limit in analog.cm and on xtradev's LTspice-equivalent simple diode. A
     * real bundled-engine run proves both model types load and that the OTA
     * reaches Iout*tanh(gm*Vin/Iout), rather than the old unbounded gm*Vin. */
    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice with its code models"]
    fn runs_ltspice_ota_and_ideal_diode_compatibility_models() {
        let _guard = real_engine_test_guard();
        let library = std::env::var_os("TAU_NGSPICE_LIB")
            .map(PathBuf::from)
            .expect("TAU_NGSPICE_LIB must point to a shared ngspice library");
        let mut engine = SpiceEngine::load(vec![library]).expect("ngspice library should load");
        let result = engine
            .run(SpiceRequest {
                netlist: r#"Tau LTspice compatibility code models
Vin in 0 1
.model tau_ota ota(gm=1 iout=10m rout=1e308 rin=1e308)
Aota in 0 ota_sink tau_ota
Vsense ota_sink 0 0
Fout out 0 Vsense 1
Rout out 0 1k
Vdiode supply 0 1
Rdiode supply diode 100
Adiode diode 0 tau_diode
.model tau_diode sidiode(ron=10 roff=1T vfwd=.8 epsilon=.1)
.op
.end"#
                    .to_string(),
            })
            .expect("patched OTA and simple diode should solve");
        let value = |name: &str| {
            result
                .vectors
                .iter()
                .find(|vector| vector.name.eq_ignore_ascii_case(name))
                .and_then(|vector| vector.real.first())
                .copied()
                .unwrap_or_else(|| panic!("{name} missing; messages: {:?}", result.messages))
        };
        assert!(
            (9.9..10.1).contains(&value("out")),
            "OTA output should be limited to 10 mA into 1 kOhm; got {} V",
            value("out")
        );
        assert!(
            (0.80..0.90).contains(&value("diode")),
            "LTspice-style Ron/Vfwd diode should conduct near its 0.8 V knee; got {} V",
            value("diode")
        );
    }

    /** LTspice `linear` is Io = gm*Vin with no tanh Iout. Omitting iout must
     * stay on that unbounded path — never silently pick up the 10u default. */
    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice with its code models"]
    fn runs_ltspice_ota_linear_unbounded_transfer() {
        let _guard = real_engine_test_guard();
        let library = std::env::var_os("TAU_NGSPICE_LIB")
            .map(PathBuf::from)
            .expect("TAU_NGSPICE_LIB must point to a shared ngspice library");
        let mut engine = SpiceEngine::load(vec![library]).expect("ngspice library should load");
        let result = engine
            .run(SpiceRequest {
                netlist: r#"Tau linear OTA (no Iout)
Vin in 0 50m
.model tau_ota ota(gm=1 rout=1e308 rin=1e308)
Aota in 0 ota_sink tau_ota
Vsense ota_sink 0 0
Fout out 0 Vsense 1
Rout out 0 1k
.op
.end"#
                    .to_string(),
            })
            .expect("unbounded linear OTA should solve");
        let out = result
            .vectors
            .iter()
            .find(|vector| vector.name.eq_ignore_ascii_case("out"))
            .and_then(|vector| vector.real.first())
            .copied()
            .unwrap_or_else(|| panic!("out missing; messages: {:?}", result.messages));
        // gm*Vin*Rout = 1*0.05*1k = 50 V. tanh with iout=10m would clip near 10 V.
        assert!(
            (49.0..51.0).contains(&out),
            "linear OTA should be unbounded gm*Vin into 1k (≈50 V); got {} V",
            out
        );
    }

    /** Finite-V OTA compliance: outside [Vlow,Vhigh], Rout is swapped for
     * Rclamp-to-rail on V(out,common). Io*Rclamp above the high rail. */
    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice with its code models"]
    fn runs_ltspice_ota_finite_v_rclamp_compliance() {
        let _guard = real_engine_test_guard();
        let library = std::env::var_os("TAU_NGSPICE_LIB")
            .map(PathBuf::from)
            .expect("TAU_NGSPICE_LIB must point to a shared ngspice library");
        let mut engine = SpiceEngine::load(vec![library]).expect("ngspice library should load");
        let result = engine
            .run(SpiceRequest {
                // gm*Vin = 10mA into the compliance B-load. Above Vhigh=0.5 with
                // Rclamp=1: V = 0.5 + 0.01 = 0.51. Unclamped into 1k would be 10 V.
                netlist: r#"Tau finite-V OTA compliance
Vin in 0 10m
.model tau_ota ota(gm=1 rout=1e308 rin=1e308)
Aota in 0 ota_sink tau_ota
Vsense ota_sink 0 0
Fout out 0 Vsense 1
Bcomp out 0 I={(V(out,0))>(0.5) ? ((V(out,0))-(0.5))/(1) : (V(out,0))<(-0.5) ? ((V(out,0))-(-0.5))/(1) : (V(out,0))/(1k)}
.op
.end"#
                    .to_string(),
            })
            .expect("finite-V OTA compliance should solve");
        let out = result
            .vectors
            .iter()
            .find(|vector| vector.name.eq_ignore_ascii_case("out"))
            .and_then(|vector| vector.real.first())
            .copied()
            .unwrap_or_else(|| panic!("out missing; messages: {:?}", result.messages));
        assert!(
            (0.505..0.515).contains(&out),
            "finite-V clamp should sit at Vhigh+Io*Rclamp (≈0.51 V); got {} V",
            out
        );
    }

    /** Asymmetric Isource/Isink must follow LTspice's split tanh limits — not
     * the larger of the two, and not a silent symmetric Iout substitution. */
    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice with its code models"]
    fn runs_ltspice_ota_asymmetric_isource_isink_limits() {
        let _guard = real_engine_test_guard();
        let library = std::env::var_os("TAU_NGSPICE_LIB")
            .map(PathBuf::from)
            .expect("TAU_NGSPICE_LIB must point to a shared ngspice library");
        let mut engine = SpiceEngine::load(vec![library]).expect("ngspice library should load");
        let mut run = |vin: f64| {
            engine
                .run(SpiceRequest {
                    netlist: format!(
                        r#"Tau asymmetric OTA
Vin in 0 {vin}
.model tau_ota ota(gm=1 isource=10m isink=-4m rout=1e308 rin=1e308)
Aota in 0 ota_sink tau_ota
Vsense ota_sink 0 0
Fout out 0 Vsense 1
Rout out 0 1k
.op
.end"#
                    ),
                })
                .expect("asymmetric OTA should solve")
        };
        let pos = run(1.0);
        let pos_out = pos
            .vectors
            .iter()
            .find(|vector| vector.name.eq_ignore_ascii_case("out"))
            .and_then(|vector| vector.real.first())
            .copied()
            .unwrap_or_else(|| panic!("out missing; messages: {:?}", pos.messages));
        assert!(
            (9.9..10.1).contains(&pos_out),
            "positive side should limit at Isource=10m into 1k; got {} V",
            pos_out
        );
        let neg = run(-1.0);
        let neg_out = neg
            .vectors
            .iter()
            .find(|vector| vector.name.eq_ignore_ascii_case("out"))
            .and_then(|vector| vector.real.first())
            .copied()
            .unwrap_or_else(|| panic!("out missing; messages: {:?}", neg.messages));
        assert!(
            (-4.1..-3.9).contains(&neg_out),
            "negative side should limit at |Isink|=4m into 1k; got {} V",
            neg_out
        );
    }

    /** Four-quadrant OTA: effective Vin = Vdiff · V(mul). Linear unbounded
     * path must multiply, not silently ignore the mul port (which would
     * under-read by the mul factor). */
    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice with its code models"]
    fn runs_ltspice_ota_four_quadrant_linear_product() {
        let _guard = real_engine_test_guard();
        let library = std::env::var_os("TAU_NGSPICE_LIB")
            .map(PathBuf::from)
            .expect("TAU_NGSPICE_LIB must point to a shared ngspice library");
        let mut engine = SpiceEngine::load(vec![library]).expect("ngspice library should load");
        let result = engine
            .run(SpiceRequest {
                // gm=1 · Vin=50m · Vmul=2 → 100 mA into 1 kΩ → 100 V.
                // Dropping the mul port would yield only 50 V.
                netlist: r#"Tau four-quadrant linear OTA
Vin in 0 50m
Vmul m 0 2
.model tau_ota ota(gm=1 rout=1e308 rin=1e308)
Bveff veff 0 V={(V(in)-V(0))*V(m,0)}
Aota veff 0 ota_sink tau_ota
Vsense ota_sink 0 0
Fout out 0 Vsense 1
Rout out 0 1k
.op
.end"#
                    .to_string(),
            })
            .expect("four-quadrant linear OTA should solve");
        let out = result
            .vectors
            .iter()
            .find(|vector| vector.name.eq_ignore_ascii_case("out"))
            .and_then(|vector| vector.real.first())
            .copied()
            .unwrap_or_else(|| panic!("out missing; messages: {:?}", result.messages));
        assert!(
            (99.0..101.0).contains(&out),
            "four-quadrant product should be gm*Vin*Vmul into 1k (≈100 V); got {} V",
            out
        );
    }

    /** A library with no `.cm` modules beside it is exactly the state Tau's
     * own bundled resource is in, and the state the diagnosis exists for. It
     * is reached here by loading the real library through a directory that has
     * no code-model sibling, so the case does not depend on which library
     * TAU_NGSPICE_LIB names, nor on what an earlier run left behind in the
     * staging directory every Tau process shares. */
    #[test]
    #[cfg(unix)]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn refuses_an_xspice_device_on_a_library_that_staged_no_code_models() {
        let _guard = real_engine_test_guard();
        let library = std::env::var_os("TAU_NGSPICE_LIB")
            .map(PathBuf::from)
            .expect("TAU_NGSPICE_LIB must point to a shared ngspice library");
        let bare = std::env::temp_dir().join(format!("tau-no-codemodels-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&bare);
        std::fs::create_dir_all(&bare).expect("a directory for a library without its modules");
        let link = bare.join(library.file_name().expect("the library has a file name"));
        std::os::unix::fs::symlink(&library, &link).expect("link the library into it");

        let mut engine = SpiceEngine::load(vec![link]).expect("ngspice library should load");
        assert_eq!(
            engine.codemodels_loaded, 0,
            "no code models sit beside the linked library"
        );
        let error = engine
            .run(SpiceRequest {
                netlist: "Tau register\nVCLK clk 0 DC 0\n.model a1_adc adc_bridge(in_low=2.5 in_high=2.5)\nA_a1_adc [clk 0 0 0] [a1_dd a1_dclk a1_dpre a1_dclr] a1_adc\n.tran 1u 10u\n.end".to_string(),
            })
            .expect_err("an A device cannot run on an engine with no code models");
        assert!(error.contains("A_a1_adc"), "{error}");
        assert!(error.contains("code models"), "{error}");
        // The deck never reached ngspice, so what the user sees is Tau's
        // account of its own engine build rather than the MIF error, which
        // names neither the missing module nor the fix.
        assert!(!error.contains("MIF"), "{error}");
        let _ = std::fs::remove_dir_all(&bare);
    }

    /** A noise run splits its answer across two plots and leaves the integrated
     * totals current, so the spectral density curves are only reachable through
     * extra_plots. Two 10k resistors put 5k across the output, whose thermal
     * noise is sqrt(4kTR) = 9.1 nV/sqrt(Hz), flat over the sweep, and the total
     * over the 1 Hz - 1 MHz band is that density times sqrt(bandwidth). */
    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn returns_both_plots_of_a_real_noise_run() {
        let _guard = real_engine_test_guard();
        let library = std::env::var_os("TAU_NGSPICE_LIB")
            .map(PathBuf::from)
            .expect("TAU_NGSPICE_LIB must point to a shared ngspice library");
        let mut engine = SpiceEngine::load(vec![library]).expect("ngspice library should load");
        let noise = engine
            .run(SpiceRequest {
                netlist: "Tau noise\nV1 in 0 DC 0 AC 1\nR1 in out 10k\nR2 out 0 10k\n.noise v(out) V1 dec 10 1 1Meg\n.end".to_string(),
            })
            .expect("noise analysis should solve");
        let total = noise
            .vectors
            .iter()
            .find(|vector| vector.name.eq_ignore_ascii_case("onoise_total"))
            .and_then(|vector| vector.real.first())
            .copied()
            .expect("integrated total is the current plot");
        assert!(
            !noise
                .vectors
                .iter()
                .any(|vector| vector.name.eq_ignore_ascii_case("onoise_spectrum")),
            "the spectrum does not live in the current plot, so extra_plots is the only route to it"
        );
        let spectrum = noise
            .extra_plots
            .iter()
            .find(|plot| {
                plot.vectors
                    .iter()
                    .any(|vector| vector.name.eq_ignore_ascii_case("onoise_spectrum"))
            })
            .unwrap_or_else(|| {
                panic!(
                    "spectral density plot present; got {:?}; messages {:?}",
                    noise
                        .extra_plots
                        .iter()
                        .map(|plot| &plot.name)
                        .collect::<Vec<_>>(),
                    noise.messages
                )
            });
        assert_ne!(
            spectrum.name, noise.plot,
            "extra plots exclude the current one"
        );
        let frequency = spectrum
            .vectors
            .iter()
            .find(|vector| vector.name.eq_ignore_ascii_case("frequency"))
            .expect("spectrum carries its own frequency scale");
        assert!(
            frequency.real.len() > 50,
            "a 6-decade sweep at 10 points per decade should have 61 points, got {}",
            frequency.real.len()
        );
        let density = spectrum
            .vectors
            .iter()
            .find(|vector| vector.name.eq_ignore_ascii_case("onoise_spectrum"))
            .expect("output spectral density present");
        assert_eq!(density.real.len(), frequency.real.len());
        for value in [
            density.real[0],
            density.real[density.real.len() / 2],
            density.real[density.real.len() - 1],
        ] {
            assert!(
                (8.5e-9..9.7e-9).contains(&value),
                "resistor thermal noise should be flat at about 9.1 nV/sqrt(Hz), got {value}"
            );
        }
        let expected_total = density.real[0] * frequency.real[frequency.real.len() - 1].sqrt();
        assert!(
            (total / expected_total - 1.0).abs() < 0.05,
            "integrated total {total} should match the density integrated over the band, {expected_total}"
        );

        // ngspice keeps every plot it has ever made, so a later run on the same
        // engine must not inherit this one's. An operating point makes exactly
        // one plot and has no secondary result at all.
        let op = engine
            .run(SpiceRequest {
                netlist: "Tau op after noise\nV1 in 0 5\nR1 in 0 1k\n.op\n.end".to_string(),
            })
            .expect("operating point after a noise run should solve");
        assert!(
            op.extra_plots.is_empty(),
            "a later run must not report the previous run's plots, got {:?}",
            op.extra_plots
                .iter()
                .map(|plot| &plot.name)
                .collect::<Vec<_>>()
        );
    }

    /** Stock ngspice rejects `.step`; Tau expands `.step temp` into multi-run
     * plots. A 1k/1k divider with R1 tc1=0.01 must read 0.5 V at 27 °C and
     * 0.4 V at 77 °C (R1→1.5k). */
    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn expands_step_temp_into_ordered_extra_plots() {
        let _guard = real_engine_test_guard();
        let library = std::env::var_os("TAU_NGSPICE_LIB")
            .map(PathBuf::from)
            .expect("TAU_NGSPICE_LIB must point to a shared ngspice library");
        let mut engine = SpiceEngine::load(vec![library]).expect("ngspice library should load");
        let result = engine
            .run(SpiceRequest {
                netlist: r#"Tau step temp
V1 in 0 1
R1 in out 1k tc1=0.01
R2 out 0 1k
.op
.step temp 27 77 50
.end"#
                    .to_string(),
            })
            .expect(".step temp should expand and solve");
        assert_eq!(
            result.extra_plots.len(),
            1,
            "two temps → one extra + current; got extras {:?}",
            result
                .extra_plots
                .iter()
                .map(|p| &p.name)
                .collect::<Vec<_>>()
        );
        let vout_at = |vectors: &[super::SpiceVector]| {
            vectors
                .iter()
                .find(|v| {
                    v.name.eq_ignore_ascii_case("out") || v.name.eq_ignore_ascii_case("v(out)")
                })
                .and_then(|v| v.real.first().copied())
                .unwrap_or_else(|| panic!("v(out) missing; msgs {:?}", result.messages))
        };
        let first = vout_at(&result.extra_plots[0].vectors);
        let second = vout_at(&result.vectors);
        assert!(
            (0.49..0.51).contains(&first),
            "temp=27 should give divider 0.5 V; got {first}"
        );
        assert!(
            (0.39..0.41).contains(&second),
            "temp=77 should give divider 0.4 V; got {second}"
        );
    }

    // ── Numerical accuracy against closed-form solutions ───────────────────
    //
    // "Accurate" for a circuit simulator does not mean "agrees with another
    // simulator" - that only propagates whatever the other one gets wrong. It
    // means agrees with the mathematics. Every circuit below has an exact
    // closed-form answer an engineer can derive on paper, so the assertions
    // are absolute error against truth rather than a golden file.
    //
    // These carry the same `#[ignore]` as the other real-engine tests: they
    // need the bundled libngspice. Run them with
    //   TAU_NGSPICE_LIB=build/ngspice-stage/lib/libngspice.dylib \
    //     cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml accuracy_ -- --ignored --nocapture

    #[cfg(test)]
    fn real_engine() -> SpiceEngine {
        let library = std::env::var_os("TAU_NGSPICE_LIB")
            .map(PathBuf::from)
            .expect("TAU_NGSPICE_LIB must point to a shared ngspice library");
        SpiceEngine::load(vec![library]).expect("ngspice library should load")
    }

    /// The samples of `name`, paired with the run's own time/sweep vector.
    #[cfg(test)]
    fn series(result: &SpiceResult, name: &str) -> (Vec<f64>, Vec<f64>) {
        let sweep = result
            .vectors
            .iter()
            .find(|v| {
                v.name.eq_ignore_ascii_case("time")
                    || v.name.eq_ignore_ascii_case("frequency")
                    || v.name.eq_ignore_ascii_case("v-sweep")
            })
            .unwrap_or_else(|| panic!("no sweep vector in {:?}", names(result)));
        let signal = result
            .vectors
            .iter()
            .find(|v| v.name.eq_ignore_ascii_case(name))
            .unwrap_or_else(|| panic!("no vector {name} in {:?}", names(result)));
        (sweep.real.clone(), signal.real.clone())
    }

    #[cfg(test)]
    fn names(result: &SpiceResult) -> Vec<&str> {
        result.vectors.iter().map(|v| v.name.as_str()).collect()
    }

    #[cfg(test)]
    fn scalar(result: &SpiceResult, name: &str) -> f64 {
        result
            .vectors
            .iter()
            .find(|v| v.name.eq_ignore_ascii_case(name))
            .and_then(|v| v.real.first())
            .copied()
            .unwrap_or_else(|| panic!("no scalar {name} in {:?}", names(result)))
    }

    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn accuracy_rc_step_matches_the_exponential() {
        // Vc(t) = 1 - exp(-t/RC), R = 1k, C = 1u, tau = 1 ms exactly.
        let _guard = real_engine_test_guard();
        let mut engine = real_engine();
        let result = engine
            .run(SpiceRequest {
                netlist: "RC step\nV1 in 0 PULSE(0 1 0 1p 1p 1 2)\nR1 in out 1k\nC1 out 0 1u\n.tran 10u 5m uic\n.end".to_string(),
            })
            .expect("rc step should solve");
        let (t, v) = series(&result, "out");
        let mut worst: f64 = 0.0;
        for (&time, &value) in t.iter().zip(v.iter()) {
            worst = worst.max((value - (1.0 - (-time / 1e-3).exp())).abs());
        }
        println!(
            "ACCURACY rc_step max_abs_err = {worst:.3e} V over {} samples",
            t.len()
        );
        assert!(
            worst < 1e-4,
            "RC step deviates from 1-exp(-t/RC) by {worst:.3e} V"
        );
    }

    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn accuracy_rlc_ringing_matches_the_damped_sinusoid() {
        // Series RLC step, underdamped, checked against the physics an
        // engineer actually reads off the plot: the ring frequency and the
        // decay envelope.
        //
        //   alpha = R/2L,  w0 = 1/sqrt(LC),  wd = sqrt(w0^2 - alpha^2)
        //
        // NOT a max-absolute-error bound against the closed form, and the
        // reason is worth recording. Measured that way the deviation is about
        // 5 mV on a 1 V step, and it gets LARGER with finer sampling (2.1 mV
        // at 1 us output, 5.0 mV at 50 ns) - which is backwards for truncation
        // error. The finer grid is not less accurate, it is merely landing
        // nearer the true extrema that the coarse grid stepped over. What is
        // actually there is trapezoidal phase dispersion, which shifts the
        // discrete natural frequency by about (wd*h)^2/12 and so accumulates
        // as a growing phase offset over the ~10 cycles in this window.
        // Tightening trtol does not move it (checked at 7, 1 and 0.5), which
        // confirms it is dispersion rather than local error control.
        //
        // Frequency and damping are the invariants that dispersion does not
        // corrupt, they are what the engineer is reading, and they hold to
        // parts in 1e3 - so those are what this pins.
        //
        // `rseries=0` because Tau's default hangs 1 mOhm on every inductor
        // (LTspice parity, see DEFAULT_OPTIONS); left on, this test would be
        // measuring that option rather than the integrator.
        let _guard = real_engine_test_guard();
        let mut engine = real_engine();
        let result = engine
            .run(SpiceRequest {
                netlist: "RLC ringing\n.options rseries=0\nV1 in 0 PULSE(0 1 0 1p 1p 1 2)\nR1 in a 10\nL1 a out 1m\nC1 out 0 1u\n.tran 200n 2m uic\n.end".to_string(),
            })
            .expect("rlc ringing should solve");
        let (t, v) = series(&result, "out");
        let (r, l, c) = (10.0_f64, 1e-3_f64, 1e-6_f64);
        let alpha = r / (2.0 * l);
        let w0 = 1.0 / (l * c).sqrt();
        let wd = (w0 * w0 - alpha * alpha).sqrt();

        // Upward zero crossings of (Vc - 1), linearly interpolated. The ring
        // is about the 1 V final value, so that is the axis.
        let mut crossings: Vec<f64> = Vec::new();
        for i in 1..t.len() {
            let (prev, next) = (v[i - 1] - 1.0, v[i] - 1.0);
            if prev < 0.0 && next >= 0.0 {
                crossings.push(t[i - 1] + (t[i] - t[i - 1]) * (-prev) / (next - prev));
            }
        }
        assert!(
            crossings.len() >= 4,
            "expected several ring cycles, got {}",
            crossings.len()
        );
        // The first three periods only, deliberately.
        //
        // This ring decays as exp(-5000t), so by ~1.3 ms it is down to tens of
        // microvolts and the crossings stop being a measurement of anything -
        // the observed intervals run 201.25, 201.40, 201.80, 202.95, 206.34,
        // 220.32 us, i.e. exact early and drifting badly once the amplitude
        // approaches the solver's own noise. Averaging all of them reported a
        // 2.2% frequency error that is an artefact of the estimator, not of
        // the engine. Over the first three cycles, where there is signal to
        // measure, the period is right to parts in 1e4.
        const RING_CYCLES: usize = 3;
        let periods: f64 = (crossings[RING_CYCLES] - crossings[0]) / RING_CYCLES as f64;
        let measured_wd = 2.0 * std::f64::consts::PI / periods;
        let wd_err = (measured_wd - wd).abs() / wd;

        // Envelope decay between the first and last cycle: |Vc-1| at the peak
        // of cycle n falls as exp(-alpha t), so the log ratio over a known
        // time span recovers alpha.
        let peak_between = |lo: f64, hi: f64| -> f64 {
            let mut best: f64 = 0.0;
            for (&tt, &vv) in t.iter().zip(v.iter()) {
                if tt >= lo && tt <= hi {
                    best = best.max((vv - 1.0).abs());
                }
            }
            best
        };
        let first = peak_between(crossings[0], crossings[1]);
        let last = peak_between(crossings[RING_CYCLES - 1], crossings[RING_CYCLES]);
        let span = crossings[RING_CYCLES - 1] - crossings[0];
        let measured_alpha = (first / last).ln() / span;
        let alpha_err = (measured_alpha - alpha).abs() / alpha;

        println!(
            "ACCURACY rlc_ringing wd: exact {wd:.2} measured {measured_wd:.2} rad/s (rel {wd_err:.2e}); \
             alpha: exact {alpha:.1} measured {measured_alpha:.1} 1/s (rel {alpha_err:.2e}); \
             {RING_CYCLES} of {} usable cycles",
            crossings.len() - 1
        );
        // These bound the ESTIMATOR plus the engine, and the estimator is the
        // looser of the two. The raw crossing intervals come out at 201.25 us
        // against an exact 201.22, i.e. the engine reproduces the period to
        // 1.5e-4; the frequency figure below is worse only because it averages
        // three intervals, and the damping figure is worse again because
        // reading an envelope off discrete peaks is a coarse way to recover an
        // exponent. Tightened only with a better estimator, never by loosening
        // the circuit.
        assert!(wd_err < 3e-3, "ring frequency off by {wd_err:.2e} relative");
        assert!(alpha_err < 3e-2, "damping off by {alpha_err:.2e} relative");
    }
    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn accuracy_rc_lowpass_ac_matches_the_transfer_function() {
        // |H| = 1/sqrt(1 + (w R C)^2). R = 1k, C = 1u => f_3dB = 159.15 Hz.
        let _guard = real_engine_test_guard();
        let mut engine = real_engine();
        let result = engine
            .run(SpiceRequest {
                netlist:
                    "RC lowpass\nV1 in 0 AC 1\nR1 in out 1k\nC1 out 0 1u\n.ac dec 20 1 100k\n.end"
                        .to_string(),
            })
            .expect("ac sweep should solve");
        let freq = result
            .vectors
            .iter()
            .find(|v| v.name.eq_ignore_ascii_case("frequency"))
            .expect("frequency vector");
        let out = result
            .vectors
            .iter()
            .find(|v| v.name.eq_ignore_ascii_case("out"))
            .expect("out vector");
        let imag = out.imaginary.as_ref().expect("ac result should be complex");
        let mut worst_rel: f64 = 0.0;
        for ((&f, &re), &im) in freq.real.iter().zip(out.real.iter()).zip(imag.iter()) {
            let mag = (re * re + im * im).sqrt();
            let w = 2.0 * std::f64::consts::PI * f;
            let exact = 1.0 / (1.0 + (w * 1e3 * 1e-6).powi(2)).sqrt();
            worst_rel = worst_rel.max(((mag - exact) / exact).abs());
        }
        println!(
            "ACCURACY rc_lowpass_ac max_rel_err = {worst_rel:.3e} over {} points",
            freq.real.len()
        );
        assert!(
            worst_rel < 1e-6,
            "AC magnitude deviates from 1/sqrt(1+(wRC)^2) by {worst_rel:.3e} relative"
        );
    }

    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn accuracy_high_impedance_divider_exposes_the_rshunt_default() {
        // A plain 1:1 divider reads 0.5 V for any R, in the mathematics. Tau
        // forces `rshunt=1e12` onto every deck (DEFAULT_OPTIONS), which hangs
        // 1 TOhm from every node to ground; its comment claims the effect is
        // "below measurement noise". That is true at kOhm and false as the
        // source impedance approaches the shunt. This test measures where.
        let _guard = real_engine_test_guard();
        let mut engine = real_engine();
        for (label, r, shunt) in [
            ("1k   default", "1k", "1e12"),
            ("1meg default", "1meg", "1e12"),
            ("1g   default", "1g", "1e12"),
            ("1t   default", "1t", "1e12"),
            ("1g   no-shunt", "1g", "0"),
            ("1t   no-shunt", "1t", "0"),
        ] {
            let shunt_line = if shunt == "0" {
                String::new()
            } else {
                format!(".options rshunt={shunt}\n")
            };
            let netlist =
                format!("divider\n{shunt_line}V1 in 0 1\nR1 in mid {r}\nR2 mid 0 {r}\n.op\n.end");
            match engine.run(SpiceRequest { netlist }) {
                Ok(result) => {
                    let mid = scalar(&result, "mid");
                    println!(
                        "ACCURACY divider R={label}: V(mid) = {mid:.9} V, error = {:.3e} V ({:.4}%)",
                        mid - 0.5,
                        (mid - 0.5).abs() / 0.5 * 100.0
                    );
                }
                Err(error) => println!("ACCURACY divider R={label}: FAILED: {error}"),
            }
        }
    }

    // ── UNIT 1E: can this engine honestly drive a live, free-running plot? ─
    //
    // The proposal under judgement is "Run energises the circuit like a bench
    // instrument": a transient that keeps solving while the plot scrolls, a
    // Stop that stops it, and a switch or pot that visibly bends the waveform
    // while it runs. That is an honest feature only if ngspice really is still
    // solving behind the scroll. Stitching finished runs together and calling
    // the seam "live" is exactly the silent model substitution AGENTS.md
    // forbids, so nothing here is inferred from the C sources alone - every
    // claim is measured against the real embedded library with Tau's code
    // models loaded, and the numbers are printed because a later unit has to
    // choose a slice length from them and a guess here becomes a guess in the
    // product.
    //
    //   TAU_NGSPICE_LIB=build/ngspice-stage/lib/libngspice.dylib \
    //     cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml live_1e_ \
    //     -- --ignored --nocapture --test-threads=1

    /** Resolve one live-run entry point from an already-open libngspice. */
    unsafe fn live_symbol<T: Copy>(library: &Library, name: &[u8]) -> T {
        let symbol = unsafe { library.get::<T>(name) }.unwrap_or_else(|error| {
            panic!(
                "{} is missing from this libngspice: {error}",
                String::from_utf8_lossy(name)
            )
        });
        *symbol
    }

    /** A `SpiceEngine` plus the wall-clock helpers a free-running probe needs.
     *
     * The live entry points themselves are no longer resolved here: 1E's
     * finding that they are safe on the shipped engine is why `SpiceApi` now
     * carries `running`/`lock_realloc`/`unlock_realloc`/`set_bkpt` for
     * production, and a second private resolution would let the spike drift
     * away from the symbols the product actually calls - which is exactly the
     * "measures a differently configured copy" failure the original `LiveApi`
     * comment existed to prevent. */
    struct LiveEngine {
        engine: SpiceEngine,
    }

    /** What one read of a running plot returned. */
    struct LiveSlice {
        /** The requested vectors, all trimmed to a common length so a sample
         * and its time are always the same solved point. */
        columns: Vec<Vec<f64>>,
        /** How far apart the longest and shortest published lengths were at
         * the instant of the read - the cost, in samples, of the fact that the
         * writer is still appending while the reader looks. */
        skew: usize,
    }

    impl LiveEngine {
        fn open() -> Self {
            let engine = real_engine();
            assert!(
                engine.codemodels_loaded > 0,
                "1E must measure the shipped engine; with no code models the XSPICE half of the question is not being asked at all"
            );
            Self { engine }
        }

        fn load(&mut self, netlist: &str) {
            let lines = deck_lines(netlist).expect("deck should tokenize");
            self.engine
                .circ_lines(&lines)
                .unwrap_or_else(|error| panic!("ngSpice_Circ rejected the deck: {error}"));
        }

        /** Raw `ngSpice_Command`, deliberately not `run_named_command`.
         *
         * The background commands report through status codes and stderr, not
         * through the fatal-message screen the production path applies, and a
         * spike that turned a nonzero status into a `Result` would end up
         * measuring Tau's error handling instead of the engine. */
        fn command(&self, command: &str) -> c_int {
            let text = CString::new(command).expect("command has no NUL");
            unsafe { (self.engine.api.command)(text.as_ptr() as *mut c_char) }
        }

        fn running(&self) -> bool {
            unsafe { (self.engine.api.running)() }
        }

        /** Wait for `ngSpice_running` to reach `want`, returning how long that
         * took, or `None` if it never did inside `budget`. */
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

        /** One read of the vectors a live plot is made of, by the protocol the
         * engine's own source dictates and that `ngSpice_LockRealloc` exists
         * for: `dvec_extend` swaps the sample array under `vecreallocMutex`,
         * while `plotAddRealValue` stores the sample BEFORE incrementing
         * `v_length`. A reader that holds the lock, reads the length, and
         * copies exactly that many samples can therefore never observe a freed
         * buffer or a half-written value.
         *
         * Two structural facts force the shape of this function.
         *
         * The lengths of different vectors are NOT collectively atomic - the
         * lock covers reallocation, not the per-vector `v_length++` - so at
         * any instant the time axis and a signal can disagree. So all the
         * lengths are read first, and every column is then trimmed to the
         * shortest of them. That is not papering over the skew: it is the only
         * way to hand back a time/value pairing that is true, and the raw skew
         * is returned alongside so a test can measure it.
         *
         * And `ngGet_Vec_Info` returns a pointer into one shared static
         * `myvec`, so the next call overwrites the previous answer - hence two
         * passes inside a single lock/unlock pair rather than one. */
        fn read_from(&self, names: &[&str], from: usize) -> LiveSlice {
            let requested: Vec<CString> = names
                .iter()
                .map(|name| CString::new(*name).expect("vector name has no NUL"))
                .collect();
            let mut heads: Vec<(*const f64, usize)> = Vec::with_capacity(names.len());
            let mut columns = Vec::with_capacity(names.len());
            unsafe {
                (self.engine.api.lock_realloc)();
                for name in &requested {
                    let info = (self.engine.api.get_vec_info)(name.as_ptr() as *mut c_char);
                    if info.is_null() || (*info).real_data.is_null() || (*info).length <= 0 {
                        heads.push((ptr::null(), 0));
                    } else {
                        heads.push(((*info).real_data as *const f64, (*info).length as usize));
                    }
                }
                let shortest = heads.iter().map(|(_, len)| *len).min().unwrap_or(0);
                let longest = heads.iter().map(|(_, len)| *len).max().unwrap_or(0);
                for (data, _) in &heads {
                    if data.is_null() || shortest <= from {
                        columns.push(Vec::new());
                    } else {
                        columns
                            .push(slice::from_raw_parts(data.add(from), shortest - from).to_vec());
                    }
                }
                (self.engine.api.unlock_realloc)();
                LiveSlice {
                    columns,
                    skew: longest - shortest,
                }
            }
        }

        /** Everything published so far, which is what a naive live reader that
         * redraws from scratch every frame would take. */
        fn snapshot(&self, names: &[&str]) -> Vec<Vec<f64>> {
            self.read_from(names, 0).columns
        }

        /** The length of one live vector, which is all a scroll position or a
         * progress readout needs. Split out from `snapshot` so the per-poll
         * cost of "how far has it got" can be measured separately from the
         * cost of copying the samples themselves. */
        fn live_length(&self, name: &str) -> usize {
            let requested = CString::new(name).expect("vector name has no NUL");
            unsafe {
                (self.engine.api.lock_realloc)();
                let info = (self.engine.api.get_vec_info)(requested.as_ptr() as *mut c_char);
                let length = if info.is_null() || (*info).length <= 0 {
                    0
                } else {
                    (*info).length as usize
                };
                (self.engine.api.unlock_realloc)();
                length
            }
        }
    }

    impl Drop for LiveEngine {
        /** A background solver thread that outlives its `SpiceEngine` would
         * keep writing into state the next test is about to re-initialise, and
         * `Library`'s own drop would `dlclose` the code it is executing. The
         * resulting crash would land in an unrelated test, so stop it here. */
        fn drop(&mut self) {
            if self.running() {
                self.command("bg_halt");
            }
        }
    }

    /** A first-order RC driven hard enough that the solver has real work to do,
     * with an end time far past anything these tests wait for. Every 1E test
     * halts on a WALL-CLOCK budget rather than waiting for the analysis to
     * finish, which is exactly what a live UI has to do. */
    const LIVE_RC_DECK: &str = "tau live rc
V1 in 0 SIN(0 1 1k)
R1 in out 1k
C1 out 0 100n
.tran 10u 600
.end";

    /** A 1:1 divider with a small hold cap: the "pot" is R2 and the "supply
     * switch" is V1, so a mid-run `alter` of either is the actuation the live
     * proposal promises. RC = 50 us, so the node settles inside a quarter of a
     * millisecond of circuit time - far less than any slice these tests use,
     * which keeps "did the waveform move?" a question about the engine rather
     * than about settling. */
    const LIVE_ACTUATION_DECK: &str = "tau live actuation
V1 in 0 1
R1 in mid 1k
R2 mid 0 1k
C1 mid 0 100n
.tran 10u 600
.end";

    /** Circuit test 15 (`Circuit_testing_v1/15_dflop_register.asc`) as Tau
     * emits it - adc_bridge → XSPICE d_dff → dac_bridge at Vhigh=5/Vlow=0/
     * Vt=2.5/Td=10n, two flops sharing a clock, and 100k loads on all four
     * outputs. Two deliberate departures, both forced by the halt/alter/resume
     * question.
     *
     * First, the clock is stretched by 1000x (period 2 s, not 2 ms) and the
     * run is 600 s long. The original is 6 ms end to end and finishes in a few
     * milliseconds of wall clock, which leaves nothing to halt in the middle
     * of. Only the time scale changes; the event structure does not.
     *
     * Second, the two PWL data sources become DC sources. `alter` cannot
     * meaningfully rewrite a PWL table mid-run, and the actuation being tested
     * here is a switch on D - which is what a DC source altered between clock
     * edges is.
     *
     * This is the deck for the corner the unit calls out: halt/alter/resume
     * across an XSPICE event boundary, where the analog solver and the event
     * queue have to come back in step with each other. */
    const LIVE_DFLOP_DECK: &str = "tau live dflop register (circuit test 15, time-scaled)
VD0 D0 0 5
VD1 D1 0 0
VCLK CLK 0 PULSE(0 5 1 1u 1u 0.5 2)
.model a1_adc adc_bridge(in_low=2.495 in_high=2.505)
A_a1_adc [D0 CLK 0 0] [a1_dd a1_dclk a1_dpre a1_dclr] a1_adc
.model a1_dff d_dff(ic=0 clk_delay=1e-8 set_delay=1e-8 reset_delay=1e-8 rise_delay=1e-9 fall_delay=1e-9)
A_a1 a1_dd a1_dclk a1_dpre a1_dclr a1_dq a1_dnq a1_dff
.model a1_dac dac_bridge(out_low=0 out_high=5 t_rise=1e-8 t_fall=1e-8)
A_a1_dac [a1_dq a1_dnq] [Q0 Q0BAR] a1_dac
.model a2_adc adc_bridge(in_low=2.495 in_high=2.505)
A_a2_adc [D1 CLK 0 0] [a2_dd a2_dclk a2_dpre a2_dclr] a2_adc
.model a2_dff d_dff(ic=0 clk_delay=1e-8 set_delay=1e-8 reset_delay=1e-8 rise_delay=1e-9 fall_delay=1e-9)
A_a2 a2_dd a2_dclk a2_dpre a2_dclr a2_dq a2_dnq a2_dff
.model a2_dac dac_bridge(out_low=0 out_high=5 t_rise=1e-8 t_fall=1e-8)
A_a2_dac [a2_dq a2_dnq] [Q1 Q1BAR] a2_dac
RQ0 Q0 0 100k
RQ0B Q0BAR 0 100k
RQ1 Q1 0 100k
RQ1B Q1BAR 0 100k
.tran 1m 600
.end";

    /** Mean of the last `count` samples, which is how a live readout would
     * quote a settled node without being fooled by one noisy point. */
    fn tail_mean(samples: &[f64], count: usize) -> f64 {
        let tail = &samples[samples.len().saturating_sub(count)..];
        tail.iter().sum::<f64>() / tail.len() as f64
    }

    // ── (a) SendData ───────────────────────────────────────────────────────
    //
    // The comment at the `ngSpice_Init` call site is a crash report, not a
    // style preference, so this is run in a CHILD PROCESS. A null dereference
    // inside libngspice takes the whole test binary with it (ngspice's own
    // SIGSEGV handler calls `controlled_exit`, which is no gentler), and a
    // crash that kills the harness reports as "everything failed" rather than
    // as the one fact it is. The parent therefore learns the answer from the
    // child's exit status and printed progress markers, and stays alive to say
    // so. The poll path is the default; SendData is only worth adopting if it
    // is proven safe here.

    /** Streaming callbacks cannot carry a `&mut` anything across the FFI
     * boundary, and what they are being asked here is only "were you called,
     * and did you survive" - so a pair of process-global counters is the whole
     * state these need. */
    static SENDDATA_CALLS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    static SENDINITDATA_CALLS: std::sync::atomic::AtomicUsize =
        std::sync::atomic::AtomicUsize::new(0);

    /** Which thread libngspice called `SendData` on. Under `bg_run` this is
     * the solver's own thread, and that is the whole reason the question
     * matters: a streaming callback is not a cheaper poll, it is code running
     * inside the solver's inner loop, where anything slow or anything that
     * takes a lock the solver also wants becomes the solver's problem. */
    static SENDDATA_THREAD: Mutex<Option<std::thread::ThreadId>> = Mutex::new(None);

    unsafe extern "C" fn probe_send_data(
        values: *mut c_void,
        _count: c_int,
        _ident: c_int,
        _user_data: *mut c_void,
    ) -> c_int {
        // Touch nothing behind the pointer. The suspicion under test is that
        // libngspice hands out a malformed `vecvaluesall`, and a probe that
        // walked it could not tell its own bad indexing apart from ngspice's.
        // A non-null check is the strongest claim that stays honest.
        if !values.is_null() {
            SENDDATA_CALLS.fetch_add(1, Ordering::Relaxed);
        }
        if let Ok(mut seen) = SENDDATA_THREAD.lock() {
            *seen = Some(std::thread::current().id());
        }
        0
    }

    unsafe extern "C" fn probe_send_init_data(
        _info: *mut c_void,
        _ident: c_int,
        _user_data: *mut c_void,
    ) -> c_int {
        SENDINITDATA_CALLS.fetch_add(1, Ordering::Relaxed);
        0
    }

    /** The env var that tells the ignored child test it is the child. Without
     * it the test is a no-op, because `cargo test -- --ignored` would
     * otherwise run the crash probe inside the parent harness - which is the
     * one thing this whole arrangement exists to avoid. */
    const SENDDATA_CHILD_ENV: &str = "TAU_1E_SENDDATA_CHILD";
    const SENDDATA_CHILD_TEST: &str = "spice::tests::live_1e_a_senddata_probe_child";
    const SENDDATA_CHILD_DONE: &str = "1E-A CHILD SURVIVED ALL DECKS";

    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn live_1e_a_senddata_probe_child() {
        let Some(_marker) = std::env::var_os(SENDDATA_CHILD_ENV) else {
            return;
        };
        let _guard = real_engine_test_guard();

        // `SpiceEngine::from_library` is reproduced here rather than called,
        // and the reason is a one-way door in libngspice: `ngSpice_Init` sets
        // `nodatawanted` TRUE when the SendData argument is NULL and NEVER
        // clears it again. A second `ngSpice_Init` with the callback supplied
        // therefore registers a function that can no longer be reached, which
        // is exactly what the first version of this test measured - three
        // decks, zero callbacks, a false "safe". Streaming has to be armed on
        // the process's FIRST init or not at all, which is also why this test
        // lives in a child process. Everything else below - staged code
        // models, message plumbing, deck path - is production's.
        let library_path = std::env::var_os("TAU_NGSPICE_LIB")
            .map(PathBuf::from)
            .expect("TAU_NGSPICE_LIB must point to a shared ngspice library");
        let library = unsafe { Library::new(&library_path) }.expect("ngspice library should load");
        let api = unsafe {
            SpiceApi {
                init: live_symbol(&library, b"ngSpice_Init\0"),
                command: live_symbol(&library, b"ngSpice_Command\0"),
                circ: live_symbol(&library, b"ngSpice_Circ\0"),
                cur_plot: live_symbol(&library, b"ngSpice_CurPlot\0"),
                all_plots: live_symbol(&library, b"ngSpice_AllPlots\0"),
                all_vecs: live_symbol(&library, b"ngSpice_AllVecs\0"),
                get_vec_info: live_symbol(&library, b"ngGet_Vec_Info\0"),
                running: live_symbol(&library, b"ngSpice_running\0"),
                lock_realloc: live_symbol(&library, b"ngSpice_LockRealloc\0"),
                unlock_realloc: live_symbol(&library, b"ngSpice_UnlockRealloc\0"),
                set_bkpt: live_symbol(&library, b"ngSpice_SetBkpt\0"),
            }
        };
        let mut callback_state = Box::<CallbackState>::default();
        let user_data = callback_state.as_mut() as *mut CallbackState as *mut c_void;
        let status = unsafe {
            (api.init)(
                Some(on_char),
                Some(on_stat),
                Some(on_exit),
                Some(probe_send_data),
                Some(probe_send_init_data),
                Some(on_bg_thread),
                user_data,
            )
        };
        assert_eq!(status, 0, "ngSpice_Init with SendData armed failed");
        let mut engine = SpiceEngine {
            _library: library,
            api,
            callback_state,
            library_path,
            codemodels_loaded: 0,
        };
        engine
            .load_bundled_codemodels()
            .expect("Tau's code models should load");
        assert!(
            engine.codemodels_loaded > 0,
            "without code models the XSPICE deck below would prove nothing"
        );

        // The decks are chosen from the two mechanisms `sh_ExecutePerLoop` can
        // fail by, read out of libngspice's own source rather than guessed at.
        // It indexes `curvecvalsall->vecsa[i]` while walking `pl->pl_dvecs`,
        // with the array sized once from `cur_run->numData`, and it takes
        // `veclen` from the FIRST vector's length and applies it to every
        // other one. So the exposure is (1) a plot whose vector list is longer
        // than `numData`, and (2) a plot holding vectors of unequal length -
        // which is what device-property saves like `@c1[i]` are, since the
        // engine's own comment in that function calls out `@c1[i]` during AC
        // as a zero-length case it had to add a guard for. Analysis types that
        // change the plot shape mid-process, and `.noise`, which builds two
        // plots of different widths in one run, are here for the same reason.
        for (label, netlist) in [
            (
                "plain rc",
                "1e-a plain\nV1 in 0 SIN(0 1 1k)\nR1 in out 1k\nC1 out 0 100n\n.tran 10u 2m\n.end",
            ),
            (
                "tran, mixed device-property saves",
                "1e-a mixed saves\nV1 in 0 SIN(0 1 1k)\nR1 in out 1k\nC1 out 0 100n\n.save V(out) V(in) @r1[i] @c1[i]\n.tran 10u 2m\n.end",
            ),
            (
                "ac, mixed device-property saves",
                "1e-a ac saves\nV1 in 0 AC 1\nR1 in out 1k\nC1 out 0 100n\n.save V(out) @r1[i] @c1[i]\n.ac dec 20 1 1meg\n.end",
            ),
            (
                "dc sweep, mixed device-property saves",
                "1e-a dc saves\nV1 in 0 1\nR1 in out 1k\nR2 out 0 1k\n.save V(out) @r1[i] @r2[i]\n.dc V1 0 5 0.01\n.end",
            ),
            (
                "noise, two plots of different widths in one run",
                "1e-a noise\nV1 in 0 AC 1\nR1 in out 1k\nC1 out 0 100n\n.noise V(out) V1 dec 20 1 1meg\n.end",
            ),
            (
                "op after a transient, changing the plot type",
                "1e-a op\nV1 in 0 1\nR1 in out 1k\nR2 out 0 1k\n.save V(out) @r1[i]\n.op\n.end",
            ),
            (
                "step family, one circ/run per member",
                "1e-a step\nV1 in 0 1\nR1 in out {r}\nR2 out 0 1k\nC1 out 0 100n\n.param r=1k\n.step param r 1k 5k 1k\n.save V(out) @r2[i]\n.tran 10u 1m\n.end",
            ),
            ("xspice dflop register", LIVE_DFLOP_DECK_SHORT),
            (
                "xspice dflop register with device-property saves",
                LIVE_DFLOP_DECK_SAVES,
            ),
            // Last, and deliberately: these two aim at the literal wording of
            // the crash report. `sh_vecinit` returns EARLY, without allocating
            // `curvecvalsall`, when the run has no data vectors - and
            // `sh_ExecutePerLoop` then dereferences that null pointer with no
            // check. An empty save list is the shortest route to a run with no
            // data vectors, so if the recorded null dereference is real this is
            // where it shows up. They run after everything else so a crash here
            // still leaves the evidence from the eight decks above printed.
            (
                "save none, so the run has no data vectors",
                "1e-a save none\nV1 in 0 SIN(0 1 1k)\nR1 in out 1k\nC1 out 0 100n\n.save none\n.tran 10u 2m\n.end",
            ),
            (
                "save of a node the circuit does not have",
                "1e-a save ghost\nV1 in 0 SIN(0 1 1k)\nR1 in out 1k\nC1 out 0 100n\n.save V(nowhere)\n.tran 10u 2m\n.end",
            ),
        ] {
            SENDDATA_CALLS.store(0, Ordering::Relaxed);
            SENDINITDATA_CALLS.store(0, Ordering::Relaxed);
            println!("1E-A deck '{label}': starting");
            let outcome = engine.run(SpiceRequest {
                netlist: netlist.to_string(),
            });
            let data = SENDDATA_CALLS.load(Ordering::Relaxed);
            let init = SENDINITDATA_CALLS.load(Ordering::Relaxed);
            match outcome {
                Ok(result) => println!(
                    "1E-A deck '{label}': survived, SendData x{data}, SendInitData x{init}, plot {} with {} vectors",
                    result.plot,
                    result.vectors.len()
                ),
                Err(error) => println!(
                    "1E-A deck '{label}': survived but the run FAILED ({error}), SendData x{data}, SendInitData x{init}"
                ),
            }
        }

        // Finally the configuration a live simulator would actually use:
        // streaming while the solver runs in the background. This is where the
        // callback stops being an alternative way to read a finished run and
        // becomes code executing inside the solver's loop, so it is measured
        // separately and its thread is recorded.
        let host_thread = std::thread::current().id();
        let running: unsafe extern "C" fn() -> bool =
            unsafe { live_symbol(&engine._library, b"ngSpice_running\0") };
        // The deck loop above deliberately includes decks ngspice rejects, and
        // their diagnostics are still in the buffer. `circ_lines` screens that
        // buffer for fatal messages, so without draining it this load would
        // fail on somebody else's error.
        take_messages(&engine.callback_state);
        engine
            .circ_lines(&deck_lines(LIVE_RC_DECK).expect("deck should tokenize"))
            .expect("the live RC deck should load");
        SENDDATA_CALLS.store(0, Ordering::Relaxed);
        let bg_run = CString::new("bg_run").expect("no NUL");
        unsafe { (engine.api.command)(bg_run.as_ptr() as *mut c_char) };
        let watch = Instant::now();
        thread::sleep(Duration::from_millis(500));
        let elapsed = watch.elapsed();
        let streamed = SENDDATA_CALLS.load(Ordering::Relaxed);
        let bg_halt = CString::new("bg_halt").expect("no NUL");
        unsafe { (engine.api.command)(bg_halt.as_ptr() as *mut c_char) };
        while unsafe { running() } {
            thread::sleep(Duration::from_millis(10));
        }
        let callback_thread = SENDDATA_THREAD.lock().ok().and_then(|seen| *seen);
        println!(
            "1E-A background streaming: {streamed} SendData calls in {:.3} s = {:.0}/s, on {} thread",
            elapsed.as_secs_f64(),
            streamed as f64 / elapsed.as_secs_f64(),
            if callback_thread == Some(host_thread) {
                "the HOST"
            } else {
                "the SOLVER's own"
            }
        );

        println!("{SENDDATA_CHILD_DONE}");
    }

    /** The short-run twin of `LIVE_DFLOP_DECK`: same XSPICE structure at the
     * original circuit-15 time scale, because (a) only needs the streaming
     * path exercised over event data, not a run long enough to interrupt. */
    const LIVE_DFLOP_DECK_SHORT: &str = "tau 1e-a dflop register
VD0 D0 0 PWL(0 5 4m 5 4.001m 0 6m 0)
VD1 D1 0 PWL(0 0 2m 0 2.001m 5 6m 5)
VCLK CLK 0 PULSE(0 5 1m 1n 1n 0.5m 2m)
.model a1_adc adc_bridge(in_low=2.495 in_high=2.505)
A_a1_adc [D0 CLK 0 0] [a1_dd a1_dclk a1_dpre a1_dclr] a1_adc
.model a1_dff d_dff(ic=0 clk_delay=1e-8 set_delay=1e-8 reset_delay=1e-8 rise_delay=1e-9 fall_delay=1e-9)
A_a1 a1_dd a1_dclk a1_dpre a1_dclr a1_dq a1_dnq a1_dff
.model a1_dac dac_bridge(out_low=0 out_high=5 t_rise=1e-8 t_fall=1e-8)
A_a1_dac [a1_dq a1_dnq] [Q0 Q0BAR] a1_dac
RQ0 Q0 0 100k
RQ0B Q0BAR 0 100k
.tran 1u 6m
.end";

    /** The hardest case (a) has for the streaming path: XSPICE event nodes and
     * analog device-property saves in one plot, so the vector list contains
     * both kinds of length the shared bookkeeping has to keep straight. */
    const LIVE_DFLOP_DECK_SAVES: &str = "tau 1e-a dflop register with saves
VD0 D0 0 PWL(0 5 4m 5 4.001m 0 6m 0)
VCLK CLK 0 PULSE(0 5 1m 1n 1n 0.5m 2m)
.model a1_adc adc_bridge(in_low=2.495 in_high=2.505)
A_a1_adc [D0 CLK 0 0] [a1_dd a1_dclk a1_dpre a1_dclr] a1_adc
.model a1_dff d_dff(ic=0 clk_delay=1e-8 set_delay=1e-8 reset_delay=1e-8 rise_delay=1e-9 fall_delay=1e-9)
A_a1 a1_dd a1_dclk a1_dpre a1_dclr a1_dq a1_dnq a1_dff
.model a1_dac dac_bridge(out_low=0 out_high=5 t_rise=1e-8 t_fall=1e-8)
A_a1_dac [a1_dq a1_dnq] [Q0 Q0BAR] a1_dac
RQ0 Q0 0 100k
RQ0B Q0BAR 0 100k
CQ0 Q0 0 1n
.save V(Q0) V(Q0BAR) V(CLK) @rq0[i] @cq0[i] I(VCLK)
.tran 1u 6m
.end";

    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn live_1e_a_senddata_is_only_adopted_if_a_child_process_proves_it_safe() {
        let _guard = real_engine_test_guard();
        let binary = std::env::current_exe().expect("test binary path");
        let output = Command::new(&binary)
            .args([
                "--exact",
                SENDDATA_CHILD_TEST,
                "--ignored",
                "--nocapture",
                "--test-threads=1",
            ])
            .env(SENDDATA_CHILD_ENV, "1")
            .output()
            .expect("the test binary should be re-runnable as a child");
        let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        println!("1E-A child stdout:\n{stdout}");
        println!("1E-A child stderr tail:\n{}", engine_log_tail_text(&stderr));

        // A filter that matches nothing exits 0 with "0 passed", which would
        // read as a clean pass and prove nothing at all. Insist the child
        // actually started before believing anything about how it ended.
        assert!(
            stdout.contains("1E-A deck 'plain rc': starting"),
            "the child never ran - has {SENDDATA_CHILD_TEST} been renamed?"
        );

        #[cfg(unix)]
        let signal = std::os::unix::process::ExitStatusExt::signal(&output.status);
        #[cfg(not(unix))]
        let signal: Option<i32> = None;
        println!(
            "1E-A child exit: code {:?}, signal {signal:?}",
            output.status.code()
        );

        // What this records, and its limits. Across the eleven decks above -
        // including every shape of `sh_ExecutePerLoop` exposure the engine's
        // source suggests, and the background-streaming configuration a live
        // simulator would actually use - the recorded null dereference did NOT
        // reproduce on this build. That is not the same as "SendData is safe":
        // the crash report names no deck, so a deck outside this set may still
        // reach it, and the decks here are the ones its wording pointed at
        // rather than the ones that originally failed.
        //
        // The conclusion it does support is the one the unit asked for.
        // SendData is an OPTIMISATION over the poll path, and (b) and (c)
        // measured the poll path costing about 0.3 us for a scroll position
        // and about 60-250 us for a tail of samples - amply cheap. An
        // unreproducible crash is not a reason to adopt a second path that
        // buys nothing measurable, so the poll path stays the default and this
        // test exists to say why, and to notice if the answer ever changes.
        assert!(
            stdout.contains(SENDDATA_CHILD_DONE),
            "the SendData probe stopped early (exit code {:?}, signal {signal:?}). \
             A signal means the recorded null dereference reproduced and the streaming path is unusable; \
             a code of 101 means one of the probe's own assertions failed. Either way the poll path stays the default.",
            output.status.code()
        );
        // A crash inside libngspice that its own SIGSEGV handler converts into
        // an orderly exit would leave the marker unprinted but the status
        // clean, so the status is checked too rather than trusted to the
        // marker alone.
        assert_eq!(
            output.status.code(),
            Some(0),
            "the SendData probe printed its marker but exited badly (signal {signal:?})"
        );
    }

    /** The last few lines of a child's stderr. ngspice writes its own
     * diagnostics straight to the C stderr rather than through `SendChar`, so
     * this is the only place a crash message from the engine shows up, and the
     * whole stream is far too noisy to paste. */
    fn engine_log_tail_text(stderr: &str) -> String {
        let lines: Vec<&str> = stderr.lines().collect();
        lines[lines.len().saturating_sub(12)..].join("\n")
    }

    // ── (b) bg_run + ngSpice_running ───────────────────────────────────────

    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn live_1e_b_bg_run_solves_in_the_background_while_the_host_polls() {
        let _guard = real_engine_test_guard();
        let mut probe = LiveEngine::open();
        probe.load(LIVE_RC_DECK);

        let started = Instant::now();
        let status = probe.command("bg_run");
        let command_returned = started.elapsed();
        assert_eq!(status, 0, "bg_run was rejected");
        let to_running = probe
            .await_running(true, Duration::from_secs(5))
            .expect("ngSpice_running never went true after bg_run");

        // A live plot's whole premise is that the host can look at a partial
        // answer while the solver is still busy. Sample the length repeatedly
        // and require it to keep moving.
        let budget = Duration::from_millis(1000);
        let watch = Instant::now();
        let mut lengths = Vec::new();
        while watch.elapsed() < budget {
            lengths.push(probe.live_length("time"));
            thread::sleep(Duration::from_millis(20));
        }
        let observed = watch.elapsed();
        let grown = lengths.last().copied().unwrap_or(0);
        let still_running = probe.running();

        let halt_started = Instant::now();
        let halt_status = probe.command("bg_halt");
        let halt_returned = halt_started.elapsed();
        let to_stopped = probe.await_running(false, Duration::from_secs(5));

        println!(
            "1E-B bg_run returned in {:.3} ms; ngSpice_running true after {:.3} ms",
            command_returned.as_secs_f64() * 1e3,
            to_running.as_secs_f64() * 1e3
        );
        println!(
            "1E-B {} samples in {:.3} s = {:.0} points/s sustained by the solver",
            grown,
            observed.as_secs_f64(),
            grown as f64 / observed.as_secs_f64()
        );
        println!(
            "1E-B bg_halt status {halt_status}, command returned in {:.1} ms, ngSpice_running false after {:.1} ms",
            halt_returned.as_secs_f64() * 1e3,
            to_stopped.map(|d| d.as_secs_f64() * 1e3).unwrap_or(f64::NAN)
        );

        assert!(
            still_running,
            "the solver finished inside {observed:?}; this deck is too short to answer the question"
        );
        assert!(
            lengths.windows(2).all(|pair| pair[1] >= pair[0]),
            "the published sample count went backwards: {lengths:?}"
        );
        assert!(
            grown > lengths.first().copied().unwrap_or(0),
            "no samples appeared while ngSpice_running was true, so nothing was actually solving in the background"
        );
        assert!(
            to_stopped.is_some(),
            "bg_halt did not stop the background thread, so Stop cannot be honest"
        );
    }

    // ── (c) reading a growing vector without tearing ───────────────────────

    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn live_1e_c_a_growing_vector_reads_without_tearing_and_costs_little() {
        let _guard = real_engine_test_guard();
        let mut probe = LiveEngine::open();
        probe.load(LIVE_RC_DECK);
        assert_eq!(probe.command("bg_run"), 0, "bg_run was rejected");
        probe
            .await_running(true, Duration::from_secs(5))
            .expect("ngSpice_running never went true after bg_run");

        // Phase 1 - the naive reader: copy the whole plot every frame. This is
        // what a live UI would do if nobody thought about it, and it is the
        // only way to prove the strong property, that history NEVER changes
        // under the reader. Every poll compares the entire prefix, not a
        // sampled window: a reallocation that copied wrongly need not corrupt
        // the tail, and a spot check would miss it.
        let mut previous: Vec<f64> = Vec::new();
        let mut previous_time: Vec<f64> = Vec::new();
        let mut worst_skew = 0_usize;
        let mut full_total = Duration::ZERO;
        let mut full_polls = 0_usize;
        let watch = Instant::now();
        while watch.elapsed() < Duration::from_millis(1000) {
            let poll_started = Instant::now();
            let slice = probe.read_from(&["time", "out"], 0);
            full_total += poll_started.elapsed();
            full_polls += 1;
            worst_skew = worst_skew.max(slice.skew);
            let time = &slice.columns[0];
            let out = &slice.columns[1];

            let kept = previous.len().min(out.len());
            assert_eq!(
                &out[..kept],
                &previous[..kept],
                "the samples already published changed underneath the reader"
            );
            assert_eq!(
                &time[..kept],
                &previous_time[..kept],
                "the time axis already published changed underneath the reader"
            );
            assert!(
                out.iter().all(|value| value.is_finite()),
                "a non-finite sample was read from the live vector"
            );
            assert!(
                time.windows(2).all(|pair| pair[1] > pair[0]),
                "the live time axis was not strictly increasing"
            );
            previous = out.clone();
            previous_time = time.clone();
            thread::sleep(Duration::from_millis(20));
        }
        let full_samples = previous.len();

        // Phase 2 - the reader a live plot should actually have: take only the
        // samples that appeared since last time. The claim being tested is not
        // that this is faster (it obviously is); it is that it is EXACT. The
        // incrementally assembled waveform is compared, sample for sample,
        // against one final whole-plot read. If they match, a scrolling plot
        // built this way is showing the solver's own numbers and not a
        // reconstruction of them.
        let base = probe.live_length("time");
        let mut assembled_time: Vec<f64> = Vec::new();
        let mut assembled_out: Vec<f64> = Vec::new();
        let mut tail_total = Duration::ZERO;
        let mut tail_worst = Duration::ZERO;
        let mut tail_polls = 0_usize;
        let watch = Instant::now();
        while watch.elapsed() < Duration::from_millis(1000) {
            let poll_started = Instant::now();
            let slice = probe.read_from(&["time", "out"], base + assembled_time.len());
            let cost = poll_started.elapsed();
            tail_total += cost;
            tail_worst = tail_worst.max(cost);
            tail_polls += 1;
            assembled_time.extend_from_slice(&slice.columns[0]);
            assembled_out.extend_from_slice(&slice.columns[1]);
            thread::sleep(Duration::from_millis(20));
        }

        // The cost of "how far has it got" on its own, because a scroll
        // position is wanted far more often than the samples are redrawn.
        let mut length_total = Duration::ZERO;
        for _ in 0..2000 {
            let started = Instant::now();
            let _ = probe.live_length("time");
            length_total += started.elapsed();
        }

        probe.command("bg_halt");
        probe.await_running(false, Duration::from_secs(5));
        let truth = probe.snapshot(&["time", "out"]);

        println!(
            "1E-C naive whole-plot poll: {full_polls} polls, {:.2} ms mean, {full_samples} samples by the end",
            full_total.as_secs_f64() * 1e3 / full_polls as f64
        );
        println!(
            "1E-C incremental tail poll: {tail_polls} polls, {:.1} us mean, {:.1} us worst, {} samples assembled ({:.0} samples per poll)",
            tail_total.as_secs_f64() * 1e6 / tail_polls as f64,
            tail_worst.as_secs_f64() * 1e6,
            assembled_time.len(),
            assembled_time.len() as f64 / tail_polls as f64
        );
        println!(
            "1E-C length-only poll: {:.2} us mean over 2000 calls",
            length_total.as_secs_f64() * 1e6 / 2000.0
        );
        println!(
            "1E-C worst time-vs-signal published-length skew: {worst_skew} sample(s) (trimmed away by the reader)"
        );

        assert!(
            full_samples > 0,
            "nothing was ever readable from the running plot"
        );
        assert!(
            !assembled_time.is_empty(),
            "the incremental reader assembled nothing"
        );
        // The exactness claim. `truth` is read after the halt, so it is at
        // least as long as anything assembled while the run was live; the
        // assembled stream must match it exactly over the window phase 2
        // covered, which begins at `base`.
        assert_eq!(
            &truth[0][base..base + assembled_time.len()],
            &assembled_time[..],
            "the incrementally read time axis is not the axis the solver produced"
        );
        assert_eq!(
            &truth[1][base..base + assembled_out.len()],
            &assembled_out[..],
            "the incrementally read waveform is not the waveform the solver produced"
        );
    }

    // ── (d) bg_halt → alter → bg_resume ────────────────────────────────────

    /** What one halt/alter/resume cycle did, in the terms the live proposal
     * cares about: was history preserved, did the plot keep growing, and did
     * the altered value show up in the samples that came after. */
    struct Actuation {
        halt_latency: Duration,
        resume_latency: Duration,
        before_len: usize,
        after_len: usize,
        settled_before: f64,
        settled_after: f64,
    }

    /** Halt a running analysis, apply `alter`, resume, and let it run again.
     *
     * Asserts the two things that must hold whatever the altered value does:
     * the samples published before the halt are still byte-identical
     * afterwards, and the time axis is still monotonic across the seam. A
     * "live" plot that rewrote its own history at every actuation would be a
     * worse lie than not having the feature. */
    fn actuate(probe: &LiveEngine, signal: &str, alter: &str, settle: Duration) -> Actuation {
        let before = probe.snapshot(&["time", signal]);
        let before_time = before[0].clone();
        let before_signal = before[1].clone();

        let halt_started = Instant::now();
        assert_eq!(probe.command("bg_halt"), 0, "bg_halt was rejected");
        probe
            .await_running(false, Duration::from_secs(5))
            .expect("bg_halt did not stop the run");
        let halt_latency = halt_started.elapsed();

        assert_eq!(probe.command(alter), 0, "`{alter}` was rejected");

        let resume_started = Instant::now();
        assert_eq!(probe.command("bg_resume"), 0, "bg_resume was rejected");
        probe
            .await_running(true, Duration::from_secs(5))
            .expect("bg_resume did not restart the run");
        let resume_latency = resume_started.elapsed();

        thread::sleep(settle);
        let after = probe.snapshot(&["time", signal]);
        let after_time = &after[0];
        let after_signal = &after[1];

        let kept = before_signal.len().min(after_signal.len());
        assert_eq!(
            &after_signal[..kept],
            &before_signal[..kept],
            "resuming rewrote samples the plot had already shown"
        );
        assert_eq!(
            &after_time[..kept],
            &before_time[..kept],
            "resuming rewrote the time axis the plot had already shown"
        );
        assert!(
            after_time.windows(2).all(|pair| pair[1] > pair[0]),
            "the time axis stopped being monotonic across the halt/resume seam"
        );

        Actuation {
            halt_latency,
            resume_latency,
            before_len: before_signal.len(),
            after_len: after_signal.len(),
            settled_before: tail_mean(&before_signal, 64),
            settled_after: tail_mean(after_signal, 64),
        }
    }

    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn live_1e_d_halt_alter_resume_changes_only_the_samples_after_the_resume() {
        let _guard = real_engine_test_guard();
        let mut probe = LiveEngine::open();
        probe.load(LIVE_ACTUATION_DECK);
        assert_eq!(probe.command("bg_run"), 0, "bg_run was rejected");
        probe
            .await_running(true, Duration::from_secs(5))
            .expect("ngSpice_running never went true after bg_run");
        thread::sleep(Duration::from_millis(300));

        // Two actuations, not one, because they reach the solver by different
        // routes and the live proposal promises both. A source's DC value is
        // read out of the instance on every matrix load. A resistor's is not:
        // `RESload` uses the cached `RESconduct`, which `restemp.c` computes,
        // and `if_setparam` skips its `CKTtemp` call for instance-level
        // `alter`. On that reading the pot should have gone stale and the
        // supply should not have - and the measurement below says the pot
        // works too, so `resume` is refreshing it. The pot case is asserted
        // for exactly that reason: it holds for a reason nobody wrote down,
        // and if a future ngspice stops doing it the pot silently stops
        // responding while the supply keeps working.
        let pot = actuate(&probe, "mid", "alter r2 = 3k", Duration::from_millis(300));
        let supply = actuate(&probe, "mid", "alter v1 = 2", Duration::from_millis(300));

        probe.command("bg_halt");
        probe.await_running(false, Duration::from_secs(5));

        for (label, act, expected) in [
            ("pot   (alter r2 1k->3k)", &pot, 0.75),
            ("supply(alter v1 1->2)  ", &supply, 1.5),
        ] {
            println!(
                "1E-D {label}: halt {:.1} ms, resume {:.1} ms, {} -> {} samples, settled {:.6} V -> {:.6} V (expected {expected:.3} V if the alter took effect)",
                act.halt_latency.as_secs_f64() * 1e3,
                act.resume_latency.as_secs_f64() * 1e3,
                act.before_len,
                act.after_len,
                act.settled_before,
                act.settled_after
            );
            assert!(
                act.after_len > act.before_len,
                "{label}: no new samples appeared after the resume, so the run did not actually continue"
            );
            // The decisive claim for "flip a switch and watch the plot
            // change". Both routes are held to the value an engineer would
            // read off the schematic, not merely to "something moved": a
            // divider that answered 0.6 V after the pot went to 3k would be a
            // live plot showing a circuit nobody drew.
            assert!(
                (act.settled_after - expected).abs() < 1e-3,
                "{label}: after the resume the node settled at {:.6} V, not the {expected:.3} V the altered circuit has. Live actuation is not solving the circuit the user is holding.",
                act.settled_after
            );
        }
        // Ordering matters and is part of the claim: the pot ran first, so the
        // supply case starts from 0.75 V and not from 0.5 V. If the two
        // actuations were independent this would read 0.5 -> 1.0.
        assert!(
            (pot.settled_after - supply.settled_before).abs() < 1e-9,
            "the second actuation did not start from where the first one left the circuit"
        );
    }

    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn live_1e_d_halt_alter_resume_survives_an_xspice_event_boundary() {
        let _guard = real_engine_test_guard();
        let mut probe = LiveEngine::open();
        probe.load(LIVE_DFLOP_DECK);
        assert_eq!(probe.command("bg_run"), 0, "bg_run was rejected");
        probe
            .await_running(true, Duration::from_secs(5))
            .expect("ngSpice_running never went true after bg_run");

        // Wait for circuit time to pass the first two rising clock edges, so
        // the register has actually latched D before anything is altered.
        // Waiting on circuit time rather than wall clock keeps the test's
        // meaning fixed on a slower or faster machine.
        let deadline = Instant::now() + Duration::from_secs(60);
        loop {
            let time = probe.snapshot(&["time"]).pop().unwrap_or_default();
            if time.last().copied().unwrap_or(0.0) >= 3.5 {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "the XSPICE deck reached only {:.3} s of circuit time in 60 s of wall clock",
                time.last().copied().unwrap_or(0.0)
            );
            thread::sleep(Duration::from_millis(20));
        }

        let before = probe.snapshot(&["time", "q0", "q1"]);
        let latched_q0 = tail_mean(&before[1], 8);
        let latched_q1 = tail_mean(&before[2], 8);

        let halt_started = Instant::now();
        assert_eq!(probe.command("bg_halt"), 0, "bg_halt was rejected");
        probe
            .await_running(false, Duration::from_secs(5))
            .expect("bg_halt did not stop the XSPICE run");
        let halt_latency = halt_started.elapsed();
        let halted_at = before[0].last().copied().unwrap_or(0.0);

        // Flip both data switches. On the next rising clock edge the register
        // should latch the swapped word.
        assert_eq!(probe.command("alter vd0 = 0"), 0, "alter vd0 was rejected");
        assert_eq!(probe.command("alter vd1 = 5"), 0, "alter vd1 was rejected");

        let resume_started = Instant::now();
        assert_eq!(probe.command("bg_resume"), 0, "bg_resume was rejected");
        let resumed = probe.await_running(true, Duration::from_secs(5));
        let resume_latency = resume_started.elapsed();

        // Two more clock periods past the halt, so at least one rising edge is
        // guaranteed to fall after the resume.
        let deadline = Instant::now() + Duration::from_secs(60);
        let mut reached = halted_at;
        while reached < halted_at + 4.5 {
            let time = probe.snapshot(&["time"]).pop().unwrap_or_default();
            reached = time.last().copied().unwrap_or(reached);
            if Instant::now() >= deadline {
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }

        let after = probe.snapshot(&["time", "q0", "q1"]);
        probe.command("bg_halt");
        probe.await_running(false, Duration::from_secs(5));

        println!(
            "1E-D(xspice) halted at t = {halted_at:.3} s after {:.1} ms, resumed in {:.1} ms (running again: {}), ran on to t = {reached:.3} s",
            halt_latency.as_secs_f64() * 1e3,
            resume_latency.as_secs_f64() * 1e3,
            resumed.is_some()
        );
        println!(
            "1E-D(xspice) Q0 {latched_q0:.3} V -> {:.3} V, Q1 {latched_q1:.3} V -> {:.3} V (D0/D1 swapped 5/0 -> 0/5 at the halt)",
            tail_mean(&after[1], 8),
            tail_mean(&after[2], 8)
        );

        let kept = before[1].len().min(after[1].len());
        assert_eq!(
            &after[1][..kept],
            &before[1][..kept],
            "resuming across an event boundary rewrote Q0 samples the plot had already shown"
        );
        assert_eq!(
            &after[0][..kept],
            &before[0][..kept],
            "resuming across an event boundary rewrote the time axis"
        );
        assert!(
            after[0].windows(2).all(|pair| pair[1] > pair[0]),
            "the time axis stopped being monotonic across the event-boundary seam"
        );
        assert!(
            resumed.is_some(),
            "bg_resume did not restart the XSPICE run"
        );
        assert!(
            after[1].len() > before[1].len(),
            "no samples appeared after resuming the XSPICE run"
        );
        // The register held 01 before the switch flip and must hold 10 after
        // the first rising edge that follows the resume. Anything else means
        // the event queue and the analog solver did not come back in step.
        assert!(
            latched_q0 > 4.0 && latched_q1 < 1.0,
            "the register did not latch D0=1,D1=0 before the halt (Q0 {latched_q0:.3} V, Q1 {latched_q1:.3} V)"
        );
        assert!(
            tail_mean(&after[1], 8) < 1.0 && tail_mean(&after[2], 8) > 4.0,
            "after the flip and resume the register did not latch D0=0,D1=1 (Q0 {:.3} V, Q1 {:.3} V)",
            tail_mean(&after[1], 8),
            tail_mean(&after[2], 8)
        );
    }

    // ── (e) ngSpice_SetBkpt ────────────────────────────────────────────────

    #[test]
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn live_1e_e_setbkpt_forces_sample_instants_but_does_not_pace_the_run() {
        let _guard = real_engine_test_guard();
        let mut probe = LiveEngine::open();

        // A breakpoint is a property of a loaded circuit, so this is also the
        // proof that the ordering a live UI would need (circ, then breakpoints,
        // then bg_run) is the ordering the API accepts.
        assert!(
            !unsafe { (probe.engine.api.set_bkpt)(1e-3) },
            "SetBkpt claimed success with no circuit loaded"
        );
        // That refusal is reported through `SendChar` as "Error: no circuit
        // loaded", which `circ_lines` would then read as this deck's own fatal
        // error. Drain it: the message belongs to the probe above, not to the
        // load below.
        take_messages(&probe.engine.callback_state);
        probe.load(LIVE_ACTUATION_DECK);

        // Deliberately off the 10 us output grid: if these instants show up in
        // the time vector they can only have come from the breakpoints.
        let wanted = [1.234_5e-3, 2.777_7e-3, 4.111_1e-3];
        for time in wanted {
            assert!(
                unsafe { (probe.engine.api.set_bkpt)(time) },
                "SetBkpt({time}) was refused on a loaded circuit"
            );
        }

        assert_eq!(probe.command("bg_run"), 0, "bg_run was rejected");
        probe
            .await_running(true, Duration::from_secs(5))
            .expect("ngSpice_running never went true after bg_run");
        // Let the run pass every requested instant with room to spare.
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            let time = probe.snapshot(&["time"]).pop().unwrap_or_default();
            if time.last().copied().unwrap_or(0.0) > 5e-3 || Instant::now() >= deadline {
                break;
            }
            thread::sleep(Duration::from_millis(5));
        }

        let axis = probe.snapshot(&["time"]).pop().unwrap_or_default();
        probe.command("bg_halt");
        probe.await_running(false, Duration::from_secs(5));

        let mut landed = Vec::new();
        for time in wanted {
            let nearest = axis
                .iter()
                .map(|sample| (sample - time).abs())
                .fold(f64::INFINITY, f64::min);
            landed.push(nearest);
            println!("1E-E breakpoint {time:.6e} s: nearest sample is {nearest:.3e} s away");
        }
        println!(
            "1E-E the run reached t = {:.6e} s in the background and never paused at a breakpoint",
            axis.last().copied().unwrap_or(0.0)
        );

        // What SetBkpt buys a live UI: the solver can be made to land EXACTLY
        // on a chosen instant, so a slice boundary is a real solved point
        // rather than an interpolation. What it does not buy is pacing - the
        // run does not stop there and nothing is notified, so wall clock has
        // to be mapped to circuit time by the host reading the time vector and
        // deciding when to halt.
        for (time, nearest) in wanted.iter().zip(landed.iter()) {
            assert!(
                *nearest <= time.abs() * 1e-12,
                "SetBkpt({time}) did not produce a solved point at that instant (nearest {nearest:.3e} s)"
            );
        }
    }
}
