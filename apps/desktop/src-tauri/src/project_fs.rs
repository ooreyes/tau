use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use tauri::AppHandle;
use tauri_plugin_fs::FsExt;

fn canonical_directory(path: &Path, label: &str) -> Result<PathBuf, String> {
    let canonical =
        fs::canonicalize(path).map_err(|error| format!("Could not access {label}: {error}"))?;
    if !canonical.is_dir() {
        return Err(format!("{label} is not a folder."));
    }
    Ok(canonical)
}

fn safe_leaf_name(name: &str) -> bool {
    let path = Path::new(name);
    !name.is_empty()
        && name != "."
        && name != ".."
        && path.components().count() == 1
        && matches!(path.components().next(), Some(Component::Normal(_)))
}

fn inside(root: &Path, path: &Path) -> bool {
    path != root && path.starts_with(root)
}

fn move_project_entry_inner(
    project_root: &Path,
    source_path: &Path,
    target_directory: &Path,
    new_name: Option<&str>,
) -> Result<PathBuf, String> {
    let root = canonical_directory(project_root, "project root")?;
    let source = fs::canonicalize(source_path)
        .map_err(|error| format!("Could not access the item to move: {error}"))?;
    let target_directory = canonical_directory(target_directory, "target folder")?;

    if !inside(&root, &source) {
        return Err(
            "The source must be inside the open project and cannot be the project root.".into(),
        );
    }
    if target_directory != root && !inside(&root, &target_directory) {
        return Err("The target folder must be inside the open project.".into());
    }

    let current_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "The source has no valid filename.".to_string())?;
    let leaf = new_name.unwrap_or(current_name).trim();
    if !safe_leaf_name(leaf) {
        return Err(
            "The destination name must be a single filename without path separators.".into(),
        );
    }

    // A directory cannot be moved beneath itself. Checking the canonical
    // target directory also closes symlink-based descendant escapes.
    if source.is_dir() && target_directory.starts_with(&source) {
        return Err("A folder cannot be moved into itself or one of its descendants.".into());
    }

    let destination = target_directory.join(leaf);
    if destination == source {
        return Ok(source);
    }
    if destination.exists() {
        return Err("An item with that name already exists in the target folder.".into());
    }

    fs::rename(&source, &destination)
        .map_err(|error| format!("Could not move the project item: {error}"))?;
    Ok(destination)
}

/// Promote a folder-picker grant to recursive project access. The dialog
/// plugin initially authorizes the selected folder itself; Explorer needs its
/// descendants for create/read/rename. Requiring the exact root to already be
/// allowed prevents a webview from using this command to grant itself an
/// arbitrary directory.
#[tauri::command]
pub fn authorize_project_directory(app: AppHandle, project_root: String) -> Result<(), String> {
    let root = canonical_directory(Path::new(&project_root), "project root")?;
    let scope = app.fs_scope();
    if !scope.is_allowed(&root) {
        return Err("The project folder was not selected by the user.".into());
    }
    scope
        .allow_directory(&root, true)
        .map_err(|error| format!("Could not authorize the project folder: {error}"))
}

/// Move or rename one project entry without permitting arbitrary filesystem
/// access. The project root must already be authorized by Tauri's filesystem
/// scope (normally by the folder picker), and both resolved paths must remain
/// beneath that root.
#[tauri::command]
pub fn move_project_entry(
    app: AppHandle,
    project_root: String,
    source_path: String,
    target_directory: String,
    new_name: Option<String>,
) -> Result<String, String> {
    let root = canonical_directory(Path::new(&project_root), "project root")?;
    if !app.fs_scope().is_allowed(&root) {
        return Err("The project folder is not authorized. Reopen it before moving files.".into());
    }
    move_project_entry_inner(
        &root,
        Path::new(&source_path),
        Path::new(&target_directory),
        new_name.as_deref(),
    )
    .map(|path| path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn sandbox(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "tau-project-fs-{name}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("create sandbox");
        path
    }

    #[test]
    fn moves_and_renames_a_file_inside_the_project() {
        let root = sandbox("move");
        let source_dir = root.join("source");
        let target_dir = root.join("target");
        fs::create_dir_all(&source_dir).unwrap();
        fs::create_dir_all(&target_dir).unwrap();
        let source = source_dir.join("old.asc");
        fs::write(&source, "Version 4\n").unwrap();
        let canonical_target = fs::canonicalize(&target_dir).unwrap();

        let moved = move_project_entry_inner(&root, &source, &target_dir, Some("new.asc")).unwrap();
        assert_eq!(moved, canonical_target.join("new.asc"));
        assert_eq!(fs::read_to_string(moved).unwrap(), "Version 4\n");
        assert!(!source.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_paths_outside_the_project_and_unsafe_names() {
        let root = sandbox("escape-root");
        let outside = sandbox("escape-outside");
        let source = root.join("safe.asc");
        fs::write(&source, "Version 4\n").unwrap();

        assert!(move_project_entry_inner(&root, &source, &outside, None)
            .unwrap_err()
            .contains("inside the open project"));
        assert!(
            move_project_entry_inner(&root, &source, &root, Some("../escape.asc"))
                .unwrap_err()
                .contains("single filename")
        );
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn rejects_descendant_moves_and_destination_overwrites() {
        let root = sandbox("conflict");
        let folder = root.join("folder");
        let child = folder.join("child");
        fs::create_dir_all(&child).unwrap();
        assert!(move_project_entry_inner(&root, &folder, &child, None)
            .unwrap_err()
            .contains("descendants"));

        let source = root.join("source.asc");
        let existing = root.join("existing.asc");
        fs::write(&source, "source").unwrap();
        fs::write(&existing, "existing").unwrap();
        assert!(
            move_project_entry_inner(&root, &source, &root, Some("existing.asc"))
                .unwrap_err()
                .contains("already exists")
        );
        assert_eq!(fs::read_to_string(existing).unwrap(), "existing");
        fs::remove_dir_all(root).unwrap();
    }
}
