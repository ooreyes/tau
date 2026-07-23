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

unsafe extern "C" fn on_data(
    _values: *mut c_void,
    _count: c_int,
    _ident: c_int,
    _user_data: *mut c_void,
) -> c_int {
    0
}

unsafe extern "C" fn on_init_data(
    _info: *mut c_void,
    _ident: c_int,
    _user_data: *mut c_void,
) -> c_int {
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
pub struct SpiceResult {
    pub plot: String,
    pub vectors: Vec<SpiceVector>,
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
                Some(on_data),
                Some(on_init_data),
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
        let names = [
            "spice2poly.cm",
            "analog.cm",
            "digital.cm",
            "xtradev.cm",
            "xtraevt.cm",
            "table.cm",
            "tlines.cm",
        ];

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
        for name in names {
            let source = codemodel_dir.join(name);
            if !source.is_file() {
                continue;
            }
            let destination = staged_dir.join(name);
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

        for name in names {
            let path = staged_dir.join(name);
            if !path.is_file() {
                continue;
            }
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
        clear_callback_state(&self.callback_state);
        Ok(())
    }

    fn run(&mut self, request: SpiceRequest) -> Result<SpiceResult, String> {
        let lines = deck_lines(&request.netlist)?;
        clear_callback_state(&self.callback_state);

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

        let command = CString::new("run").expect("constant command has no NUL byte");
        let command_status = unsafe { (self.api.command)(command.as_ptr() as *mut c_char) };
        if command_status != 0 {
            return Err(with_engine_messages(
                &self.callback_state,
                format!("ngSpice_Command(run) failed with status {command_status}"),
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

        let plot = unsafe { c_string((self.api.cur_plot)()) }.ok_or_else(|| {
            with_engine_messages(
                &self.callback_state,
                "ngspice did not produce a plot.".to_string(),
            )
        })?;
        let vectors = self.read_vectors(&plot)?;
        Ok(SpiceResult {
            plot,
            vectors,
            messages: take_messages(&self.callback_state),
            library_path: self.library_path.display().to_string(),
        })
    }

    fn read_vectors(&self, plot: &str) -> Result<Vec<SpiceVector>, String> {
        let plot_name =
            CString::new(plot).map_err(|_| "ngspice returned an invalid plot name.".to_string())?;
        let vector_names = unsafe { (self.api.all_vecs)(plot_name.as_ptr() as *mut c_char) };
        if vector_names.is_null() {
            return Err(format!("ngspice returned no vectors for plot {plot}."));
        }
        let mut result = Vec::new();
        let mut transfer_values = 0_usize;
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
            transfer_values = transfer_values
                .checked_add(scalar_values)
                .ok_or_else(|| "ngspice result overflowed Tau's transfer budget.".to_string())?;
            if transfer_values > MAX_TRANSFER_VALUES {
                return Err(format!(
                    "ngspice result has more than Tau's {} scalar-value transfer limit. Reduce stop time, output resolution, or circuit size.",
                    MAX_TRANSFER_VALUES
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
        let trimmed = line.trim_start();
        let lower = trimmed.to_ascii_lowercase();
        // The embedded engine executes inside Tau's process and is not covered
        // by Tauri's filesystem scope. Reject every supported ngspice/XSPICE
        // file-backed form before the deck reaches it; model/source files must
        // be resolved and copied into a Tau-owned model representation instead.
        let compact = lower.split_whitespace().collect::<Vec<_>>().join(" ");
        if compact.contains("filesource")
            || compact.contains("file=")
            || compact.contains("file =")
            || compact.contains("filename=")
            || compact.contains("filename =")
            || compact.contains("pwl(file")
        {
            return Err(format!(
                "File-backed ngspice primitives on line {} are not permitted.",
                index + 1
            ));
        }
        if trimmed.starts_with('.') {
            let card = lower.split_whitespace().next().unwrap_or_default();
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
                    "Unsupported ngspice card on line {}: {card}.",
                    index + 1
                ));
            }
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
        let command = lower
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
    Ok(lines)
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
    use std::{io::Cursor, path::PathBuf};

    use super::{
        deck_lines, fatal_engine_messages, library_file_name, read_bounded, record_engine_message,
        take_messages, CallbackState, SpiceEngine, SpiceRequest, WorkerResponse,
        MAX_ENGINE_MESSAGES, MAX_ENGINE_MESSAGE_BYTES,
    };

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
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn runs_an_operating_point_with_the_real_ngspice_library() {
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

        let ac = engine
            .run(SpiceRequest {
                netlist: "Tau AC smoke test\nV1 in 0 AC 1\nR1 in out 1k\nC1 out 0 1u\n.ac dec 10 10 1Meg\n.end".to_string(),
            })
            .expect("AC analysis should solve");
        assert!(ac.vectors.iter().any(|vector| {
            vector.name.eq_ignore_ascii_case("frequency") && vector.real.len() > 10
        }));
        assert!(ac.vectors.iter().any(|vector| {
            vector.name.eq_ignore_ascii_case("out") && vector.imaginary.is_some()
        }));

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

        // Exact assistant 2-bit register regression: ngspice XSPICE d_dff
        // controls are active-high, so PRE/CLR are held at zero. On clock
        // rising edges at 1/3/5 ms the two outputs must sample 01, 11, 10.
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
}
