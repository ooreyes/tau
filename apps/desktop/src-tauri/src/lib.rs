mod local_ai;
mod project_fs;
mod spice;

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
            local_ai::local_ai_status,
            local_ai::start_local_ai,
            local_ai::stop_local_ai,
            project_fs::authorize_project_directory,
            project_fs::create_project_text_file_exclusive,
            project_fs::move_project_entry,
            spice::simulate_spice
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
