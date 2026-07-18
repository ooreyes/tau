use std::{
    fs,
    fs::OpenOptions,
    io::Write,
    path::{Component, Path, PathBuf},
};

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_fs::FsExt;

const MAX_CREATED_TEXT_BYTES: usize = 5 * 1024 * 1024;

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum CreateProjectTextFileResult {
    Created { path: String },
    AlreadyExists,
}

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

fn create_project_text_file_exclusive_inner(
    project_root: &Path,
    parent_path: &Path,
    name: &str,
    contents: &str,
) -> Result<CreateProjectTextFileResult, String> {
    let root = canonical_directory(project_root, "project root")?;
    let parent = canonical_directory(parent_path, "target folder")?;
    if parent != root && !inside(&root, &parent) {
        return Err("The target folder must be inside the open project.".into());
    }
    let leaf = name.trim();
    if !safe_leaf_name(leaf) {
        return Err("The filename must be a single name without path separators.".into());
    }
    if contents.len() > MAX_CREATED_TEXT_BYTES {
        return Err(format!(
            "The initial file contents exceed Tau's {MAX_CREATED_TEXT_BYTES} byte limit."
        ));
    }

    let destination = parent.join(leaf);
    let mut file = match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&destination)
    {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            return Ok(CreateProjectTextFileResult::AlreadyExists)
        }
        Err(error) => return Err(format!("Could not create the schematic: {error}")),
    };

    if let Err(error) = file.write_all(contents.as_bytes()) {
        drop(file);
        let _ = fs::remove_file(&destination);
        return Err(format!("Could not write the new schematic: {error}"));
    }
    Ok(CreateProjectTextFileResult::Created {
        path: destination.to_string_lossy().into_owned(),
    })
}

fn create_project_directory_inner(
    project_root: &Path,
    parent_path: &Path,
    name: &str,
) -> Result<PathBuf, String> {
    let root = canonical_directory(project_root, "project root")?;
    let parent = canonical_directory(parent_path, "target folder")?;
    if parent != root && !inside(&root, &parent) {
        return Err("The target folder must be inside the open project.".into());
    }
    let leaf = name.trim();
    if !safe_leaf_name(leaf) {
        return Err("The folder name must be a single name without path separators.".into());
    }

    let destination = parent.join(leaf);
    fs::create_dir(&destination).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            "An item with that name already exists in the target folder.".to_string()
        } else {
            format!("Could not create the project folder: {error}")
        }
    })?;
    fs::canonicalize(&destination)
        .map_err(|error| format!("Could not resolve the new project folder: {error}"))
}

fn move_project_entry_inner(
    project_root: &Path,
    source_path: &Path,
    target_directory: &Path,
    new_name: Option<&str>,
) -> Result<PathBuf, String> {
    let root = canonical_directory(project_root, "project root")?;
    let source_metadata = fs::symlink_metadata(source_path)
        .map_err(|error| format!("Could not access the item to move: {error}"))?;
    if source_metadata.file_type().is_symlink() {
        // Canonicalizing a symlink and then renaming that canonical path moves
        // its target while leaving the link behind. Even when the target is
        // inside the project, that is surprising and can mutate a different
        // file than the Explorer entry the user chose.
        return Err("Symbolic links cannot be moved or renamed by Tau.".into());
    }
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

/// Atomically reserve and initialize a project text file. `create_new(true)`
/// makes the existence check and creation one filesystem operation, so a file
/// created by another Tau window or process between name selection and write is
/// never truncated.
#[tauri::command]
pub fn create_project_text_file_exclusive(
    app: AppHandle,
    project_root: String,
    parent_path: String,
    name: String,
    contents: String,
) -> Result<CreateProjectTextFileResult, String> {
    let root = canonical_directory(Path::new(&project_root), "project root")?;
    if !app.fs_scope().is_allowed(&root) {
        return Err(
            "The project folder is not authorized. Reopen it before creating files.".into(),
        );
    }
    create_project_text_file_exclusive_inner(&root, Path::new(&parent_path), &name, &contents)
}

/// Create one folder immediately beneath an authorized project directory.
/// Keeping the validation and disk mutation in the same native command avoids
/// a newly-created destination depending on webview filesystem-scope timing.
#[tauri::command]
pub fn create_project_directory(
    app: AppHandle,
    project_root: String,
    parent_path: String,
    name: String,
) -> Result<String, String> {
    let root = canonical_directory(Path::new(&project_root), "project root")?;
    if !app.fs_scope().is_allowed(&root) {
        return Err(
            "The project folder is not authorized. Reopen it before creating folders.".into(),
        );
    }
    create_project_directory_inner(&root, Path::new(&parent_path), &name)
        .map(|path| path.to_string_lossy().into_owned())
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
    fn moves_a_nested_file_to_root_and_a_folder_across_folders_on_disk() {
        let root = sandbox("move-round-trip");
        let analog = root.join("Analog");
        let archive = root.join("Archive");
        let filters = analog.join("Filters");
        fs::create_dir_all(&filters).unwrap();
        fs::create_dir_all(&archive).unwrap();
        let nested_file = filters.join("low-pass.asc");
        fs::write(&nested_file, "Version 4\n").unwrap();

        let returned = move_project_entry_inner(&root, &nested_file, &root, None).unwrap();
        assert_eq!(
            returned,
            fs::canonicalize(&root).unwrap().join("low-pass.asc")
        );
        assert_eq!(fs::read_to_string(&returned).unwrap(), "Version 4\n");
        assert!(!nested_file.exists());

        fs::write(filters.join("high-pass.asc"), "Version 4\n").unwrap();
        let moved_folder = move_project_entry_inner(&root, &filters, &archive, None).unwrap();
        assert_eq!(
            moved_folder,
            fs::canonicalize(&archive).unwrap().join("Filters")
        );
        assert_eq!(
            fs::read_to_string(moved_folder.join("high-pass.asc")).unwrap(),
            "Version 4\n"
        );
        assert!(!filters.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn creates_nested_disk_entries_and_moves_the_file_into_and_out_of_the_new_folder() {
        let root = sandbox("create-and-move-round-trip");
        let created = create_project_directory_inner(&root, &root, "New Folder").unwrap();
        assert!(created.is_dir());
        let archive = create_project_directory_inner(&root, &root, "Archive").unwrap();
        let child = create_project_directory_inner(&root, &created, "Child").unwrap();
        fs::write(child.join("inside.asc"), "Version 4\n").unwrap();

        let moved_child = move_project_entry_inner(&root, &child, &archive, None).unwrap();
        assert_eq!(moved_child, archive.join("Child"));
        assert_eq!(
            fs::read_to_string(moved_child.join("inside.asc")).unwrap(),
            "Version 4\n"
        );
        let returned_child = move_project_entry_inner(&root, &moved_child, &created, None).unwrap();
        assert_eq!(returned_child, created.join("Child"));

        let nested = create_project_text_file_exclusive_inner(
            &root,
            &created,
            "generated.asc",
            "Version 4\nSHEET 1 880 680\n",
        )
        .unwrap();
        let nested_path = match nested {
            CreateProjectTextFileResult::Created { path } => PathBuf::from(path),
            CreateProjectTextFileResult::AlreadyExists => panic!("new file unexpectedly existed"),
        };
        assert_eq!(nested_path.parent(), Some(created.as_path()));
        assert_eq!(
            fs::read_to_string(&nested_path).unwrap(),
            "Version 4\nSHEET 1 880 680\n"
        );

        let at_root = move_project_entry_inner(&root, &nested_path, &root, None).unwrap();
        assert_eq!(
            at_root,
            fs::canonicalize(&root).unwrap().join("generated.asc")
        );
        assert!(!nested_path.exists());

        let returned = move_project_entry_inner(&root, &at_root, &created, None).unwrap();
        assert_eq!(returned, created.join("generated.asc"));
        assert_eq!(
            fs::read_to_string(returned).unwrap(),
            "Version 4\nSHEET 1 880 680\n"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn exclusively_creates_text_without_overwriting_an_existing_file() {
        let root = sandbox("exclusive-create");
        let first =
            create_project_text_file_exclusive_inner(&root, &root, "untitled.asc", "Version 4\n")
                .unwrap();
        assert!(matches!(first, CreateProjectTextFileResult::Created { .. }));

        let second = create_project_text_file_exclusive_inner(
            &root,
            &root,
            "untitled.asc",
            "must not replace\n",
        )
        .unwrap();
        assert_eq!(second, CreateProjectTextFileResult::AlreadyExists);
        assert_eq!(
            fs::read_to_string(root.join("untitled.asc")).unwrap(),
            "Version 4\n"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn concurrent_exclusive_creates_have_exactly_one_winner() {
        use std::sync::{Arc, Barrier};

        let root = sandbox("exclusive-race");
        let barrier = Arc::new(Barrier::new(2));
        let handles = ["first\n", "second\n"].map(|contents| {
            let root = root.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                create_project_text_file_exclusive_inner(&root, &root, "untitled.asc", contents)
                    .unwrap()
            })
        });
        let results = handles.map(|handle| handle.join().unwrap());

        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, CreateProjectTextFileResult::Created { .. }))
                .count(),
            1
        );
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, CreateProjectTextFileResult::AlreadyExists))
                .count(),
            1
        );
        let contents = fs::read_to_string(root.join("untitled.asc")).unwrap();
        assert!(contents == "first\n" || contents == "second\n");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn exclusive_create_result_has_a_stable_ipc_shape() {
        assert_eq!(
            serde_json::to_value(CreateProjectTextFileResult::AlreadyExists).unwrap(),
            serde_json::json!({ "status": "alreadyExists" })
        );
        assert_eq!(
            serde_json::to_value(CreateProjectTextFileResult::Created {
                path: "/project/filter.asc".into(),
            })
            .unwrap(),
            serde_json::json!({ "status": "created", "path": "/project/filter.asc" })
        );
    }

    #[test]
    fn exclusive_create_rejects_escape_paths_and_unsafe_names() {
        let root = sandbox("exclusive-root");
        let outside = sandbox("exclusive-outside");
        assert!(create_project_text_file_exclusive_inner(
            &root,
            &outside,
            "escape.asc",
            "Version 4\n",
        )
        .unwrap_err()
        .contains("inside the open project"));
        assert!(create_project_text_file_exclusive_inner(
            &root,
            &root,
            "../escape.asc",
            "Version 4\n",
        )
        .unwrap_err()
        .contains("single name"));
        assert!(!outside.join("escape.asc").exists());
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn rejects_paths_outside_the_project_and_unsafe_names() {
        let root = sandbox("escape-root");
        let outside = sandbox("escape-outside");
        let source = root.join("safe.asc");
        fs::write(&source, "Version 4\n").unwrap();

        assert!(move_project_entry_inner(&root, &root, &root, None)
            .unwrap_err()
            .contains("cannot be the project root"));

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

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_sources_and_symlink_escapes() {
        use std::os::unix::fs::symlink;

        let root = sandbox("symlink-root");
        let outside = sandbox("symlink-outside");
        let real_source = root.join("real.asc");
        fs::write(&real_source, "Version 4\n").unwrap();

        let source_link = root.join("linked.asc");
        symlink(&real_source, &source_link).unwrap();
        assert!(
            move_project_entry_inner(&root, &source_link, &root, Some("renamed.asc"))
                .unwrap_err()
                .contains("Symbolic links")
        );
        assert!(real_source.exists());
        assert!(source_link.exists());

        let outside_link = root.join("outside");
        symlink(&outside, &outside_link).unwrap();
        assert!(create_project_text_file_exclusive_inner(
            &root,
            &outside_link,
            "escape.asc",
            "Version 4\n",
        )
        .unwrap_err()
        .contains("inside the open project"));
        assert!(!outside.join("escape.asc").exists());

        fs::remove_file(source_link).unwrap();
        fs::remove_file(outside_link).unwrap();
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }
}
