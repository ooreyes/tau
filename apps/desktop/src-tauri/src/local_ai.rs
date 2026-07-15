use std::{
    env,
    ffi::OsString,
    fs,
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
        home_dir().map(|home| home.join(".local/bin/uv")),
        home_dir().map(|home| home.join(".cargo/bin/uv")),
        Some(PathBuf::from("/opt/homebrew/bin/uv")),
        Some(PathBuf::from("/usr/local/bin/uv")),
    ];
    candidates.into_iter().flatten().find(|path| path.is_file())
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
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), LOCAL_AI_PORT);
    TcpStream::connect_timeout(&address, Duration::from_millis(80)).is_ok()
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
            "MLX LM is not installed. Choose Install MLX LM to set up local inference on this Mac."
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

    let uv = uv_executable().ok_or_else(|| {
        "uv is not installed. Install uv from https://docs.astral.sh/uv/, then choose Install MLX LM in Tau."
            .to_string()
    })?;

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

    let child = Command::new(executable)
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
}
