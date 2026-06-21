use std::{
    env,
    ffi::{c_char, c_int, c_void, CStr, CString},
    path::PathBuf,
    ptr, slice,
    sync::Mutex,
};

use libloading::Library;
use serde::{Deserialize, Serialize};
use tauri::State;

const MAX_VECTOR_LENGTH: usize = 2_000_000;

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
    fn load() -> Result<Self, String> {
        let candidates = library_candidates();
        let mut failures = Vec::new();
        for candidate in candidates {
            match unsafe { Library::new(&candidate) } {
                Ok(library) => match unsafe { Self::from_library(library, candidate.clone()) } {
                    Ok(engine) => return Ok(engine),
                    Err(error) => failures.push(format!("{}: {error}", candidate.display())),
                },
                Err(error) => failures.push(format!("{}: {error}", candidate.display())),
            }
        }
        Err(format!(
            "libngspice was not found. Set TAU_NGSPICE_LIB to a shared ngspice library. Checked: {}{}",
            library_candidates()
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
        Ok(Self {
            _library: library,
            api,
            callback_state,
            library_path,
        })
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

        let command = CString::new("run").expect("constant command has no NUL byte");
        let command_status = unsafe { (self.api.command)(command.as_ptr() as *mut c_char) };
        if command_status != 0 {
            return Err(with_engine_messages(
                &self.callback_state,
                format!("ngSpice_Command(run) failed with status {command_status}"),
            ));
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
    state: State<'_, NativeSpiceState>,
    request: SpiceRequest,
) -> Result<SpiceResult, String> {
    let mut engine = state
        .0
        .lock()
        .map_err(|_| "ngspice engine lock was poisoned.".to_string())?;
    if engine.is_none() {
        *engine = Some(SpiceEngine::load()?);
    }
    engine
        .as_mut()
        .expect("engine initialized above")
        .run(request)
}

fn library_candidates() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(path) = env::var_os("TAU_NGSPICE_LIB") {
        paths.push(PathBuf::from(path));
    }

    // These locations make a checked-out build work without a Homebrew install
    // and make a packaged macOS app load its bundled copy first.
    if let Ok(current_dir) = env::current_dir() {
        paths.push(current_dir.join("resources/ngspice/lib/libngspice.dylib"));
        paths.push(
            current_dir.join("apps/desktop/src-tauri/resources/ngspice/lib/libngspice.dylib"),
        );
    }
    if let Some(path) = bundled_library_path() {
        paths.push(path);
    }
    #[cfg(target_os = "macos")]
    {
        paths.extend([
            PathBuf::from("/opt/homebrew/opt/ngspice/lib/libngspice.dylib"),
            PathBuf::from("/opt/homebrew/lib/libngspice.dylib"),
            PathBuf::from("/usr/local/opt/ngspice/lib/libngspice.dylib"),
            PathBuf::from("/usr/local/lib/libngspice.dylib"),
        ]);
    }
    #[cfg(target_os = "linux")]
    {
        paths.extend([
            PathBuf::from("/usr/lib/libngspice.so"),
            PathBuf::from("/usr/local/lib/libngspice.so"),
        ]);
    }
    #[cfg(target_os = "windows")]
    {
        paths.push(PathBuf::from("ngspice.dll"));
    }
    let mut unique = Vec::new();
    for path in paths {
        if !unique.contains(&path) {
            unique.push(path);
        }
    }
    unique
}

#[cfg(target_os = "macos")]
fn bundled_library_path() -> Option<PathBuf> {
    let executable = env::current_exe().ok()?;
    let contents = executable.parent()?.parent()?;
    Some(contents.join("Resources/ngspice/lib/libngspice.dylib"))
}

#[cfg(not(target_os = "macos"))]
fn bundled_library_path() -> Option<PathBuf> {
    None
}

fn deck_lines(netlist: &str) -> Result<Vec<String>, String> {
    let lines = netlist
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    if lines.is_empty() {
        return Err("The ngspice netlist is empty.".to_string());
    }
    if !lines
        .iter()
        .any(|line| line.trim().eq_ignore_ascii_case(".end"))
    {
        return Err("The ngspice netlist must end with an .end card.".to_string());
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

#[cfg(test)]
mod tests {
    use super::{deck_lines, SpiceEngine, SpiceRequest};

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
    #[ignore = "requires TAU_NGSPICE_LIB pointing to libngspice"]
    fn runs_an_operating_point_with_the_real_ngspice_library() {
        let mut engine = SpiceEngine::load().expect("ngspice library should load");
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
    }
}
