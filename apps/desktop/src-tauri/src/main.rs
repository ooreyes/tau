// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if tau_lib::maybe_run_spice_worker() {
        return;
    }
    tau_lib::run()
}
