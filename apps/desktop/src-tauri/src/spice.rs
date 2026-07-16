use std::{
    ffi::{c_char, c_int, c_void, CStr, CString},
    path::PathBuf,
    ptr, slice,
    sync::Mutex,
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
    exit_message: Mutex<Option<String>>,
}

unsafe extern "C" fn on_char(text: *mut c_char, _ident: c_int, user_data: *mut c_void) -> c_int {
    if text.is_null() || user_data.is_null() {
        return 0;
    }
    let state = unsafe { &*(user_data as *const CallbackState) };
    let message = unsafe { CStr::from_ptr(text) }
        .to_string_lossy()
        .trim()
        .to_string();
    if !message.is_empty() {
        if let Ok(mut messages) = state.messages.lock() {
            messages.push(message);
        }
    }
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpiceRequest {
    /// A complete, newline-separated SPICE deck with an analysis card and `.end`.
    pub netlist: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpiceVector {
    pub name: String,
    pub real: Vec<f64>,
    pub imaginary: Option<Vec<f64>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpiceResult {
    pub plot: String,
    pub vectors: Vec<SpiceVector>,
    pub messages: Vec<String>,
    pub library_path: String,
}

pub struct NativeSpiceState(Mutex<Option<SpiceEngine>>);

impl Default for NativeSpiceState {
    fn default() -> Self {
        Self(Mutex::new(None))
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
        for name in [
            "spice2poly.cm",
            "analog.cm",
            "digital.cm",
            "xtradev.cm",
            "xtraevt.cm",
            "table.cm",
            "tlines.cm",
        ] {
            let path = codemodel_dir.join(name);
            if !path.is_file() {
                continue;
            }
            // ngspice's command parser treats quotes as literal filename
            // characters for `codemodel`; backslash-escape path separators
            // understood by the parser instead.
            let escaped = path.display().to_string().replace(' ', "\\ ");
            let command = CString::new(format!("codemodel {escaped}")).map_err(|_| {
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
pub fn simulate_spice(
    app: AppHandle,
    state: State<'_, NativeSpiceState>,
    request: SpiceRequest,
) -> Result<SpiceResult, String> {
    let mut engine = state
        .0
        .lock()
        .map_err(|_| "ngspice engine lock was poisoned.".to_string())?;
    if engine.is_none() {
        *engine = Some(SpiceEngine::load(library_candidates(&app))?);
    }
    engine
        .as_mut()
        .expect("engine initialized above")
        .run(request)
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
        if trimmed.starts_with('.') {
            let card = lower.split_whitespace().next().unwrap_or_default();
            if !matches!(
                card,
                ".model" | ".option" | ".options" | ".tran" | ".op" | ".ac" | ".end"
            ) {
                return Err(format!(
                    "Unsupported ngspice card on line {}: {card}.",
                    index + 1
                ));
            }
        }
        let command = lower.split_whitespace().next().unwrap_or_default();
        if matches!(
            command,
            "shell"
                | "system"
                | "source"
                | "load"
                | "quit"
                | "exit"
                | "destroy"
                | "write"
                | "wrdata"
                | "cd"
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
    if let Ok(mut exit) = state.exit_message.lock() {
        *exit = None;
    }
}

fn take_messages(state: &CallbackState) -> Vec<String> {
    state
        .messages
        .lock()
        .map(|mut messages| std::mem::take(&mut *messages))
        .unwrap_or_default()
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
    use std::path::PathBuf;

    use super::{deck_lines, library_file_name, SpiceEngine, SpiceRequest};

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
    fn uses_the_platform_library_name() {
        let name = PathBuf::from(library_file_name());
        assert!(name.file_name().is_some());
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
