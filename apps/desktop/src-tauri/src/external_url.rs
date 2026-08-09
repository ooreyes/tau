//! The only way Tau opens a web page.
//!
//! Tau is a single-window app: the renderer has no way to create a webview, and
//! this module deliberately does not give it one. Provider pages go to the
//! system browser instead, so nothing that asks for an API key can ever be
//! rendered inside Tau's own chrome.

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
