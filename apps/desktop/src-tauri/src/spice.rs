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

const MAX_VECTOR_LENGTH: usize = 2_000_000;
const MAX_TRANSFER_VALUES: usize = 8_000_000;
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
const MAX_WORKER_INPUT_BYTES: usize = MAX_NETLIST_BYTES + 64 * 1024;
const MAX_WORKER_OUTPUT_BYTES: usize = 256 * 1024 * 1024;
const MAX_WORKER_STDERR_BYTES: usize = 64 * 1024;
const WORKER_TIMEOUT: Duration = Duration::from_secs(120);
const WORKER_POLL_INTERVAL: Duration = Duration::from_millis(20);
const WORKER_ARG: &str = "--tau-spice-worker";
const WORKER_RESPONSE_MARKER: &[u8] = b"TAU_SPICE_RESPONSE_V1:";

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

#[repr(C)]
struct NgComplex {
    real: f64,
    imag: f64,
}

#[repr(C)]
struct VectorInfo {
    name: *mut c_char,
    vector_type: c_int,
    flags: i16,
    real_data: *mut f64,
    complex_data: *mut NgComplex,
    length: c_int,
}

#[derive(Default)]
struct CallbackState {
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

struct SpiceApi {
    init: NgSpiceInit,
    command: NgSpiceCommand,
    circ: NgSpiceCirc,
    cur_plot: NgSpiceCurPlot,
    all_plots: NgSpiceAllPlots,
    all_vecs: NgSpiceAllVecs,
    get_vec_info: NgGetVecInfo,
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

struct SpiceEngine {
    _library: Library,
    api: SpiceApi,
    callback_state: Box<CallbackState>,
    library_path: PathBuf,
    /** How many XSPICE code-model modules this engine actually loaded. Zero
     * means every A device in a deck is an unknown model type, which is a
     * property of the engine build rather than of the circuit. */
    codemodels_loaded: usize,
}

impl SpiceEngine {
    fn load(candidates: Vec<PathBuf>) -> Result<Self, String> {
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
        #[cfg(unix)]
        let staged_dir = PathBuf::from("/tmp/tau-ngspice-codemodels");
        #[cfg(not(unix))]
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
        let vectors = self.read_vectors(&plot, &mut transferred, MAX_TRANSFER_VALUES)?;

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
            match self.read_vectors(&name, &mut extra_transferred, MAX_EXTRA_PLOT_VALUES) {
                Ok(vectors) if !vectors.is_empty() => extra_plots.push(SpicePlot { name, vectors }),
                Ok(_) => {}
                Err(_) => omitted.push(name),
            }
        }

        let mut messages = take_messages(&self.callback_state);
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

    fn circ_lines(&mut self, lines: &[String]) -> Result<(), String> {
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
        let command = CString::new(command).map_err(|_| {
            "ngspice command contains a NUL byte.".to_string()
        })?;
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

    fn read_vectors(
        &self,
        plot: &str,
        transfer_values: &mut usize,
        transfer_limit: usize,
    ) -> Result<Vec<SpiceVector>, String> {
        let plot_name =
            CString::new(plot).map_err(|_| "ngspice returned an invalid plot name.".to_string())?;
        let vector_names = unsafe { (self.api.all_vecs)(plot_name.as_ptr() as *mut c_char) };
        if vector_names.is_null() {
            return Err(format!("ngspice returned no vectors for plot {plot}."));
        }
        let mut result = Vec::new();
        for index in 0..10_000 {
            let entry = unsafe { *vector_names.add(index) };
            if entry.is_null() {
                break;
            }
            let name = unsafe { c_string(entry) }.unwrap_or_default();
            let qualified = CString::new(format!("{plot}.{name}"))
                .map_err(|_| "ngspice vector name contains a NUL byte.".to_string())?;
            let info = unsafe { (self.api.get_vec_info)(qualified.as_ptr() as *mut c_char) };
            let info = if info.is_null() {
                let plain = CString::new(name.clone())
                    .map_err(|_| "ngspice vector name contains a NUL byte.".to_string())?;
                unsafe { (self.api.get_vec_info)(plain.as_ptr() as *mut c_char) }
            } else {
                info
            };
            if info.is_null() {
                continue;
            }
            let info = unsafe { &*info };
            let length = usize::try_from(info.length)
                .map_err(|_| format!("ngspice returned an invalid length for {name}."))?;
            if length > MAX_VECTOR_LENGTH {
                return Err(format!("ngspice vector {name} has {length} points, exceeding Tau's {MAX_VECTOR_LENGTH} point transfer limit."));
            }
            let scalar_values = length
                .checked_mul(if info.real_data.is_null() { 2 } else { 1 })
                .ok_or_else(|| {
                    "ngspice vector length overflowed Tau's transfer budget.".to_string()
                })?;
            *transfer_values = transfer_values
                .checked_add(scalar_values)
                .ok_or_else(|| "ngspice result overflowed Tau's transfer budget.".to_string())?;
            if *transfer_values > transfer_limit {
                return Err(format!(
                    "ngspice result has more than Tau's {} scalar-value transfer limit. Reduce stop time, output resolution, or circuit size.",
                    transfer_limit
                ));
            }
            let (real, imaginary) = if !info.real_data.is_null() {
                (
                    unsafe { slice::from_raw_parts(info.real_data, length) }.to_vec(),
                    None,
                )
            } else if !info.complex_data.is_null() {
                let values = unsafe { slice::from_raw_parts(info.complex_data, length) };
                (
                    values.iter().map(|value| value.real).collect(),
                    Some(values.iter().map(|value| value.imag).collect()),
                )
            } else {
                (Vec::new(), None)
            };
            result.push(SpiceVector {
                name,
                real,
                imaginary,
            });
        }
        Ok(result)
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

    let response = match read_worker_request() {
        Ok(worker) => match SpiceEngine::load(worker.library_candidates)
            .and_then(|mut engine| engine.run(worker.request))
        {
            Ok(result) => WorkerResponse {
                result: Some(result),
                error: None,
            },
            Err(error) => WorkerResponse {
                result: None,
                error: Some(error),
            },
        },
        Err(error) => WorkerResponse {
            result: None,
            error: Some(error),
        },
    };

    let encoded = serde_json::to_vec(&response).unwrap_or_else(|error| {
        format!(r#"{{"result":null,"error":"Could not encode worker response: {error}"}}"#)
            .into_bytes()
    });
    let mut stdout = std::io::stdout().lock();
    let _ = stdout.write_all(WORKER_RESPONSE_MARKER);
    let _ = stdout.write_all(&encoded);
    let _ = stdout.flush();
    true
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
        if started.elapsed() >= timeout {
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
            Ok(None) => thread::sleep(WORKER_POLL_INTERVAL),
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
    let marker = stdout
        .windows(WORKER_RESPONSE_MARKER.len())
        .rposition(|window| window == WORKER_RESPONSE_MARKER)
        .ok_or_else(|| {
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
        (None, Some(error)) => Err(error),
        _ => Err("Tau's ngspice worker returned an inconsistent response.".to_string()),
    }
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

fn library_candidates(app: &AppHandle) -> Vec<PathBuf> {
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
fn missing_codemodel_message(lines: &[String], codemodels_loaded: usize) -> Option<String> {
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

fn deck_lines(netlist: &str) -> Result<Vec<String>, String> {
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

unsafe fn c_string(pointer: *mut c_char) -> Option<String> {
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

fn clear_callback_state(state: &CallbackState) {
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

fn take_messages(state: &CallbackState) -> Vec<String> {
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

/** ngSpice_Circ can return status 0 even after a parser/MIF failure. Without
 * this guard ngSpice_CurPlot then points at the previous successful circuit,
 * and Tau can accidentally receive stale vectors as if they belonged to the
 * new run. Treat only explicit fatal/error callback lines as failures; ordinary
 * convergence warnings stay attached to a valid result. */
fn fatal_engine_messages(state: &CallbackState) -> Option<String> {
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

#[cfg(test)]
mod tests {
    use std::{io::Cursor, path::PathBuf, sync::Mutex};

    use super::{
        deck_lines, fatal_engine_messages, library_file_name, missing_codemodel_message,
        read_bounded, record_engine_message, take_messages, CallbackState, SpiceEngine,
        SpiceRequest, WorkerResponse, MAX_ENGINE_MESSAGES, MAX_ENGINE_MESSAGE_BYTES,
    };

    // libngspice owns process-global callback and circuit state. Cargo runs
    // ignored tests in parallel by default, so independent `SpiceEngine`
    // instances can otherwise race inside the same native library and abort
    // the test process. Keep the real-library proofs deterministic without
    // weakening ordinary unit-test parallelism.
    static REAL_ENGINE_TEST: Mutex<()> = Mutex::new(());

    fn real_engine_test_guard() -> std::sync::MutexGuard<'static, ()> {
        REAL_ENGINE_TEST
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
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
    fn worker_error_response_round_trips_without_an_ambiguous_success() {
        let response = WorkerResponse {
            result: None,
            error: Some("intentional failure".to_string()),
        };
        let encoded = serde_json::to_vec(&response).expect("response encodes");
        let decoded: WorkerResponse = serde_json::from_slice(&encoded).expect("response decodes");
        assert!(decoded.result.is_none());
        assert_eq!(decoded.error.as_deref(), Some("intentional failure"));
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
            result.extra_plots.iter().map(|p| &p.name).collect::<Vec<_>>()
        );
        let vout_at = |vectors: &[super::SpiceVector]| {
            vectors
                .iter()
                .find(|v| v.name.eq_ignore_ascii_case("out") || v.name.eq_ignore_ascii_case("v(out)"))
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
}
