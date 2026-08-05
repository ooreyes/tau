use std::{
    env, fs,
    path::{Component, Path, PathBuf},
};

use serde::Serialize;

const MAX_MODEL_BYTES: u64 = 5 * 1024 * 1024;
const MAX_DISCOVERED_FILES: usize = 10_000;
const MAX_SCAN_DEPTH: usize = 4;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledLtspiceModelFile {
    pub id: String,
    pub name: String,
    pub category: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledLtspiceLibrary {
    pub root: String,
    pub files: Vec<InstalledLtspiceModelFile>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct InstalledLtspiceModelText {
    pub name: String,
    pub text: String,
}

fn supported_extension(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref(),
        Some(
            "lib"
                | "sub"
                | "subckt"
                | "mod"
                | "cir"
                | "spi"
                | "inc"
                | "txt"
                | "mos"
                | "dio"
                | "bjt"
                | "jft"
                | "cap"
                | "res"
                | "ind"
                | "bead"
        )
    )
}

fn readable_extension(path: &Path) -> bool {
    supported_extension(path)
        || path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("asy"))
}

fn safe_relative_path(relative: &Path) -> bool {
    relative.components().count() > 0
        && relative
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

fn display_relative_path(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn scan_model_directory(
    root: &Path,
    directory: &Path,
    depth: usize,
    files: &mut Vec<InstalledLtspiceModelFile>,
) -> Result<(), String> {
    if depth > MAX_SCAN_DEPTH {
        return Ok(());
    }
    let entries = fs::read_dir(directory)
        .map_err(|error| format!("Could not read the installed LTspice library: {error}"))?;
    for entry in entries {
        let entry = entry
            .map_err(|error| format!("Could not inspect an LTspice library entry: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Could not inspect an LTspice library entry: {error}"))?;
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            scan_model_directory(root, &path, depth + 1, files)?;
            continue;
        }
        if !file_type.is_file() || !supported_extension(&path) {
            continue;
        }
        let metadata = entry
            .metadata()
            .map_err(|error| format!("Could not inspect an LTspice model file: {error}"))?;
        if metadata.len() > MAX_MODEL_BYTES {
            continue;
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|_| "An LTspice model escaped its installed library root.".to_string())?;
        if !safe_relative_path(relative) {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| "An installed LTspice model has an invalid filename.".to_string())?
            .to_string();
        let category = relative
            .components()
            .next()
            .and_then(|component| match component {
                Component::Normal(value) => value.to_str(),
                _ => None,
            })
            .unwrap_or("models")
            .to_string();
        files.push(InstalledLtspiceModelFile {
            id: display_relative_path(relative),
            name,
            category,
            bytes: metadata.len(),
        });
        if files.len() > MAX_DISCOVERED_FILES {
            return Err(format!(
                "The installed LTspice library contains more than {MAX_DISCOVERED_FILES} supported model files."
            ));
        }
    }
    Ok(())
}

fn discover_library_at(root: &Path) -> Result<InstalledLtspiceLibrary, String> {
    let root = fs::canonicalize(root)
        .map_err(|error| format!("Could not access the installed LTspice library: {error}"))?;
    if !root.is_dir() {
        return Err("The installed LTspice library path is not a folder.".into());
    }
    let mut files = Vec::new();
    scan_model_directory(&root, &root, 0, &mut files)?;
    files.sort_by(|a, b| {
        a.category
            .to_ascii_lowercase()
            .cmp(&b.category.to_ascii_lowercase())
            .then_with(|| {
                a.name
                    .to_ascii_lowercase()
                    .cmp(&b.name.to_ascii_lowercase())
            })
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(InstalledLtspiceLibrary {
        root: root.to_string_lossy().into_owned(),
        files,
    })
}

fn candidate_library_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(home) = env::var_os("HOME") {
        let home = PathBuf::from(home);
        roots.push(home.join("Library/Application Support/LTspice/lib"));
        roots.push(home.join("Documents/LTspice/lib"));
    }
    roots.push(PathBuf::from(
        "/Applications/LTspice.app/Contents/Resources/lib",
    ));
    roots
}

fn installed_library_root() -> Result<PathBuf, String> {
    candidate_library_roots()
        .into_iter()
        .find(|path| path.is_dir())
        .ok_or_else(|| {
            "No installed LTspice model library was found. Open LTspice once so it can install its user library, or attach a model file manually."
                .to_string()
        })
}

fn decode_windows_1252(bytes: &[u8]) -> String {
    const C1: [u16; 32] = [
        0x20AC, 0x0081, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160,
        0x2039, 0x0152, 0x008D, 0x017D, 0x008F, 0x0090, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022,
        0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x009D, 0x017E, 0x0178,
    ];
    bytes
        .iter()
        .map(|byte| {
            let code = if (0x80..=0x9f).contains(byte) {
                C1[usize::from(*byte - 0x80)] as u32
            } else {
                u32::from(*byte)
            };
            char::from_u32(code).unwrap_or('\u{fffd}')
        })
        .collect()
}

/// Applications schematics often write bare `SYMBOL ADA4077-1` while the
/// installed file lives at `sym/OpAmps/ADA4077-1.asy`. Prefer an exact relative
/// join; when the request is a single-segment `sym/<leaf>.asy` that is missing,
/// accept a **unique** basename hit under `sym/` (ambiguous leaves stay missing
/// so Tau never attaches the wrong family's ModelFile — unless exactly one
/// family names an on-disk plaintext ModelFile/SpiceModel, e.g. AD8561 OpAmps
/// `.lib` over Comparators encrypted `.sub`).
fn unique_sym_asy_leaf(root: &Path, leaf_asy: &str) -> Result<Option<PathBuf>, String> {
    let target = leaf_asy.to_ascii_lowercase();
    let sym_root = root.join("sym");
    if !sym_root.is_dir() {
        return Ok(None);
    }
    let mut hits: Vec<PathBuf> = Vec::new();
    fn walk(dir: &Path, target: &str, hits: &mut Vec<PathBuf>, depth: usize) -> Result<(), String> {
        if depth > MAX_SCAN_DEPTH {
            return Ok(());
        }
        let entries = match fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(_) => return Ok(()),
        };
        for entry in entries {
            let entry = entry
                .map_err(|error| format!("Could not inspect an LTspice symbol entry: {error}"))?;
            let file_type = entry
                .file_type()
                .map_err(|error| format!("Could not inspect an LTspice symbol entry: {error}"))?;
            if file_type.is_symlink() {
                continue;
            }
            let path = entry.path();
            if file_type.is_dir() {
                walk(&path, target, hits, depth + 1)?;
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("");
            if name.eq_ignore_ascii_case(target) {
                hits.push(path);
            }
        }
        Ok(())
    }
    walk(&sym_root, &target, &mut hits, 0)?;
    if hits.len() == 1 {
        return Ok(Some(hits.remove(0)));
    }
    if hits.len() > 1 {
        return Ok(disambiguate_asy_hits_by_plaintext_model(root, &hits));
    }
    Ok(None)
}

/// ModelFile / library-shaped SpiceModel from `.asy` text (authored path only).
fn asy_model_file_attr(text: &str) -> Option<String> {
    let mut model_file: Option<String> = None;
    let mut spice_model: Option<String> = None;
    for raw in text.lines() {
        let line = raw.trim();
        let Some(rest) = line
            .get(8..)
            .filter(|_| line.len() >= 8 && line[..8].eq_ignore_ascii_case("SYMATTR "))
        else {
            continue;
        };
        let rest = rest.trim_start();
        let Some((key, value)) = rest.split_once(char::is_whitespace) else {
            continue;
        };
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        if key.eq_ignore_ascii_case("ModelFile") {
            model_file = Some(value.to_string());
        } else if key.eq_ignore_ascii_case("SpiceModel") {
            spice_model = Some(value.to_string());
        }
    }
    if let Some(model_file) = model_file {
        return Some(model_file);
    }
    let spice_model = spice_model?;
    if spice_model
        .rsplit('.')
        .next()
        .is_some_and(|ext| matches!(ext.to_ascii_lowercase().as_str(), "lib" | "sub" | "mod"))
    {
        Some(spice_model)
    } else {
        None
    }
}

fn is_encrypted_model_bytes(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return false;
    }
    let head_len = bytes.len().min(64);
    if String::from_utf8_lossy(&bytes[..head_len]).contains("<Binary File>") {
        return true;
    }
    if bytes.contains(&0) {
        return true;
    }
    let suspicious = bytes
        .iter()
        .filter(|byte| **byte < 0x09 || (0x0e..0x20).contains(*byte))
        .count();
    suspicious * 100 > bytes.len()
}

/// Authored ModelFile path only (no same-stem twin expansion).
fn authored_model_file_is_plaintext(root: &Path, relative_file: &str) -> bool {
    let relative = Path::new(relative_file);
    if !safe_relative_path(relative) {
        return false;
    }
    for base in [root.join("sub"), root.to_path_buf()] {
        let candidate = base.join(relative);
        if !candidate.is_file() {
            continue;
        }
        let Ok(bytes) = fs::read(&candidate) else {
            continue;
        };
        return !is_encrypted_model_bytes(&bytes);
    }
    false
}

fn model_stem(relative_file: &str) -> String {
    let normalized = relative_file.replace('\\', "/").to_ascii_lowercase();
    for ext in [".lib", ".sub", ".mod"] {
        if let Some(stem) = normalized.strip_suffix(ext) {
            return stem.to_string();
        }
    }
    normalized
}

fn disambiguate_asy_hits_by_plaintext_model(root: &Path, hits: &[PathBuf]) -> Option<PathBuf> {
    let mut plaintext: Vec<(PathBuf, String)> = Vec::new();
    for path in hits {
        let Ok(bytes) = fs::read(path) else {
            continue;
        };
        let text = match String::from_utf8(bytes.clone()) {
            Ok(text) => text,
            Err(error) => decode_windows_1252(error.as_bytes()),
        };
        let Some(model_file) = asy_model_file_attr(&text) else {
            continue;
        };
        if !authored_model_file_is_plaintext(root, &model_file) {
            continue;
        }
        plaintext.push((path.clone(), model_stem(&model_file)));
    }
    if plaintext.len() == 1 {
        return Some(plaintext.remove(0).0);
    }
    if plaintext.len() > 1 {
        let first_stem = plaintext[0].1.clone();
        if plaintext.iter().all(|entry| entry.1 == first_stem) {
            plaintext.sort_by(|a, b| a.0.cmp(&b.0));
            return Some(plaintext.remove(0).0);
        }
    }
    None
}

fn read_model_at(root: &Path, id: &str) -> Result<InstalledLtspiceModelText, String> {
    let root = fs::canonicalize(root)
        .map_err(|error| format!("Could not access the installed LTspice library: {error}"))?;
    let relative = Path::new(id);
    if !safe_relative_path(relative) || !readable_extension(relative) {
        return Err("The selected LTspice model path is invalid.".into());
    }
    let mut candidate = root.join(relative);
    if !candidate.is_file() {
        // Bare Applications leaf: `sym/ADA4077-1.asy` → unique `sym/OpAmps/…`.
        let components: Vec<_> = relative.components().collect();
        if components.len() == 2
            && matches!(components[0], Component::Normal(value) if value.eq_ignore_ascii_case("sym"))
            && matches!(
                components[1],
                Component::Normal(value)
                    if value
                        .to_str()
                        .is_some_and(|name| name.to_ascii_lowercase().ends_with(".asy"))
            )
        {
            let leaf = match components[1] {
                Component::Normal(value) => value.to_string_lossy().into_owned(),
                _ => unreachable!(),
            };
            if let Some(found) = unique_sym_asy_leaf(&root, &leaf)? {
                candidate = found;
            }
        }
    }
    let link_metadata = fs::symlink_metadata(&candidate)
        .map_err(|error| format!("Could not access the selected LTspice model: {error}"))?;
    if link_metadata.file_type().is_symlink() || !link_metadata.file_type().is_file() {
        return Err(
            "The selected LTspice model must be a regular file, not a symbolic link.".into(),
        );
    }
    let canonical = fs::canonicalize(&candidate)
        .map_err(|error| format!("Could not resolve the selected LTspice model: {error}"))?;
    if canonical == root || !canonical.starts_with(&root) {
        return Err("The selected LTspice model escaped its installed library root.".into());
    }
    if link_metadata.len() > MAX_MODEL_BYTES {
        return Err(format!(
            "Installed model files are limited to {MAX_MODEL_BYTES} bytes."
        ));
    }
    let bytes = fs::read(&canonical)
        .map_err(|error| format!("Could not read the selected LTspice model: {error}"))?;
    if bytes.contains(&0) {
        return Err(
            "That LTspice model is binary or encrypted and cannot be attached as SPICE text."
                .into(),
        );
    }
    let suspicious_controls = bytes
        .iter()
        .filter(|byte| **byte < 0x09 || (0x0e..0x20).contains(*byte))
        .count();
    if !bytes.is_empty() && suspicious_controls * 100 > bytes.len() {
        return Err(
            "That LTspice model is binary or encrypted and cannot be attached as SPICE text."
                .into(),
        );
    }
    let name = canonical
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "The selected LTspice model has an invalid filename.".to_string())?
        .to_string();
    let text = match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(error) => decode_windows_1252(error.as_bytes()),
    };
    Ok(InstalledLtspiceModelText { name, text })
}

#[tauri::command]
pub fn discover_installed_ltspice_library() -> Result<InstalledLtspiceLibrary, String> {
    discover_library_at(&installed_library_root()?)
}

#[tauri::command]
pub fn read_installed_ltspice_model(id: String) -> Result<InstalledLtspiceModelText, String> {
    read_model_at(&installed_library_root()?, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn resolves_unique_bare_sym_asy_leaf_and_refuses_ambiguous() {
        let temp = tempfile::tempdir().unwrap();
        let opamps = temp.path().join("sym/OpAmps");
        let adc = temp.path().join("sym/ADC");
        fs::create_dir_all(&opamps).unwrap();
        fs::create_dir_all(&adc).unwrap();
        fs::write(
            opamps.join("ADA4077-1.asy"),
            "Version 4\nSYMATTR Prefix X\n",
        )
        .unwrap();
        fs::write(adc.join("AD4000.asy"), "Version 4\nSYMATTR Prefix X\n").unwrap();

        let opamp = read_model_at(temp.path(), "sym/ADA4077-1.asy").unwrap();
        assert!(opamp.text.contains("Prefix X"));
        let adc_sym = read_model_at(temp.path(), "sym/AD4000.asy").unwrap();
        assert!(adc_sym.text.contains("Prefix X"));

        // Ambiguous leaf stays missing (never pick a family).
        fs::write(adc.join("ADA4077-1.asy"), "Version 4\nSYMATTR Prefix X\n").unwrap();
        assert!(read_model_at(temp.path(), "sym/ADA4077-1.asy")
            .unwrap_err()
            .contains("Could not access"));
    }

    #[test]
    fn disambiguates_ambiguous_leaf_when_one_family_names_plaintext_model() {
        let temp = tempfile::tempdir().unwrap();
        let comparators = temp.path().join("sym/Comparators");
        let opamps = temp.path().join("sym/OpAmps");
        let sub = temp.path().join("sub");
        fs::create_dir_all(&comparators).unwrap();
        fs::create_dir_all(&opamps).unwrap();
        fs::create_dir_all(&sub).unwrap();
        fs::write(
            comparators.join("AD8561.asy"),
            "Version 4\nSYMATTR Prefix X\nSYMATTR SpiceModel AD8561.sub\n",
        )
        .unwrap();
        fs::write(
            opamps.join("AD8561.asy"),
            "Version 4\nSYMATTR Prefix X\nSYMATTR SpiceModel AD8561.lib\nPIN Q\n",
        )
        .unwrap();
        fs::write(sub.join("AD8561.sub"), [0u8, 1, 2, 3]).unwrap();
        fs::write(sub.join("AD8561.lib"), ".subckt AD8561 1 2\n.ends\n").unwrap();

        let resolved = read_model_at(temp.path(), "sym/AD8561.asy").unwrap();
        assert!(
            resolved.text.contains("AD8561.lib"),
            "expected OpAmps plaintext family, got {}",
            resolved.text
        );
        assert!(resolved.text.contains("PIN Q"));
    }

    #[test]
    fn still_refuses_ambiguous_leaf_when_every_family_is_encrypted() {
        let temp = tempfile::tempdir().unwrap();
        let opamps = temp.path().join("sym/OpAmps");
        let adc = temp.path().join("sym/ADC");
        let sub = temp.path().join("sub");
        fs::create_dir_all(&opamps).unwrap();
        fs::create_dir_all(&adc).unwrap();
        fs::create_dir_all(&sub).unwrap();
        fs::write(
            opamps.join("AD4858.asy"),
            "Version 4\nSYMATTR Prefix X\nSYMATTR ModelFile AD4858.sub\n",
        )
        .unwrap();
        fs::write(
            adc.join("AD4858.asy"),
            "Version 4\nSYMATTR Prefix X\nSYMATTR ModelFile AD4858.sub\n",
        )
        .unwrap();
        fs::write(sub.join("AD4858.sub"), [0u8, 1, 2, 3]).unwrap();
        assert!(read_model_at(temp.path(), "sym/AD4858.asy")
            .unwrap_err()
            .contains("Could not access"));
    }

    #[test]
    fn discovers_supported_text_models_without_following_symlinks() {
        let temp = tempfile::tempdir().unwrap();
        let sub = temp.path().join("sub");
        let cmp = temp.path().join("cmp");
        fs::create_dir_all(&sub).unwrap();
        fs::create_dir_all(&cmp).unwrap();
        fs::write(sub.join("OPX.sub"), ".subckt OPX 1 2\n.ends OPX\n").unwrap();
        fs::write(cmp.join("standard.mos"), ".model NM NMOS()\n").unwrap();
        fs::write(sub.join("ignore.asy"), "Version 4\n").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(sub.join("OPX.sub"), sub.join("linked.sub")).unwrap();

        let discovered = discover_library_at(temp.path()).unwrap();
        assert_eq!(
            discovered
                .files
                .iter()
                .map(|file| file.id.as_str())
                .collect::<Vec<_>>(),
            vec!["cmp/standard.mos", "sub/OPX.sub"]
        );
        let symbol = read_model_at(temp.path(), "sub/ignore.asy").unwrap();
        assert_eq!(symbol.text, "Version 4\n");
    }

    #[test]
    fn reads_utf8_and_windows_1252_text_but_rejects_binary_and_traversal() {
        let temp = tempfile::tempdir().unwrap();
        let sub = temp.path().join("sub");
        fs::create_dir_all(&sub).unwrap();
        fs::write(sub.join("micro.lib"), b"* 10\xb5A\n.model D1 D()\n").unwrap();
        fs::write(sub.join("encrypted.sub"), b"\0\x01\x02secret").unwrap();

        let model = read_model_at(temp.path(), "sub/micro.lib").unwrap();
        assert!(model.text.contains("10µA"));
        assert!(read_model_at(temp.path(), "../secret.lib")
            .unwrap_err()
            .contains("invalid"));
        assert!(read_model_at(temp.path(), "sub/encrypted.sub")
            .unwrap_err()
            .contains("binary or encrypted"));
    }

    #[test]
    fn refuses_oversized_models() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("large.lib");
        let mut file = fs::File::create(&path).unwrap();
        file.set_len(MAX_MODEL_BYTES + 1).unwrap();
        file.flush().unwrap();
        assert!(read_model_at(temp.path(), "large.lib")
            .unwrap_err()
            .contains("limited"));
    }

    #[test]
    #[ignore = "requires the user's installed LTspice library"]
    fn installed_ltspice_library_is_discoverable_and_selectively_readable() {
        let root = installed_library_root().unwrap();
        let library = discover_library_at(&root).unwrap();
        assert!(library.files.len() >= 100);
        let selected = library
            .files
            .iter()
            .find(|file| file.id == "sub/UniversalOpAmp4.lib")
            .expect("installed UniversalOpAmp4.lib");
        let model = read_model_at(&root, &selected.id).unwrap();
        assert_eq!(model.name, "UniversalOpAmp4.lib");
        assert!(model.text.to_ascii_lowercase().contains(".subckt"));
    }
}
