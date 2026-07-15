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
const ALLOWED_ORIGINS: &str = "tauri://localhost,http://localhost:1420,http://127.0.0.1:1420";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ModelPreset {
    id: &'static str,
    repository: &'static str,
    label: &'static str,
    download_mb: u32,
}

const MODEL_PRESETS: [ModelPreset; 2] = [
    ModelPreset {
        id: "qwen3-1.7b-4bit",
        repository: "Qwen/Qwen3-1.7B-MLX-4bit",
        label: "Qwen3 1.7B · 4-bit",
        download_mb: 914,
    },
    ModelPreset {
        id: "qwen3-4b-4bit",
        repository: "Qwen/Qwen3-4B-MLX-4bit",
        label: "Qwen3 4B · 4-bit",
        download_mb: 2_300,
    },
];

fn preset_by_id(id: &str) -> Result<ModelPreset, String> {
    MODEL_PRESETS
        .iter()
        .copied()
        .find(|preset| preset.id == id)
        .ok_or_else(|| "Tau does not recognize that local model preset.".to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiPresetInfo {
    id: &'static str,
    repository: &'static str,
    label: &'static str,
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
    model_id: Option<&'static str>,
    model_repository: Option<&'static str>,
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

fn model_cache_directory(preset: ModelPreset) -> Option<PathBuf> {
    let encoded = format!("models--{}", preset.repository.replace('/', "--"));
    hugging_face_cache_root().map(|root| root.join(encoded))
}

fn model_snapshot_is_complete(snapshot: &Path) -> bool {
    snapshot.join("config.json").is_file()
        && snapshot.join("tokenizer.json").is_file()
        && snapshot.join("model.safetensors").is_file()
}

fn model_is_downloaded(preset: ModelPreset) -> bool {
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
        Ok(read) if read >= 12 => first_bytes.starts_with(b"HTTP/1.1 200") || first_bytes.starts_with(b"HTTP/1.0 200"),
        _ => false,
    }
}

fn preset_info() -> Vec<LocalAiPresetInfo> {
    MODEL_PRESETS
        .iter()
        .copied()
        .map(|preset| LocalAiPresetInfo {
            id: preset.id,
            repository: preset.repository,
            label: preset.label,
            download_mb: preset.download_mb,
            downloaded: model_is_downloaded(preset),
        })
        .collect()
}

fn status_with(
    state: &'static str,
    managed: bool,
    model: Option<ModelPreset>,
    detail: impl Into<String>,
) -> LocalAiStatus {
    LocalAiStatus {
        state,
        endpoint: LOCAL_AI_ENDPOINT,
        managed,
        installed: mlx_server_executable().is_some(),
        model_id: model.map(|preset| preset.id),
        model_repository: model.map(|preset| preset.repository),
        detail: detail.into(),
        presets: preset_info(),
    }
}

fn local_ai_status_inner(slot: &mut Option<LocalAiProcess>) -> LocalAiStatus {
    if let Some(process) = slot.as_mut() {
        match process.child.try_wait() {
            Ok(Some(exit)) => {
                let preset = process.preset;
                *slot = None;
                return status_with(
                    "error",
                    false,
                    Some(preset),
                    format!("The MLX server exited with {exit}."),
                );
            }
            Ok(None) => {
                return status_with(
                    if endpoint_is_listening() {
                        "ready"
                    } else {
                        "starting"
                    },
                    true,
                    Some(process.preset),
                    if endpoint_is_listening() {
                        "Local inference is ready."
                    } else {
                        "Loading model weights into unified memory…"
                    },
                );
            }
            Err(error) => {
                return status_with(
                    "error",
                    true,
                    Some(process.preset),
                    format!("Could not inspect the MLX server: {error}"),
                );
            }
        }
    }

    if endpoint_is_listening() {
        return status_with(
            "ready",
            false,
            None,
            "A loopback inference server is already listening. Tau will verify its model API before use.",
        );
    }

    let installed = mlx_server_executable().is_some();
    status_with(
        "stopped",
        false,
        None,
        if installed {
            "MLX LM is installed. Choose a model to start local inference."
        } else {
            "MLX LM is not installed. Choose Install MLX LM — Tau will set up the local runtime on this Mac."
        },
    )
}

#[tauri::command]
pub fn local_ai_status(state: State<'_, LocalAiState>) -> Result<LocalAiStatus, String> {
    let mut slot = state
        .0
        .lock()
        .map_err(|_| "The local AI process state is unavailable.".to_string())?;
    Ok(local_ai_status_inner(&mut slot))
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
) -> Result<LocalAiStatus, String> {
    require_apple_silicon()?;
    let preset = preset_by_id(&model_id)?;
    if !allow_download && !model_is_downloaded(preset) {
        return Err(format!(
            "{} is not cached. Starting it downloads approximately {} MB; confirm the download in Settings first.",
            preset.label, preset.download_mb
        ));
    }

    let executable = mlx_server_executable().ok_or_else(|| {
        "MLX LM is not installed. Choose Install MLX LM in Settings, or run `uv tool install mlx-lm`."
            .to_string()
    })?;
    let mut slot = state
        .0
        .lock()
        .map_err(|_| "The local AI process state is unavailable.".to_string())?;

    if slot.is_some() {
        return Ok(local_ai_status_inner(&mut slot));
    }
    if endpoint_is_listening() {
        return Ok(status_with(
            "ready",
            false,
            None,
            "A loopback inference server is already listening. Tau will use it without taking ownership.",
        ));
    }

    // With cached weights, a Hugging Face Hub revision check on flaky or
    // absent network can crash mlx_lm.server at startup ("cannot schedule new
    // futures after interpreter shutdown"). Offline mode skips the check; it
    // is only safe when no download is needed.
    let mut command = Command::new(executable);
    if model_is_downloaded(preset) {
        command.env("HF_HUB_OFFLINE", "1");
    }
    let child = command
        .args([
            OsString::from("--model"),
            OsString::from(preset.repository),
            OsString::from("--host"),
            OsString::from(LOCAL_AI_HOST),
            OsString::from("--port"),
            OsString::from(LOCAL_AI_PORT.to_string()),
            OsString::from("--allowed-origins"),
            OsString::from(ALLOWED_ORIGINS),
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
    *slot = Some(LocalAiProcess { child, preset });
    Ok(status_with(
        "starting",
        true,
        Some(preset),
        "Loading model weights into unified memory…",
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
    Ok(status_with(
        if endpoint_is_listening() {
            "ready"
        } else {
            "stopped"
        },
        false,
        None,
        if endpoint_is_listening() {
            "An external loopback inference server is still running."
        } else {
            "Local inference is stopped."
        },
    ))
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
    fn maps_hugging_face_repositories_to_cache_directories() {
        let preset = preset_by_id("qwen3-4b-4bit").unwrap();
        let path = model_cache_directory(preset).unwrap();
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
        assert!(!ALLOWED_ORIGINS.contains('*'));
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
