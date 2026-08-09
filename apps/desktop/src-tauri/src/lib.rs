mod credentials;
mod external_url;
mod local_ai;
mod ltspice_library;
mod project_fs;
mod spice;
mod step_expand;
pub mod staged_engine;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(local_ai::LocalAiState::default())
        .manage(spice::NativeSpiceState::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            credentials::has_assistant_api_key,
            credentials::save_assistant_api_key,
            credentials::has_provider_api_key,
            credentials::save_provider_api_key,
            credentials::cloud_ai_proxy,
            local_ai::local_ai_status,
            local_ai::install_local_ai_runtime,
            local_ai::start_local_ai,
            local_ai::stop_local_ai,
            ltspice_library::discover_installed_ltspice_library,
            ltspice_library::read_installed_ltspice_model,
            project_fs::authorize_project_directory,
            project_fs::create_project_directory,
            project_fs::create_project_text_file_exclusive,
            project_fs::move_project_entry,
            external_url::open_external_url,
            spice::simulate_spice,
            spice::cancel_spice
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

pub fn maybe_run_spice_worker() -> bool {
    spice::maybe_run_spice_worker()
}
