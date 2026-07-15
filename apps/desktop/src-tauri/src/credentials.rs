const ASSISTANT_SERVICE: &str = "com.tau.desktop.assistant";
const ANTHROPIC_ACCOUNT: &str = "anthropic-api-key";

fn anthropic_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(ASSISTANT_SERVICE, ANTHROPIC_ACCOUNT)
        .map_err(|error| format!("Could not access the system credential store: {error}"))
}

/// Read the user's Anthropic credential from the operating-system keychain.
/// The secret crosses IPC only when Tau hydrates the password field/client;
/// it is never written to web storage or a project file.
#[tauri::command]
pub async fn load_assistant_api_key() -> Result<Option<String>, String> {
    // macOS may show SecurityAgent when an unsigned development build changes
    // its code identity. Keychain APIs are synchronous, so keeping them off
    // Tauri's IPC/main thread prevents that authorization wait from painting a
    // blank, apparently frozen application window.
    tauri::async_runtime::spawn_blocking(|| match anthropic_entry()?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("Could not read the assistant credential: {error}")),
    })
    .await
    .map_err(|error| format!("Credential task did not complete: {error}"))?
}

/// Set or remove the Anthropic credential. Whitespace-only input means the
/// user cleared the field and therefore deletes the keychain item.
#[tauri::command]
pub async fn save_assistant_api_key(api_key: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let entry = anthropic_entry()?;
        let trimmed = api_key.trim();
        if trimmed.is_empty() {
            return match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(error) => Err(format!(
                    "Could not remove the assistant credential: {error}"
                )),
            };
        }
        entry
            .set_password(trimmed)
            .map_err(|error| format!("Could not save the assistant credential: {error}"))
    })
    .await
    .map_err(|error| format!("Credential task did not complete: {error}"))?
}
