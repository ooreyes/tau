const ASSISTANT_SERVICE: &str = "com.tau.desktop.assistant";
const ANTHROPIC_ACCOUNT: &str = "anthropic-api-key";
const GEMINI_ACCOUNT: &str = "gemini-api-key";

/// Map a frontend provider id to its keychain account. The set is closed on
/// purpose: an unrecognized id must never be able to name an arbitrary keychain
/// item, and each provider's key stays in its own entry.
fn account_for(provider: &str) -> Result<&'static str, String> {
    match provider {
        "anthropic" => Ok(ANTHROPIC_ACCOUNT),
        "gemini" => Ok(GEMINI_ACCOUNT),
        other => Err(format!("Unknown assistant provider: {other}")),
    }
}

fn provider_entry(provider: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(ASSISTANT_SERVICE, account_for(provider)?)
        .map_err(|error| format!("Could not access the system credential store: {error}"))
}

fn anthropic_entry() -> Result<keyring::Entry, String> {
    provider_entry("anthropic")
}

fn read_entry(entry: keyring::Entry) -> Result<Option<String>, String> {
    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("Could not read the assistant credential: {error}")),
    }
}

fn write_entry(entry: keyring::Entry, api_key: &str) -> Result<(), String> {
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
}

/// Read one provider's credential from the operating-system keychain. Same
/// guarantees as the Anthropic-specific commands below: the secret crosses IPC
/// only when Tau hydrates the password field/client, and is never written to
/// web storage or a project file.
#[tauri::command]
pub async fn load_provider_api_key(provider: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || read_entry(provider_entry(&provider)?))
        .await
        .map_err(|error| format!("Credential task did not complete: {error}"))?
}

/// Set or remove one provider's credential. Whitespace-only input means the
/// user cleared the field and therefore deletes the keychain item.
#[tauri::command]
pub async fn save_provider_api_key(provider: String, api_key: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || write_entry(provider_entry(&provider)?, &api_key))
        .await
        .map_err(|error| format!("Credential task did not complete: {error}"))?
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
