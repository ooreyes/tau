use std::{env, path::PathBuf};

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("Cargo manifest path"));
    let library_name = match env::var("CARGO_CFG_TARGET_OS").as_deref() {
        Ok("windows") => "ngspice.dll",
        Ok("macos") => "libngspice.dylib",
        Ok(_) | Err(_) => "libngspice.so",
    };
    let engine_directory = manifest_dir.join("resources/ngspice/lib");
    let engine_library = engine_directory.join(library_name);

    println!("cargo:rerun-if-changed={}", engine_directory.display());
    if !engine_library.is_file() {
        panic!(
            "Tau requires a staged native ngspice library at {}. Run scripts/build-ngspice.sh from the repository root before building the desktop app.",
            engine_library.display()
        );
    }
    tauri_build::build()
}
