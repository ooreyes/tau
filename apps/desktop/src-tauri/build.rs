use std::{env, path::PathBuf};

#[path = "src/staged_engine.rs"]
mod staged_engine;

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("Cargo manifest path"));
    let target_os = env::var("CARGO_CFG_TARGET_OS").expect("Cargo target OS");
    let target_arch = env::var("CARGO_CFG_TARGET_ARCH").expect("Cargo target architecture");
    let library_name = match target_os.as_str() {
        "windows" => "ngspice.dll",
        "macos" => "libngspice.dylib",
        _ => "libngspice.so",
    };
    let resource_dir = manifest_dir.join("resources/ngspice");
    let engine_directory = resource_dir.join("lib");
    let engine_library = engine_directory.join(library_name);
    let build_script = manifest_dir.join("../../../scripts/build-ngspice.sh");

    println!("cargo:rerun-if-changed={}", engine_directory.display());
    println!(
        "cargo:rerun-if-changed={}",
        resource_dir.join("build-info.json").display()
    );
    println!("cargo:rerun-if-changed={}", build_script.display());
    if !engine_library.is_file() {
        panic!(
            "Tau requires a staged native ngspice library at {}. Run scripts/build-ngspice.sh from the repository root before building the desktop app.",
            engine_library.display()
        );
    }

    // A library loads whatever its provenance, and the staged tree is
    // gitignored, so a library being present is not evidence it is Tau's own
    // pinned build. This is the only step in the packaging path that can tell.
    let script = std::fs::read_to_string(&build_script).unwrap_or_else(|error| {
        panic!(
            "Could not read {} to learn which ngspice commit is pinned: {error}",
            build_script.display()
        )
    });
    let pinned_commit = staged_engine::pinned_commit(&script).unwrap_or_else(|| {
        panic!(
            "{} no longer declares NGSPICE_COMMIT, so the staged engine cannot be checked against the pinned build.",
            build_script.display()
        )
    });
    let expected_host = staged_engine::expected_host(&target_os, &target_arch).unwrap_or_else(|| {
        panic!(
            "scripts/build-ngspice.sh does not stage an ngspice resource for {target_os}-{target_arch}."
        )
    });
    if let Err(reason) = staged_engine::verify_staged_engine(
        &resource_dir,
        &pinned_commit,
        &expected_host,
        &format!("lib/{library_name}"),
    ) {
        panic!("{reason}");
    }

    tauri_build::build()
}
