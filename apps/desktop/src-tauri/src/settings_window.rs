//! The standalone Settings window, plus the only way Tau opens a web page.
//!
//! Settings is a second `WebviewWindow` on the same origin as the schematic
//! window, loading `settings.html` from the same bundle. Same origin matters
//! twice: the app's strict CSP (`default-src 'self'`) covers it with no
//! loosening, and both windows share `localStorage`, which is how a preference
//! changed in Settings reaches the schematic window without any IPC.
//!
//! Creating the window from Rust rather than from `WebviewWindow` in the
//! renderer keeps `core:webview:allow-create-webview-window` out of the
//! renderer's capability set: the front end can ask for *this* window and
//! nothing else.

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

pub const SETTINGS_LABEL: &str = "settings";

/// Exactly the pages Settings links to, matched in full. Following the
/// credential allowlist's lead: an open-anything command is a phishing
/// primitive, so the set is closed and every entry is a provider page a user
/// needs to create or audit their own key.
const ALLOWED_EXTERNAL_URLS: &[&str] = &[
    // Key creation
    "https://console.anthropic.com/settings/keys",
    "https://platform.openai.com/api-keys",
    "https://aistudio.google.com/apikey",
    // Spending and usage, which is the provider's number, not Tau's
    "https://console.anthropic.com/settings/usage",
    "https://platform.openai.com/usage",
    "https://aistudio.google.com/usage",
    // Pricing, linked from the payment-responsibility copy
    "https://www.anthropic.com/pricing",
    "https://openai.com/api/pricing/",
    "https://ai.google.dev/pricing",
];

fn is_allowed_external_url(url: &str) -> bool {
    ALLOWED_EXTERNAL_URLS.contains(&url)
}

/// Show the Settings window, creating it the first time. A second call focuses
/// the existing window instead of stacking duplicates, which is what a user
/// pressing the toolbar button twice means.
#[tauri::command]
pub async fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(SETTINGS_LABEL) {
        existing
            .show()
            .map_err(|error| format!("Could not show the Settings window: {error}"))?;
        existing
            .unminimize()
            .map_err(|error| format!("Could not restore the Settings window: {error}"))?;
        existing
            .set_focus()
            .map_err(|error| format!("Could not focus the Settings window: {error}"))?;
        return Ok(());
    }

    WebviewWindowBuilder::new(&app, SETTINGS_LABEL, WebviewUrl::App("settings.html".into()))
        .title("Tau Settings")
        .inner_size(940.0, 660.0)
        .min_inner_size(720.0, 480.0)
        .resizable(true)
        .build()
        .map_err(|error| format!("Could not open the Settings window: {error}"))?;
    Ok(())
}

/// Hand one allowlisted provider page to the system browser. Tau's own webview
/// never navigates away from the app: a page that could be steered elsewhere is
/// a page that can be made to look like Tau while it asks for a key.
#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    if !is_allowed_external_url(&url) {
        return Err(format!("Tau does not open that address: {url}"));
    }
    tauri::async_runtime::spawn_blocking(move || open_in_system_browser(&url))
        .await
        .map_err(|error| format!("Opening the page did not complete: {error}"))?
}

#[cfg(target_os = "macos")]
fn open_in_system_browser(url: &str) -> Result<(), String> {
    let status = std::process::Command::new("/usr/bin/open")
        .arg("--")
        .arg(url)
        .status()
        .map_err(|error| format!("Could not reach the system browser: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("The system browser refused to open that page.".to_string())
    }
}

#[cfg(not(target_os = "macos"))]
fn open_in_system_browser(_url: &str) -> Result<(), String> {
    Err("Tau opens provider pages through the macOS system browser.".to_string())
}

#[cfg(test)]
mod tests {
    use super::{is_allowed_external_url, ALLOWED_EXTERNAL_URLS};
    use std::collections::HashSet;

    #[test]
    fn allowlist_matches_whole_urls_only() {
        assert!(is_allowed_external_url(
            "https://console.anthropic.com/settings/keys"
        ));
        assert!(is_allowed_external_url("https://platform.openai.com/api-keys"));
        assert!(is_allowed_external_url("https://aistudio.google.com/apikey"));

        // A prefix check would pass these. A full match does not.
        assert!(!is_allowed_external_url(
            "https://console.anthropic.com/settings/keys/../../evil"
        ));
        assert!(!is_allowed_external_url(
            "https://console.anthropic.com.evil.test/settings/keys"
        ));
        assert!(!is_allowed_external_url(
            "https://console.anthropic.com/settings/keys?next=https://evil.test"
        ));
        assert!(!is_allowed_external_url("https://evil.test/"));
        assert!(!is_allowed_external_url(""));
    }

    #[test]
    fn allowlist_is_https_only_and_free_of_duplicates() {
        for url in ALLOWED_EXTERNAL_URLS {
            assert!(url.starts_with("https://"), "{url} is not https");
            // No shell metacharacters or newlines can reach the argv we build.
            assert!(!url.contains(char::is_whitespace), "{url} contains whitespace");
        }
        let unique: HashSet<_> = ALLOWED_EXTERNAL_URLS.iter().collect();
        assert_eq!(unique.len(), ALLOWED_EXTERNAL_URLS.len());
    }

    #[test]
    fn every_supported_provider_has_a_key_page() {
        for host in ["anthropic.com", "openai.com", "google.com"] {
            assert!(
                ALLOWED_EXTERNAL_URLS.iter().any(|url| url.contains(host)),
                "no linkable page for {host}"
            );
        }
    }
}
