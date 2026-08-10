use std::{
    env,
    ffi::OsString,
    fs,
    io::{Read, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};

use serde::Serialize;
use tauri::State;

const LOCAL_AI_HOST: &str = "127.0.0.1";
const LOCAL_AI_PORT: u16 = 8080;
const LOCAL_AI_ENDPOINT: &str = "http://127.0.0.1:8080/v1";
const RELEASE_ALLOWED_ORIGINS: &str = "tauri://localhost,http://tauri.localhost";
const DEV_ALLOWED_ORIGINS: &str =
    "tauri://localhost,http://tauri.localhost,http://localhost:1420,http://127.0.0.1:1420";

const fn allowed_origins() -> &'static str {
    if cfg!(debug_assertions) {
        DEV_ALLOWED_ORIGINS
    } else {
        RELEASE_ALLOWED_ORIGINS
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ModelPreset {
    id: String,
    repository: String,
    label: String,
    download_mb: u32,
}

fn model_presets() -> [ModelPreset; 2] {
    [
        ModelPreset {
            id: "qwen3-1.7b-4bit".to_string(),
            repository: "Qwen/Qwen3-1.7B-MLX-4bit".to_string(),
            label: "Qwen3 1.7B · 4-bit".to_string(),
            download_mb: 914,
        },
        ModelPreset {
            id: "qwen3-4b-4bit".to_string(),
            repository: "Qwen/Qwen3-4B-MLX-4bit".to_string(),
            label: "Qwen3 4B · 4-bit".to_string(),
            download_mb: 2_300,
        },
    ]
}

fn preset_by_id(id: &str) -> Result<ModelPreset, String> {
    model_presets()
        .into_iter()
        .find(|preset| preset.id == id)
        .ok_or_else(|| "Tau does not recognize that local model preset.".to_string())
}

fn valid_hugging_face_repository(repository: &str) -> bool {
    let mut parts = repository.split('/');
    let valid_part = |part: &str| {
        !part.is_empty()
            && part.len() <= 96
            && part
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    };
    matches!((parts.next(), parts.next(), parts.next()), (Some(owner), Some(model), None) if valid_part(owner) && valid_part(model))
}

fn resolve_model(model_id: &str, repository: Option<String>) -> Result<ModelPreset, String> {
    if let Ok(preset) = preset_by_id(model_id) {
        return Ok(preset);
    }
    let repository = repository
        .filter(|value| valid_hugging_face_repository(value))
        .ok_or_else(|| {
            "Enter a valid Hugging Face MLX repository as owner/model-name.".to_string()
        })?;
    if model_id != format!("custom:{repository}") {
        return Err("The imported local model id does not match its repository.".to_string());
    }
    let label = repository
        .split('/')
        .next_back()
        .unwrap_or(&repository)
        .to_string();
    Ok(ModelPreset {
        id: model_id.to_string(),
        repository,
        label,
        download_mb: 0,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiPresetInfo {
    id: String,
    repository: String,
    label: String,
    download_mb: u32,
    downloaded: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiStatus {
    state: &'static str,
    endpoint: &'static str,
    managed: bool,
    installed: bool,
    model_id: Option<String>,
    model_repository: Option<String>,
    detail: String,
    presets: Vec<LocalAiPresetInfo>,
}

struct LocalAiProcess {
    child: Child,
    preset: ModelPreset,
}

impl Drop for LocalAiProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Default)]
pub struct LocalAiState(Mutex<Option<LocalAiProcess>>);

/// The process facts that must be read while holding [`LocalAiState`]'s mutex.
/// The loopback readiness check deliberately is not part of this snapshot: a
/// healthy MLX server can take up to 400 ms to answer it, and Settings plus the
/// assistant may poll status concurrently while a model is loading. Keeping
/// that socket wait out of the process lock lets Stop acquire the lock and
/// terminate the child promptly instead of waiting behind health checks.
enum LocalAiStatusSnapshot {
    Managed(ModelPreset),
    Exited(ModelPreset, String),
    InspectionError(ModelPreset, String),
    NoManagedProcess,
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn executable_in_path(name: &str) -> Option<PathBuf> {
    env::var_os("PATH").and_then(|paths| {
        env::split_paths(&paths)
            .map(|directory| directory.join(name))
            .find(|candidate| candidate.is_file())
    })
}

fn require_apple_silicon() -> Result<(), String> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        Ok(())
    }
    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    {
        Err("Local MLX inference requires an Apple silicon Mac.".to_string())
    }
}

/// Pinned Astral uv release used when the Mac has no uv yet. URL + sha256 are
/// fixed so the installer never follows a floating "latest" redirect.
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
const UV_BOOTSTRAP_VERSION: &str = "0.11.28";
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
const UV_BOOTSTRAP_URL: &str =
    "https://github.com/astral-sh/uv/releases/download/0.11.28/uv-aarch64-apple-darwin.tar.gz";
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
const UV_BOOTSTRAP_SHA256: &str =
    "33540eb7c883ab857eff79bd5ac2aa31fe27b595abecb4a9c003a2c998447232";

fn tau_support_bin_dir() -> Option<PathBuf> {
    home_dir().map(|home| {
        home.join("Library")
            .join("Application Support")
            .join("com.tau.desktop")
            .join("bin")
    })
}

fn mlx_server_executable() -> Option<PathBuf> {
    if let Some(explicit) = env::var_os("TAU_MLX_LM_SERVER").filter(|value| !value.is_empty()) {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Some(path);
        }
    }

    if let Some(path) = executable_in_path("mlx_lm.server") {
        return Some(path);
    }

    let candidates = [
        home_dir().map(|home| home.join(".local/bin/mlx_lm.server")),
        Some(PathBuf::from("/opt/homebrew/bin/mlx_lm.server")),
        Some(PathBuf::from("/usr/local/bin/mlx_lm.server")),
    ];
    candidates.into_iter().flatten().find(|path| path.is_file())
}

fn uv_executable() -> Option<PathBuf> {
    if let Some(explicit) = env::var_os("TAU_UV").filter(|value| !value.is_empty()) {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Some(path);
        }
    }

    if let Some(path) = executable_in_path("uv") {
        return Some(path);
    }

    let candidates = [
        tau_support_bin_dir().map(|dir| dir.join("uv")),
        home_dir().map(|home| home.join(".local/bin/uv")),
        home_dir().map(|home| home.join(".cargo/bin/uv")),
        Some(PathBuf::from("/opt/homebrew/bin/uv")),
        Some(PathBuf::from("/usr/local/bin/uv")),
    ];
    candidates.into_iter().flatten().find(|path| path.is_file())
}

fn sha256_hex(path: &Path) -> Result<String, String> {
    let output = Command::new("/usr/bin/shasum")
        .args(["-a", "256"])
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| format!("Could not checksum download: {error}"))?;
    if !output.status.success() {
        return Err("Could not checksum the uv download.".to_string());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let hash = text
        .split_whitespace()
        .next()
        .ok_or_else(|| "Could not parse uv download checksum.".to_string())?;
    Ok(hash.to_ascii_lowercase())
}

/// Downloads the pinned Apple-silicon uv binary into Tau's Application Support
/// bin directory when none is already on PATH. Uses only /usr/bin/curl and
/// /usr/bin/tar with a fixed URL and sha256.
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn bootstrap_uv() -> Result<PathBuf, String> {
    let bin_dir = tau_support_bin_dir()
        .ok_or_else(|| "Could not resolve Tau's Application Support directory.".to_string())?;
    fs::create_dir_all(&bin_dir)
        .map_err(|error| format!("Could not create Tau support directory: {error}"))?;
    let dest = bin_dir.join("uv");
    if dest.is_file() {
        return Ok(dest);
    }

    let staging = env::temp_dir().join(format!(
        "tau-uv-bootstrap-{}-{}",
        UV_BOOTSTRAP_VERSION,
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging)
        .map_err(|error| format!("Could not create uv bootstrap staging: {error}"))?;
    let archive = staging.join("uv-aarch64-apple-darwin.tar.gz");

    let curl = Command::new("/usr/bin/curl")
        .args([
            "-fsSL",
            "--proto",
            "=https",
            "--tlsv1.2",
            UV_BOOTSTRAP_URL,
            "-o",
        ])
        .arg(&archive)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .status()
        .map_err(|error| format!("Could not download uv: {error}"))?;
    if !curl.success() {
        let _ = fs::remove_dir_all(&staging);
        return Err(format!(
            "Could not download uv {UV_BOOTSTRAP_VERSION}. Check your network and try again."
        ));
    }

    let actual = sha256_hex(&archive)?;
    if actual != UV_BOOTSTRAP_SHA256 {
        let _ = fs::remove_dir_all(&staging);
        return Err("Downloaded uv failed checksum verification. Aborting install.".to_string());
    }

    let extract = Command::new("/usr/bin/tar")
        .args(["-xzf"])
        .arg(&archive)
        .arg("-C")
        .arg(&staging)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .status()
        .map_err(|error| format!("Could not extract uv: {error}"))?;
    if !extract.success() {
        let _ = fs::remove_dir_all(&staging);
        return Err("Could not extract the uv archive.".to_string());
    }

    let extracted = staging.join("uv");
    if !extracted.is_file() {
        let _ = fs::remove_dir_all(&staging);
        return Err("uv archive did not contain the expected binary.".to_string());
    }
    fs::copy(&extracted, &dest).map_err(|error| format!("Could not install uv: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&dest)
            .map_err(|error| format!("Could not read uv permissions: {error}"))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&dest, perms)
            .map_err(|error| format!("Could not set uv executable bit: {error}"))?;
    }
    let _ = fs::remove_dir_all(&staging);
    Ok(dest)
}

#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
fn bootstrap_uv() -> Result<PathBuf, String> {
    Err("Automatic uv install is only available on Apple silicon Macs.".to_string())
}

fn ensure_uv() -> Result<PathBuf, String> {
    if let Some(existing) = uv_executable() {
        return Ok(existing);
    }
    bootstrap_uv()
}

/// Installs the audited MLX LM tool only. Arguments are fixed; the renderer
/// cannot pass a package name, index URL, or shell string.
fn install_mlx_lm_with_uv(uv: &Path) -> Result<(), String> {
    let output = Command::new(uv)
        .args(["tool", "install", "mlx-lm"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| format!("Could not launch uv to install MLX LM: {error}"))?;

    if output.status.success() {
        if mlx_server_executable().is_some() {
            return Ok(());
        }
        return Err(
            "uv reported success, but mlx_lm.server is still missing from PATH. Reopen Tau after installing."
                .to_string(),
        );
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let detail = [stderr.trim(), stdout.trim()]
        .into_iter()
        .find(|text| !text.is_empty())
        .unwrap_or("uv tool install mlx-lm failed.");
    Err(format!("Could not install MLX LM: {detail}"))
}

fn hugging_face_cache_root() -> Option<PathBuf> {
    env::var_os("HF_HUB_CACHE")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            env::var_os("HF_HOME")
                .filter(|value| !value.is_empty())
                .map(|value| PathBuf::from(value).join("hub"))
        })
        .or_else(|| home_dir().map(|home| home.join(".cache/huggingface/hub")))
}

fn model_cache_directory(preset: &ModelPreset) -> Option<PathBuf> {
    let encoded = format!("models--{}", preset.repository.replace('/', "--"));
    hugging_face_cache_root().map(|root| root.join(encoded))
}

fn model_snapshot_is_complete(snapshot: &Path) -> bool {
    snapshot.join("config.json").is_file()
        && snapshot.join("tokenizer.json").is_file()
        && snapshot.join("model.safetensors").is_file()
}

fn model_is_downloaded(preset: &ModelPreset) -> bool {
    let Some(cache) = model_cache_directory(preset) else {
        return false;
    };
    let snapshots = cache.join("snapshots");
    fs::read_dir(snapshots).ok().is_some_and(|mut entries| {
        entries.any(|entry| {
            let Ok(entry) = entry else { return false };
            model_snapshot_is_complete(&entry.path())
        })
    })
}

fn endpoint_is_listening() -> bool {
    // A bare TCP probe reports a half-dead server (open listener, wedged
    // interpreter) as ready, so the assistant then fails on every request
    // while Settings insists everything is fine. Require an actual HTTP
    // response from the models endpoint.
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), LOCAL_AI_PORT);
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(80)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(400)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(200)));
    let request = format!(
        "GET /v1/models HTTP/1.1\r\nHost: {LOCAL_AI_HOST}:{LOCAL_AI_PORT}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut first_bytes = [0u8; 12];
    match stream.read(&mut first_bytes) {
        Ok(read) if read >= 12 => {
            first_bytes.starts_with(b"HTTP/1.1 200") || first_bytes.starts_with(b"HTTP/1.0 200")
        }
        _ => false,
    }
}

fn preset_info() -> Vec<LocalAiPresetInfo> {
    model_presets()
        .into_iter()
        .map(|preset| LocalAiPresetInfo {
            id: preset.id.to_string(),
            repository: preset.repository.to_string(),
            label: preset.label.to_string(),
            download_mb: preset.download_mb,
            downloaded: model_is_downloaded(&preset),
        })
        .collect()
}

fn status_with(
    state: &'static str,
    managed: bool,
    model: Option<&ModelPreset>,
    detail: impl Into<String>,
) -> LocalAiStatus {
    LocalAiStatus {
        state,
        endpoint: LOCAL_AI_ENDPOINT,
        managed,
        installed: mlx_server_executable().is_some(),
        model_id: model.map(|preset| preset.id.to_string()),
        model_repository: model.map(|preset| preset.repository.to_string()),
        detail: detail.into(),
        presets: preset_info(),
    }
}

fn unmanaged_listener_status() -> LocalAiStatus {
    status_with(
        "error",
        false,
        None,
        "Another app is blocking on-device AI that Tau did not start. Quit other local AI tools, then try again so circuit context is never sent to an unowned listener.",
    )
}

/// Build the managed-server status from one readiness probe. Calling the HTTP
/// probe twice here used to hold the process lock through two 400 ms socket
/// reads whenever the server was still warming up. The UI polls this command
/// while a model loads, so one observation must drive both the state and its
/// explanation.
fn managed_listener_status(preset: &ModelPreset, ready: bool) -> LocalAiStatus {
    status_with(
        if ready { "ready" } else { "starting" },
        true,
        Some(preset),
        if ready {
            "On-device AI is ready."
        } else {
            "Loading on-device AI…"
        },
    )
}

/// Like [`managed_listener_status`], preserve one loopback observation for
/// every displayed outcome after Tau stops its child process.
fn stopped_listener_status(listener_remains: bool) -> LocalAiStatus {
    status_with(
        if listener_remains { "error" } else { "stopped" },
        false,
        None,
        if listener_remains {
            "Another app is still using on-device AI. Tau will not send circuit context to it."
        } else {
            "On-device AI is off."
        },
    )
}

fn reject_unmanaged_listener(listening: bool) -> Result<(), String> {
    if listening {
        Err(
            "Another app is blocking on-device AI that Tau did not start. Quit other local AI tools, then try again."
                .to_string(),
        )
    } else {
        Ok(())
    }
}

fn local_ai_status_snapshot(slot: &mut Option<LocalAiProcess>) -> LocalAiStatusSnapshot {
    if let Some(process) = slot.as_mut() {
        match process.child.try_wait() {
            Ok(Some(exit)) => {
                let preset = process.preset.clone();
                *slot = None;
                return LocalAiStatusSnapshot::Exited(preset, exit.to_string());
            }
            Ok(None) => {
                return LocalAiStatusSnapshot::Managed(process.preset.clone());
            }
            Err(error) => {
                return LocalAiStatusSnapshot::InspectionError(
                    process.preset.clone(),
                    error.to_string(),
                );
            }
        }
    }

    LocalAiStatusSnapshot::NoManagedProcess
}

fn local_ai_status_from_snapshot(snapshot: LocalAiStatusSnapshot) -> LocalAiStatus {
    match snapshot {
        LocalAiStatusSnapshot::Exited(preset, exit) => status_with(
            "error",
            false,
            Some(&preset),
            format!("The MLX server exited with {exit}."),
        ),
        LocalAiStatusSnapshot::Managed(preset) => {
            managed_listener_status(&preset, endpoint_is_listening())
        }
        LocalAiStatusSnapshot::InspectionError(preset, error) => status_with(
            "error",
            true,
            Some(&preset),
            format!("Could not inspect the MLX server: {error}"),
        ),
        LocalAiStatusSnapshot::NoManagedProcess => {
            if endpoint_is_listening() {
                return unmanaged_listener_status();
            }

            let installed = mlx_server_executable().is_some();
            status_with(
                "stopped",
                false,
                None,
                if installed {
                    "On-device AI is installed. Choose Turn on to start."
                } else {
                    "On-device AI is not set up yet. Choose Turn on — Tau will install it on this Mac."
                },
            )
        }
    }
}

fn local_ai_status_inner(slot: &mut Option<LocalAiProcess>) -> LocalAiStatus {
    local_ai_status_from_snapshot(local_ai_status_snapshot(slot))
}

#[tauri::command]
pub fn local_ai_status(state: State<'_, LocalAiState>) -> Result<LocalAiStatus, String> {
    let snapshot = {
        let mut slot = state
            .0
            .lock()
            .map_err(|_| "The local AI process state is unavailable.".to_string())?;
        local_ai_status_snapshot(&mut slot)
    };
    Ok(local_ai_status_from_snapshot(snapshot))
}

#[tauri::command]
pub async fn install_local_ai_runtime(
    state: State<'_, LocalAiState>,
) -> Result<LocalAiStatus, String> {
    require_apple_silicon()?;

    {
        let mut slot = state
            .0
            .lock()
            .map_err(|_| "The local AI process state is unavailable.".to_string())?;
        if mlx_server_executable().is_some() {
            return Ok(local_ai_status_inner(&mut slot));
        }
    }

    let uv = ensure_uv()?;

    let uv_path = uv.clone();
    tauri::async_runtime::spawn_blocking(move || install_mlx_lm_with_uv(&uv_path))
        .await
        .map_err(|error| format!("MLX LM install task failed: {error}"))??;

    let mut slot = state
        .0
        .lock()
        .map_err(|_| "The local AI process state is unavailable.".to_string())?;
    Ok(local_ai_status_inner(&mut slot))
}

#[tauri::command]
pub fn start_local_ai(
    state: State<'_, LocalAiState>,
    model_id: String,
    allow_download: bool,
    repository: Option<String>,
) -> Result<LocalAiStatus, String> {
    require_apple_silicon()?;
    let preset = resolve_model(&model_id, repository)?;
    if !allow_download && !model_is_downloaded(&preset) {
        return Err(format!(
            "{} is not cached. Starting it downloads approximately {} MB; confirm the download in Settings first.",
            preset.label, preset.download_mb
        ));
    }

    let executable = mlx_server_executable().ok_or_else(|| {
        "On-device AI is not installed yet. Choose Turn on in Settings and Tau will set it up."
            .to_string()
    })?;
    let mut slot = state
        .0
        .lock()
        .map_err(|_| "The local AI process state is unavailable.".to_string())?;

    if slot.is_some() {
        return Ok(local_ai_status_inner(&mut slot));
    }
    reject_unmanaged_listener(endpoint_is_listening())?;

    // With cached weights, a Hugging Face Hub revision check on flaky or
    // absent network can crash mlx_lm.server at startup ("cannot schedule new
    // futures after interpreter shutdown"). Offline mode skips the check; it
    // is only safe when no download is needed.
    let mut command = Command::new(executable);
    if model_is_downloaded(&preset) {
        command.env("HF_HUB_OFFLINE", "1");
    }
    let child = command
        .args([
            OsString::from("--model"),
            OsString::from(&preset.repository),
            OsString::from("--host"),
            OsString::from(LOCAL_AI_HOST),
            OsString::from("--port"),
            OsString::from(LOCAL_AI_PORT.to_string()),
            OsString::from("--allowed-origins"),
            OsString::from(allowed_origins()),
            OsString::from("--temp"),
            OsString::from("0"),
            OsString::from("--max-tokens"),
            OsString::from("4096"),
            OsString::from("--log-level"),
            OsString::from("WARNING"),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Could not start MLX LM: {error}"))?;
    *slot = Some(LocalAiProcess {
        child,
        preset: preset.clone(),
    });
    Ok(status_with(
        "starting",
        true,
        Some(&preset),
        "Loading on-device AI…",
    ))
}

#[tauri::command]
pub fn stop_local_ai(state: State<'_, LocalAiState>) -> Result<LocalAiStatus, String> {
    let mut slot = state
        .0
        .lock()
        .map_err(|_| "The local AI process state is unavailable.".to_string())?;
    if let Some(mut process) = slot.take() {
        process
            .child
            .kill()
            .map_err(|error| format!("Could not stop local inference: {error}"))?;
        let _ = process.child.wait();
    }
    Ok(stopped_listener_status(endpoint_is_listening()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_tau_model_presets() {
        assert_eq!(
            preset_by_id("qwen3-1.7b-4bit").unwrap().repository,
            "Qwen/Qwen3-1.7B-MLX-4bit"
        );
        assert_eq!(
            preset_by_id("qwen3-4b-4bit").unwrap().repository,
            "Qwen/Qwen3-4B-MLX-4bit"
        );
        assert!(preset_by_id("../../arbitrary-script").is_err());
    }

    #[test]
    fn accepts_valid_imported_repositories_without_shell_syntax() {
        let custom = resolve_model(
            "custom:mlx-community/Circuit-Qwen-4bit",
            Some("mlx-community/Circuit-Qwen-4bit".to_string()),
        )
        .unwrap();
        assert_eq!(custom.repository, "mlx-community/Circuit-Qwen-4bit");
        assert!(resolve_model(
            "custom:bad;touch /tmp/nope",
            Some("bad;touch /tmp/nope".to_string())
        )
        .is_err());
        assert!(resolve_model("custom:other/model", Some("owner/model".to_string())).is_err());
    }

    #[test]
    fn maps_hugging_face_repositories_to_cache_directories() {
        let preset = preset_by_id("qwen3-4b-4bit").unwrap();
        let path = model_cache_directory(&preset).unwrap();
        assert!(path.ends_with(Path::new("models--Qwen--Qwen3-4B-MLX-4bit")));
    }

    #[test]
    fn incomplete_cache_snapshot_does_not_authorize_an_implicit_download() {
        let root = env::temp_dir().join(format!("tau-mlx-cache-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("config.json"), b"{}").unwrap();
        assert!(!model_snapshot_is_complete(&root));
        fs::write(root.join("tokenizer.json"), b"{}").unwrap();
        fs::write(root.join("model.safetensors"), b"weights").unwrap();
        assert!(model_snapshot_is_complete(&root));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn loopback_endpoint_is_fixed() {
        assert_eq!(LOCAL_AI_HOST, "127.0.0.1");
        assert_eq!(LOCAL_AI_ENDPOINT, "http://127.0.0.1:8080/v1");
        assert!(!allowed_origins().contains('*'));
        assert!(RELEASE_ALLOWED_ORIGINS.contains("tauri://localhost"));
        assert!(RELEASE_ALLOWED_ORIGINS.contains("http://tauri.localhost"));
        assert!(!RELEASE_ALLOWED_ORIGINS.contains("localhost:1420"));
        assert!(!RELEASE_ALLOWED_ORIGINS.contains("127.0.0.1:1420"));

        #[cfg(debug_assertions)]
        assert_eq!(allowed_origins(), DEV_ALLOWED_ORIGINS);
        #[cfg(not(debug_assertions))]
        assert_eq!(allowed_origins(), RELEASE_ALLOWED_ORIGINS);
    }

    #[test]
    fn unmanaged_listener_copy_never_claims_it_is_safe_to_use() {
        let status = unmanaged_listener_status();
        assert_eq!(status.state, "error");
        assert!(!status.managed);
        assert!(status.detail.contains("did not start"));
        assert!(reject_unmanaged_listener(true).is_err());
        assert!(reject_unmanaged_listener(false).is_ok());
    }

    #[test]
    fn one_endpoint_observation_drives_each_managed_status() {
        let preset = preset_by_id("qwen3-1.7b-4bit").unwrap();
        let ready = managed_listener_status(&preset, true);
        assert_eq!(ready.state, "ready");
        assert!(ready.managed);
        assert_eq!(ready.detail, "On-device AI is ready.");

        let starting = managed_listener_status(&preset, false);
        assert_eq!(starting.state, "starting");
        assert!(starting.managed);
        assert_eq!(starting.detail, "Loading on-device AI…");
    }

    #[test]
    fn one_endpoint_observation_drives_each_stopped_status() {
        let stopped = stopped_listener_status(false);
        assert_eq!(stopped.state, "stopped");
        assert!(!stopped.managed);
        assert_eq!(stopped.detail, "On-device AI is off.");

        let foreign_listener = stopped_listener_status(true);
        assert_eq!(foreign_listener.state, "error");
        assert!(!foreign_listener.managed);
        assert!(foreign_listener
            .detail
            .contains("will not send circuit context"));
    }

    #[test]
    fn empty_process_slot_snapshots_without_running_a_health_check() {
        let mut slot = None;
        assert!(matches!(
            local_ai_status_snapshot(&mut slot),
            LocalAiStatusSnapshot::NoManagedProcess
        ));
    }

    #[test]
    fn apple_silicon_gate_matches_host_architecture() {
        let result = require_apple_silicon();
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        assert!(result.is_ok());
        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        assert!(result.is_err());
    }

    #[test]
    fn pinned_uv_bootstrap_constants_are_consistent() {
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            assert!(UV_BOOTSTRAP_URL.contains(UV_BOOTSTRAP_VERSION));
            assert!(UV_BOOTSTRAP_URL.contains("uv-aarch64-apple-darwin.tar.gz"));
            assert_eq!(UV_BOOTSTRAP_SHA256.len(), 64);
            assert!(UV_BOOTSTRAP_SHA256.chars().all(|c| c.is_ascii_hexdigit()));
        }
    }
}
