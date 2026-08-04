/*!
 * Provenance check for the bundled ngspice resource.
 *
 * `scripts/build-ngspice.sh` builds ngspice at a pinned commit, stages it under
 * `src-tauri/resources/ngspice/`, and records what it produced in
 * `build-info.json`. That resource tree is gitignored, so no test can see the
 * tree that actually ships and nothing in git can vouch for it - which is how a
 * hand-placed system library sat here and would have been packaged as the
 * reproducible build. The check therefore runs from `build.rs`, the one step
 * every desktop build and every packaging run has to go through.
 *
 * The rule is that the staged tree must carry the record the build script
 * writes, the record must describe this build, and its SHA-256 map must exactly
 * cover the staged files. A library that arrived any other way has no record at
 * all; a resource changed after staging no longer matches it.
 */

use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    io::Read,
    path::{Path, PathBuf},
};

/**
 * The XSPICE code models `SpiceEngine::load_bundled_codemodels` loads at run
 * time. They live beside the library as separate modules, so an install that
 * produced none still looks like a working engine until a digital or
 * behavioral A device is simulated. The loader and the packaging check read
 * one list: a name that drifted apart would be staged and never loaded, or
 * loaded and never staged, in both cases silently.
 *
 * ngspice builds a seventh module, `table.cm`. It is deliberately absent: it
 * is licensed GPL v2 rather than Modified BSD, Tau emits no device that needs
 * it, and shipping it would put the whole product under the GPL for no
 * capability. `scripts/build-ngspice.sh` deletes it from the staged resource,
 * along with the `d_cosim` co-simulation tool chain, which carries GPL code
 * for the same non-reason. `THIRD_PARTY_NOTICES` states that Tau distributes
 * no GPL code. Do not add either back to get a file count to match.
 */
pub const REQUIRED_CODEMODELS: [&str; 6] = [
    "spice2poly.cm",
    "analog.cm",
    "digital.cm",
    "xtradev.cm",
    "xtraevt.cm",
    "tlines.cm",
];

/**
 * The commit `scripts/build-ngspice.sh` pins, read from the script itself so
 * the SHA has exactly one home. Returns `None` when the assignment is not
 * found, and the caller refuses on that: a rename that quietly turned this
 * check into a no-op is the failure mode worth catching.
 */
pub fn pinned_commit(script: &str) -> Option<String> {
    let line = script
        .lines()
        .find(|line| line.trim_start().starts_with("NGSPICE_COMMIT="))?;
    // The assignment is written as `NGSPICE_COMMIT="${NGSPICE_COMMIT:-<sha>}"`
    // so an operator can override the pin, which puts the name on the line
    // twice. The SHA is the only 40-character hex run on it.
    let bytes = line.as_bytes();
    let mut start = 0usize;
    while start < bytes.len() {
        if !bytes[start].is_ascii_hexdigit() {
            start += 1;
            continue;
        }
        let mut end = start;
        while end < bytes.len() && bytes[end].is_ascii_hexdigit() {
            end += 1;
        }
        if end - start == 40 {
            return Some(line[start..end].to_ascii_lowercase());
        }
        start = end;
    }
    None
}

/**
 * The `uname -s`-`uname -m` pair the build script records, for the target
 * being compiled rather than the machine compiling it. The two systems spell
 * 64-bit ARM differently - `uname -m` is `arm64` on macOS and `aarch64` on
 * Linux - so the mapping is per platform, not a shared architecture table.
 */
pub fn expected_host(target_os: &str, target_arch: &str) -> Option<String> {
    let system = match target_os {
        "macos" => "Darwin",
        "linux" => "Linux",
        _ => return None,
    };
    let machine = match (target_os, target_arch) {
        ("macos", "aarch64") => "arm64",
        (_, "aarch64") => "aarch64",
        (_, "x86_64") => "x86_64",
        _ => return None,
    };
    Some(format!("{system}-{machine}"))
}

/**
 * Read one string field out of the flat object `build-info.json` holds.
 * Deliberately not a typed deserialization: a record missing a field has to
 * name that field, and a record that gained one must not fail to parse.
 */
fn record_field(record: &serde_json::Value, field: &str) -> Result<String, String> {
    record
        .get(field)
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("build-info.json has no \"{field}\" string."))
}

fn collect_resource_files(resource_dir: &Path) -> Result<BTreeMap<String, PathBuf>, String> {
    fn visit(
        root: &Path,
        directory: &Path,
        files: &mut BTreeMap<String, PathBuf>,
    ) -> Result<(), String> {
        let entries = std::fs::read_dir(directory).map_err(|error| {
            format!(
                "Could not inspect staged resource directory {}: {error}",
                directory.display()
            )
        })?;
        for entry in entries {
            let entry = entry.map_err(|error| {
                format!(
                    "Could not inspect an entry under {}: {error}",
                    directory.display()
                )
            })?;
            let path = entry.path();
            let metadata = std::fs::symlink_metadata(&path).map_err(|error| {
                format!(
                    "Could not inspect staged resource {}: {error}",
                    path.display()
                )
            })?;
            if metadata.is_dir() {
                visit(root, &path, files)?;
                continue;
            }
            if !metadata.is_file() && !metadata.file_type().is_symlink() {
                return Err(format!(
                    "Staged resource {} is neither a file nor a supported symlink.",
                    path.display()
                ));
            }
            let relative = path.strip_prefix(root).map_err(|_| {
                format!(
                    "Staged resource {} escaped {}.",
                    path.display(),
                    root.display()
                )
            })?;
            let relative = relative
                .to_str()
                .ok_or_else(|| {
                    format!(
                        "Staged resource {} has a path build-info.json cannot represent.",
                        path.display()
                    )
                })?
                .replace('\\', "/");
            if relative == "build-info.json" || relative == ".gitkeep" {
                continue;
            }
            if metadata.file_type().is_symlink() {
                let target = std::fs::canonicalize(&path).map_err(|error| {
                    format!(
                        "Staged resource symlink {} cannot be resolved: {error}",
                        path.display()
                    )
                })?;
                let canonical_root = std::fs::canonicalize(root).map_err(|error| {
                    format!(
                        "Could not resolve staged resource root {}: {error}",
                        root.display()
                    )
                })?;
                if !target.starts_with(&canonical_root) || !target.is_file() {
                    return Err(format!(
                        "Staged resource symlink {} points outside the resource tree.",
                        path.display()
                    ));
                }
            }
            files.insert(relative, path);
        }
        Ok(())
    }

    let mut files = BTreeMap::new();
    visit(resource_dir, resource_dir, &mut files)?;
    Ok(files)
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path)
        .map_err(|error| format!("Could not read staged resource {}: {error}", path.display()))?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|error| {
            format!("Could not hash staged resource {}: {error}", path.display())
        })?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn verify_resource_digests(resource_dir: &Path, record: &serde_json::Value) -> Result<(), String> {
    let manifest = record
        .get("files")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| "build-info.json has no \"files\" digest object.".to_string())?;
    if manifest.is_empty() {
        return Err("build-info.json has an empty \"files\" digest object.".to_string());
    }
    let actual_files = collect_resource_files(resource_dir)?;
    for (relative, path) in &actual_files {
        let expected = manifest
            .get(relative)
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| {
                format!("build-info.json has no SHA-256 digest for staged resource {relative}.")
            })?;
        if expected.len() != 64 || !expected.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(format!(
                "build-info.json has a malformed SHA-256 digest for {relative}."
            ));
        }
        let actual = sha256_file(path)?;
        if !actual.eq_ignore_ascii_case(expected) {
            return Err(format!(
                "Staged ngspice resource {relative} failed SHA-256 verification (recorded {expected}, actual {actual}). Re-run scripts/build-ngspice.sh."
            ));
        }
    }
    for relative in manifest.keys() {
        if !actual_files.contains_key(relative) {
            return Err(format!(
                "build-info.json records {relative}, but that staged resource is missing."
            ));
        }
    }
    Ok(())
}

/**
 * Refuse a staged resource that the pinned build script did not produce for
 * this target. `resource_dir` is the staged `resources/ngspice` tree,
 * `library_relative` the path the loader will ask for inside it.
 *
 * The recorded repository is NOT compared. The script takes a mirror override
 * and verifies the checkout resolves to the pinned commit, so where the source
 * was fetched from carries no information the commit does not already carry -
 * comparing it would refuse a legitimate build.
 */
pub fn verify_staged_engine(
    resource_dir: &std::path::Path,
    pinned_commit: &str,
    expected_host: &str,
    library_relative: &str,
) -> Result<(), String> {
    let record_path = resource_dir.join("build-info.json");
    let Ok(text) = std::fs::read_to_string(&record_path) else {
        return Err(format!(
            "No provenance record at {}. The staged ngspice resource was not produced by scripts/build-ngspice.sh; run it from the repository root.",
            record_path.display()
        ));
    };
    let record: serde_json::Value = serde_json::from_str(&text)
        .map_err(|error| format!("{} is not readable JSON: {error}", record_path.display()))?;

    let commit = record_field(&record, "commit")?;
    if !commit.eq_ignore_ascii_case(pinned_commit) {
        return Err(format!(
            "The staged ngspice resource was built from commit {commit}, but scripts/build-ngspice.sh pins {pinned_commit}. Re-run the build script."
        ));
    }

    let host = record_field(&record, "host")?;
    if host != expected_host {
        return Err(format!(
            "The staged ngspice resource was built for {host}, but this is a {expected_host} build. Re-run the build script on the target platform."
        ));
    }

    let library = record_field(&record, "library")?;
    if library != library_relative {
        return Err(format!(
            "The staged ngspice resource records its library as {library}, but this build loads {library_relative}."
        ));
    }
    if !resource_dir.join(&library).exists() {
        return Err(format!(
            "The staged ngspice resource records {library}, which is not present under {}.",
            resource_dir.display()
        ));
    }

    // The code models are what an install can plausibly leave out while still
    // looking healthy, so they are named individually rather than counted.
    let codemodel_dir = resource_dir.join("lib/ngspice");
    let missing: Vec<&str> = REQUIRED_CODEMODELS
        .iter()
        .copied()
        .filter(|name| !codemodel_dir.join(name).is_file())
        .collect();
    if !missing.is_empty() {
        return Err(format!(
            "The staged ngspice resource is missing XSPICE code models under {}: {}. Digital and behavioral parts cannot run without them.",
            codemodel_dir.display(),
            missing.join(", ")
        ));
    }

    verify_resource_digests(resource_dir, &record)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    const COMMIT: &str = "67fbaa9e6a6d756fa23bf52c7b565fbe926fb9c6";

    fn stage(root: &Path, record: Option<&str>) {
        std::fs::create_dir_all(root.join("lib/ngspice")).expect("staged code-model dir");
        std::fs::write(root.join("lib/libngspice.dylib"), b"library").expect("staged library");
        for name in REQUIRED_CODEMODELS {
            std::fs::write(root.join("lib/ngspice").join(name), b"module").expect("staged module");
        }
        if let Some(record) = record {
            std::fs::write(root.join("build-info.json"), record).expect("staged record");
        }
    }

    fn record(commit: &str, host: &str, library: &str) -> String {
        let mut files = serde_json::Map::new();
        files.insert(
            "lib/libngspice.dylib".into(),
            serde_json::Value::String(format!("{:x}", Sha256::digest(b"library"))),
        );
        for name in REQUIRED_CODEMODELS {
            files.insert(
                format!("lib/ngspice/{name}"),
                serde_json::Value::String(format!("{:x}", Sha256::digest(b"module"))),
            );
        }
        serde_json::to_string_pretty(&serde_json::json!({
            "repository": "https://github.com/imr/ngspice.git",
            "commit": commit,
            "host": host,
            "library": library,
            "files": files,
        }))
        .expect("build record")
            + "\n"
    }

    fn verify(root: &Path) -> Result<(), String> {
        verify_staged_engine(root, COMMIT, "Darwin-arm64", "lib/libngspice.dylib")
    }

    #[test]
    fn accepts_the_resource_the_build_script_produces() {
        let dir = tempfile::tempdir().expect("temp dir");
        stage(
            dir.path(),
            Some(&record(COMMIT, "Darwin-arm64", "lib/libngspice.dylib")),
        );
        verify(dir.path()).expect("a complete staged resource");
    }

    /**
     * The failure that actually happened: a library placed by hand carries no
     * record, and the whole packaging path treated it as the pinned build.
     */
    #[test]
    fn refuses_a_staged_library_that_carries_no_record() {
        let dir = tempfile::tempdir().expect("temp dir");
        stage(dir.path(), None);
        let message = verify(dir.path()).expect_err("a resource with no build-info.json");
        assert!(message.contains("scripts/build-ngspice.sh"), "{message}");
    }

    #[test]
    fn refuses_a_resource_built_from_another_commit() {
        let dir = tempfile::tempdir().expect("temp dir");
        let stale = "0000000000000000000000000000000000000000";
        stage(
            dir.path(),
            Some(&record(stale, "Darwin-arm64", "lib/libngspice.dylib")),
        );
        let message = verify(dir.path()).expect_err("a resource built from a stale pin");
        assert!(message.contains(stale), "{message}");
        assert!(message.contains(COMMIT), "{message}");
    }

    #[test]
    fn refuses_a_resource_built_for_another_target() {
        let dir = tempfile::tempdir().expect("temp dir");
        stage(
            dir.path(),
            Some(&record(COMMIT, "Darwin-x86_64", "lib/libngspice.dylib")),
        );
        let message = verify(dir.path()).expect_err("a resource built for another architecture");
        assert!(message.contains("Darwin-x86_64"), "{message}");
    }

    #[test]
    fn refuses_a_record_naming_a_library_this_build_does_not_load() {
        let dir = tempfile::tempdir().expect("temp dir");
        stage(
            dir.path(),
            Some(&record(COMMIT, "Darwin-arm64", "lib/libngspice.so")),
        );
        let message = verify(dir.path()).expect_err("a record naming another platform's library");
        assert!(message.contains("libngspice.so"), "{message}");
    }

    #[test]
    fn refuses_a_record_whose_library_is_not_staged() {
        let dir = tempfile::tempdir().expect("temp dir");
        stage(
            dir.path(),
            Some(&record(COMMIT, "Darwin-arm64", "lib/libngspice.dylib")),
        );
        std::fs::remove_file(dir.path().join("lib/libngspice.dylib")).expect("remove library");
        let message = verify(dir.path()).expect_err("a record whose library is absent");
        assert!(message.contains("not present"), "{message}");
    }

    /** Each module is named, so a partial install says which one is missing. */
    #[test]
    fn refuses_and_names_each_missing_code_model() {
        for name in REQUIRED_CODEMODELS {
            let dir = tempfile::tempdir().expect("temp dir");
            stage(
                dir.path(),
                Some(&record(COMMIT, "Darwin-arm64", "lib/libngspice.dylib")),
            );
            std::fs::remove_file(dir.path().join("lib/ngspice").join(name))
                .expect("remove one module");
            let Err(message) = verify(dir.path()) else {
                panic!("a resource staged without {name} was accepted");
            };
            assert!(message.contains(name), "{name} unnamed in: {message}");
        }
    }

    #[test]
    fn refuses_a_malformed_record() {
        let dir = tempfile::tempdir().expect("temp dir");
        stage(dir.path(), Some("{ not json"));
        let message = verify(dir.path()).expect_err("a record that does not parse");
        assert!(message.contains("readable JSON"), "{message}");
    }

    #[test]
    fn refuses_a_record_missing_a_field() {
        let dir = tempfile::tempdir().expect("temp dir");
        stage(dir.path(), Some("{ \"host\": \"Darwin-arm64\" }"));
        let message = verify(dir.path()).expect_err("a record with no commit");
        assert!(message.contains("commit"), "{message}");
    }

    #[test]
    fn refuses_a_library_changed_after_staging() {
        let dir = tempfile::tempdir().expect("temp dir");
        stage(
            dir.path(),
            Some(&record(COMMIT, "Darwin-arm64", "lib/libngspice.dylib")),
        );
        std::fs::write(dir.path().join("lib/libngspice.dylib"), b"swapped")
            .expect("replace staged library");
        let message = verify(dir.path()).expect_err("a swapped library");
        assert!(message.contains("lib/libngspice.dylib"), "{message}");
        assert!(message.contains("SHA-256"), "{message}");
    }

    #[test]
    fn refuses_a_code_model_changed_after_staging() {
        let dir = tempfile::tempdir().expect("temp dir");
        stage(
            dir.path(),
            Some(&record(COMMIT, "Darwin-arm64", "lib/libngspice.dylib")),
        );
        std::fs::write(dir.path().join("lib/ngspice/digital.cm"), b"swapped")
            .expect("replace staged code model");
        let message = verify(dir.path()).expect_err("a swapped code model");
        assert!(message.contains("digital.cm"), "{message}");
        assert!(message.contains("SHA-256"), "{message}");
    }

    #[test]
    fn refuses_an_unrecorded_staged_file() {
        let dir = tempfile::tempdir().expect("temp dir");
        stage(
            dir.path(),
            Some(&record(COMMIT, "Darwin-arm64", "lib/libngspice.dylib")),
        );
        std::fs::write(dir.path().join("lib/ngspice/injected.cm"), b"payload")
            .expect("add unrecorded resource");
        let message = verify(dir.path()).expect_err("an unrecorded staged resource");
        assert!(message.contains("injected.cm"), "{message}");
        assert!(message.contains("no SHA-256"), "{message}");
    }

    #[test]
    fn refuses_a_malformed_digest() {
        let dir = tempfile::tempdir().expect("temp dir");
        let malformed = record(COMMIT, "Darwin-arm64", "lib/libngspice.dylib")
            .replace(&format!("{:x}", Sha256::digest(b"library")), "not-a-sha256");
        stage(dir.path(), Some(&malformed));
        let message = verify(dir.path()).expect_err("a malformed digest");
        assert!(message.contains("malformed SHA-256"), "{message}");
    }

    #[test]
    fn refuses_a_record_without_a_digest_map() {
        let dir = tempfile::tempdir().expect("temp dir");
        stage(
            dir.path(),
            Some(&format!(
                "{{\"commit\":\"{COMMIT}\",\"host\":\"Darwin-arm64\",\"library\":\"lib/libngspice.dylib\"}}"
            )),
        );
        let message = verify(dir.path()).expect_err("a record with no digest map");
        assert!(message.contains("files"), "{message}");
        assert!(message.contains("digest object"), "{message}");
    }

    #[test]
    #[cfg(unix)]
    fn refuses_a_staged_symlink_that_escapes_the_resource_tree() {
        let dir = tempfile::tempdir().expect("temp dir");
        stage(
            dir.path(),
            Some(&record(COMMIT, "Darwin-arm64", "lib/libngspice.dylib")),
        );
        let outside = tempfile::NamedTempFile::new().expect("external file");
        std::os::unix::fs::symlink(outside.path(), dir.path().join("lib/ngspice/escaped.cm"))
            .expect("escaping symlink");
        let message = verify(dir.path()).expect_err("a symlink outside the resource tree");
        assert!(message.contains("escaped.cm"), "{message}");
        assert!(message.contains("outside"), "{message}");
    }

    #[test]
    fn refuses_a_manifest_entry_whose_resource_is_missing() {
        let dir = tempfile::tempdir().expect("temp dir");
        let mut value: serde_json::Value =
            serde_json::from_str(&record(COMMIT, "Darwin-arm64", "lib/libngspice.dylib"))
                .expect("build record JSON");
        value["files"]["share/ngspice/spinit"] =
            serde_json::Value::String(format!("{:x}", Sha256::digest(b"missing")));
        let record = serde_json::to_string_pretty(&value).expect("modified record") + "\n";
        stage(dir.path(), Some(&record));
        let message = verify(dir.path()).expect_err("a recorded file that is absent");
        assert!(message.contains("share/ngspice/spinit"), "{message}");
        assert!(message.contains("missing"), "{message}");
    }

    #[test]
    fn reads_the_pin_out_of_the_build_script() {
        let script = "#!/usr/bin/env bash\nSTAGE_DIR=\"$ROOT/build\"\nNGSPICE_COMMIT=\"${NGSPICE_COMMIT:-67FBAA9E6A6D756FA23BF52C7B565FBE926FB9C6}\"\nNGSPICE_REPOSITORY=\"https://example.invalid\"\n";
        assert_eq!(pinned_commit(script).as_deref(), Some(COMMIT));
    }

    /** A renamed assignment must read as "cannot tell", not as "matches". */
    #[test]
    fn reports_no_pin_when_the_build_script_stops_declaring_one() {
        assert_eq!(pinned_commit("NGSPICE_TAG=\"v43\"\n"), None);
        assert_eq!(pinned_commit("NGSPICE_COMMIT=\"$SOME_VAR\"\n"), None);
    }

    /** Repository root, from this crate's manifest directory. */
    fn repo_root() -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..")
    }

    fn read_repo_file(relative: &str) -> String {
        let path = repo_root().join(relative);
        std::fs::read_to_string(&path).unwrap_or_else(|error| {
            panic!("{relative} must ship in the repository: {error}");
        })
    }

    /**
     * The names the build script demands and the names the loader asks for are
     * the same set, and `table` is in neither. Comparing the sets rather than
     * the literal line keeps this honest if the loop is ever reformatted.
     */
    #[test]
    fn stages_exactly_the_code_models_the_loader_loads() {
        let script = read_repo_file("scripts/build-ngspice.sh");
        let loop_line = script
            .lines()
            .find(|line| line.trim_start().starts_with("for codemodel in "))
            .expect("build-ngspice.sh declares the required code models in a loop");
        let mut staged: Vec<&str> = loop_line
            .trim()
            .trim_start_matches("for codemodel in ")
            .trim_end_matches("; do")
            .split_whitespace()
            .collect();
        staged.sort_unstable();

        let mut loaded: Vec<&str> = REQUIRED_CODEMODELS
            .iter()
            .map(|name| name.trim_end_matches(".cm"))
            .collect();
        loaded.sort_unstable();

        assert_eq!(staged, loaded, "staged code models must equal loaded ones");
        assert!(
            !staged.contains(&"table"),
            "table.cm is GPL v2 and unused; it must not be staged or loaded"
        );
    }

    /**
     * ngspice always builds these, so keeping them out of the required list is
     * not enough - the resource copy takes whole directories. Shipping any of
     * them would put GPL v2 code in a proprietary bundle. `ivlng` is the Icarus
     * Verilog VPI module and `scripts/src` holds `ghdl_vpi.c`, both part of the
     * `d_cosim` co-simulation path that Tau does not expose.
     */
    #[test]
    fn deletes_the_gpl_licensed_parts_from_the_staged_resource() {
        let script = read_repo_file("scripts/build-ngspice.sh");
        for removal in [
            r#"rm -f "$RESOURCE_DIR/lib/ngspice/table.cm""#,
            r#""$RESOURCE_DIR/lib/ngspice/ivlng.so""#,
            r#""$RESOURCE_DIR/lib/ngspice/ivlng.vpi""#,
            r#"rm -rf "$RESOURCE_DIR/share/ngspice/scripts/src""#,
        ] {
            assert!(
                script.contains(removal),
                "build-ngspice.sh must delete GPL-licensed staged files: {removal}"
            );
        }
    }

    /**
     * The check above reads the script; this one reads what the script actually
     * produced. Only the second kind catches a removal that was written down
     * and never took effect, which is how `ivlng` and `ghdl_vpi.c` shipped
     * while the notices claimed no GPL code was distributed. The resource is
     * gitignored, so this is inert on a tree that has never staged an engine.
     */
    #[test]
    fn the_staged_resource_carries_no_gpl_licensed_file() {
        let resource = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/ngspice");
        if !resource.join("build-info.json").is_file() {
            return;
        }
        for forbidden in [
            "lib/ngspice/table.cm",
            "lib/ngspice/ivlng.so",
            "lib/ngspice/ivlng.vpi",
            "share/ngspice/scripts/src",
        ] {
            assert!(
                !resource.join(forbidden).exists(),
                "GPL-licensed {forbidden} must not be staged for distribution"
            );
        }
    }

    /**
     * The notices carry ngspice's source offer, so the commit they name has to
     * be the commit actually built. A pin bump that forgets this file points a
     * user at source that is not what they were shipped.
     */
    #[test]
    fn third_party_notices_name_the_commit_the_build_script_pins() {
        let script = read_repo_file("scripts/build-ngspice.sh");
        let pinned = pinned_commit(&script).expect("build-ngspice.sh pins a commit");
        let notices = read_repo_file("THIRD_PARTY_NOTICES");
        assert!(
            notices.to_lowercase().contains(&pinned.to_lowercase()),
            "THIRD_PARTY_NOTICES must offer the source for pinned commit {pinned}"
        );
        assert!(
            notices.contains("scripts/patches/ngspice-ltspice-ota-current-limit.patch"),
            "THIRD_PARTY_NOTICES must disclose the patch Tau applies to ngspice"
        );
        assert!(
            read_repo_file("LICENSE").contains("THIRD_PARTY_NOTICES"),
            "LICENSE must point at the third-party notices"
        );
    }

    #[test]
    fn spells_the_host_the_way_each_platform_uname_does() {
        assert_eq!(
            expected_host("macos", "aarch64").as_deref(),
            Some("Darwin-arm64")
        );
        assert_eq!(
            expected_host("macos", "x86_64").as_deref(),
            Some("Darwin-x86_64")
        );
        assert_eq!(
            expected_host("linux", "aarch64").as_deref(),
            Some("Linux-aarch64")
        );
        assert_eq!(expected_host("windows", "x86_64"), None);
    }
}
