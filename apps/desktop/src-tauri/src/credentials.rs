use std::time::Duration;

use serde::{Deserialize, Serialize};

const ASSISTANT_SERVICE: &str = "com.tau.desktop.assistant";
const ANTHROPIC_ACCOUNT: &str = "anthropic-api-key";
const GEMINI_ACCOUNT: &str = "gemini-api-key";
const OPENAI_ACCOUNT: &str = "openai-api-key";

const ANTHROPIC_URL_PREFIX: &str = "https://api.anthropic.com/";
const GEMINI_URL_PREFIX: &str = "https://generativelanguage.googleapis.com/";
const MAX_PROXY_BODY_BYTES: usize = 2 * 1024 * 1024;
const PROXY_TIMEOUT: Duration = Duration::from_secs(600);

/// Map a frontend provider id to its keychain account. The set is closed on
/// purpose: an unrecognized id must never be able to name an arbitrary keychain
/// item, and each provider's key stays in its own entry.
///
/// "openai" MUST STAY here even though OpenAI is no longer an offered
/// provider (see `allowed_cloud_url` / `auth_header_for` below, which now
/// refuse it). This mapping is exactly what lets
/// `save_provider_api_key("openai", "")` reach `write_entry`'s empty-string
/// delete path, which is the only way to clear a key a user saved before
/// OpenAI was removed from Settings. Deleting this arm would strand that
/// secret in the keychain with no code path left to remove it. Remove it
/// only once a follow-up unit ships a "forget this saved key" action that
/// does not depend on it.
fn account_for(provider: &str) -> Result<&'static str, String> {
    match provider {
        "anthropic" => Ok(ANTHROPIC_ACCOUNT),
        "gemini" => Ok(GEMINI_ACCOUNT),
        "openai" => Ok(OPENAI_ACCOUNT),
        other => Err(format!("Unknown assistant provider: {other}")),
    }
}

fn provider_entry(provider: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(ASSISTANT_SERVICE, account_for(provider)?)
        .map_err(|error| format!("Could not access the system credential store: {error}"))
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

/// True when the OS keychain holds a non-empty credential for this provider.
/// The secret itself never crosses IPC on this path — the renderer only learns
/// presence so it can enable chat UI.
#[tauri::command]
pub async fn has_provider_api_key(provider: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(read_entry(provider_entry(&provider)?)?
            .map(|key| !key.trim().is_empty())
            .unwrap_or(false))
    })
    .await
    .map_err(|error| format!("Credential task did not complete: {error}"))?
}

/// Set or remove one provider's credential. Whitespace-only input means the
/// user cleared the field and therefore deletes the keychain item. The raw key
/// is accepted only for this write; Tau never returns it to the renderer.
#[tauri::command]
pub async fn save_provider_api_key(provider: String, api_key: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || write_entry(provider_entry(&provider)?, &api_key))
        .await
        .map_err(|error| format!("Credential task did not complete: {error}"))?
}

/// True when the Anthropic keychain entry is present. Same no-secret-IPC rule
/// as [`has_provider_api_key`].
#[tauri::command]
pub async fn has_assistant_api_key() -> Result<bool, String> {
    has_provider_api_key("anthropic".to_string()).await
}

/// Set or remove the Anthropic credential. Whitespace-only input means the
/// user cleared the field and therefore deletes the keychain item.
#[tauri::command]
pub async fn save_assistant_api_key(api_key: String) -> Result<(), String> {
    save_provider_api_key("anthropic".to_string(), api_key).await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudAiProxyRequest {
    provider: String,
    url: String,
    method: String,
    body: Option<String>,
    /// Non-secret request headers from the SDK (Content-Type, anthropic-version,
    /// …). Authorization / x-api-key / Cookie are stripped server-side.
    #[serde(default)]
    headers: Vec<(String, String)>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudAiProxyResponse {
    status: u16,
    body: String,
    headers: Vec<(String, String)>,
}

fn allowed_cloud_url(provider: &str, url: &str) -> Result<(), String> {
    let prefix = match provider {
        "anthropic" => ANTHROPIC_URL_PREFIX,
        "gemini" => GEMINI_URL_PREFIX,
        other => return Err(format!("Unknown assistant provider: {other}")),
    };
    if !url.starts_with(prefix) {
        return Err(format!(
            "Refusing cloud AI proxy to an unapproved host for provider `{provider}`."
        ));
    }
    Ok(())
}

/// Headers the renderer may set on a proxied call: an ALLOWLIST, not a denylist.
///
/// The previous denylist named five secrets to strip and therefore had to be
/// complete to be correct. It was not: `x-goog-api-key` is accepted as
/// credentials by the Gemini endpoint and was not on the list. An allowlist
/// inverts the failure mode - a header nobody considered is dropped rather than
/// forwarded - which is the same reason the deck screen in `spice.rs` allowlists
/// card types instead of banning the dangerous ones.
///
/// The SDK only needs content negotiation and API versioning; the credential is
/// attached by `auth_header_for` from the keychain and never by the caller.
fn header_allowed_from_renderer(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "content-type" | "accept" | "accept-encoding" | "anthropic-version" | "anthropic-beta"
    )
}

fn auth_header_for(provider: &str, api_key: &str) -> Result<(&'static str, String), String> {
    match provider {
        "anthropic" => Ok(("x-api-key", api_key.to_string())),
        "gemini" => Ok(("Authorization", format!("Bearer {api_key}"))),
        other => Err(format!("Unknown assistant provider: {other}")),
    }
}

/// Perform an allowlisted HTTPS call with the provider key read from the OS
/// keychain. The renderer supplies URL/method/body/non-secret headers only —
/// never the credential. Fail-closed on unknown provider, host, or missing key.
#[tauri::command]
pub async fn cloud_ai_proxy(request: CloudAiProxyRequest) -> Result<CloudAiProxyResponse, String> {
    tauri::async_runtime::spawn_blocking(move || proxy_cloud_ai(request))
        .await
        .map_err(|error| format!("Cloud AI proxy task did not complete: {error}"))?
}

fn proxy_cloud_ai(request: CloudAiProxyRequest) -> Result<CloudAiProxyResponse, String> {
    let provider = request.provider.trim().to_ascii_lowercase();
    allowed_cloud_url(&provider, &request.url)?;

    let method = request.method.trim().to_ascii_uppercase();
    if method != "POST" && method != "GET" {
        return Err(format!("Cloud AI proxy refuses HTTP method `{method}`."));
    }

    if let Some(body) = request.body.as_ref() {
        if body.len() > MAX_PROXY_BODY_BYTES {
            return Err("Cloud AI request body exceeds Tau's size limit.".to_string());
        }
    }

    let api_key = read_entry(provider_entry(&provider)?)?
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty())
        .ok_or_else(|| {
            "No API key is saved in the Mac keychain for this provider. Add one in Settings."
                .to_string()
        })?;

    let client = reqwest::blocking::Client::builder()
        .timeout(PROXY_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("Could not build the cloud AI HTTP client: {error}"))?;

    let mut builder = match method.as_str() {
        "GET" => client.get(&request.url),
        _ => client.post(&request.url),
    };

    for (name, value) in &request.headers {
        if header_allowed_from_renderer(name) {
            builder = builder.header(name.as_str(), value.as_str());
        }
    }

    let (auth_name, auth_value) = auth_header_for(&provider, &api_key)?;
    builder = builder.header(auth_name, auth_value);

    if let Some(body) = request.body.as_ref() {
        builder = builder.body(body.clone());
    }

    let response = builder
        .send()
        .map_err(|error| format!("Cloud AI request failed: {error}"))?;
    let status = response.status().as_u16();
    let mut headers = Vec::new();
    for (name, value) in response.headers().iter() {
        if let Ok(value) = value.to_str() {
            headers.push((name.as_str().to_string(), value.to_string()));
        }
    }
    let body = response
        .text()
        .map_err(|error| format!("Cloud AI response body could not be read: {error}"))?;
    if body.len() > MAX_PROXY_BODY_BYTES * 4 {
        return Err("Cloud AI response exceeds Tau's size limit.".to_string());
    }
    Ok(CloudAiProxyResponse {
        status,
        body,
        headers,
    })
}

#[cfg(test)]
mod tests {
    use super::{allowed_cloud_url, auth_header_for, header_allowed_from_renderer};

    #[test]
    fn allowlist_accepts_only_pinned_https_hosts() {
        assert!(allowed_cloud_url("anthropic", "https://api.anthropic.com/v1/messages").is_ok());
        assert!(allowed_cloud_url(
            "gemini",
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
        )
        .is_ok());
        assert!(allowed_cloud_url("anthropic", "https://evil.example/v1/messages").is_err());
        assert!(allowed_cloud_url("gemini", "https://api.anthropic.com/v1/messages").is_err());
        // OpenAI was a first-class provider when Settings had a three-provider
        // Model configuration page. Settings offers only Anthropic and Gemini
        // now (nothing in the assistant could actually use a saved OpenAI
        // key), so the cloud proxy must refuse it like any other unknown
        // provider rather than dispatch a live HTTPS call for it.
        assert!(allowed_cloud_url("openai", "https://api.openai.com/v1/chat/completions").is_err());
        assert!(allowed_cloud_url("openai", "https://api.anthropic.com/v1/messages").is_err());
        assert!(allowed_cloud_url("mistral", "https://api.mistral.ai/v1/chat").is_err());
    }

    #[test]
    fn every_supported_provider_maps_to_its_own_keychain_account() {
        // "openai" stays in this list even though it is no longer offered in
        // Settings or reachable via the cloud proxy: `account_for` is the
        // deletion-only path (see its doc comment) that lets a key saved
        // before OpenAI's removal still be cleared from the keychain.
        let accounts = ["anthropic", "gemini", "openai"]
            .map(|provider| super::account_for(provider).expect("supported provider"));
        // Distinct entries: one provider's key must never overwrite another's.
        assert_eq!(
            accounts.len(),
            accounts
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len()
        );
        // The set stays closed - an arbitrary id cannot name a keychain item.
        assert!(super::account_for("../../etc/passwd").is_err());
        assert!(super::account_for("").is_err());
    }

    #[test]
    fn strips_secret_headers_from_renderer() {
        assert!(!header_allowed_from_renderer("Authorization"));
        assert!(!header_allowed_from_renderer("x-api-key"));
        assert!(!header_allowed_from_renderer("Cookie"));
        assert!(header_allowed_from_renderer("content-type"));
        assert!(header_allowed_from_renderer("anthropic-version"));
    }

    #[test]
    fn auth_header_shapes_match_providers() {
        let (name, value) = auth_header_for("anthropic", "sk-test").unwrap();
        assert_eq!(name, "x-api-key");
        assert_eq!(value, "sk-test");
        let (name, value) = auth_header_for("gemini", "AIza").unwrap();
        assert_eq!(name, "Authorization");
        assert_eq!(value, "Bearer AIza");
        // OpenAI is no longer an offered provider, so it gets no auth header
        // shape at all - same as any other unrecognized provider.
        assert!(auth_header_for("openai", "sk-proj").is_err());
        assert!(auth_header_for("mistral", "x").is_err());
    }

    /// An allowlist, not a denylist. The previous denylist named five secrets to
    /// strip and had to be complete to be correct; it missed `x-goog-api-key`,
    /// which the Gemini endpoint accepts as credentials.
    #[test]
    fn renderer_headers_are_allowlisted_not_denylisted() {
        for forwarded in ["content-type", "Accept", "anthropic-version"] {
            assert!(
                header_allowed_from_renderer(forwarded),
                "dropped a header the SDK needs: {forwarded}"
            );
        }
        for dropped in [
            "authorization",
            "x-api-key",
            "x-goog-api-key",
            "X-Goog-Api-Key",
            "cookie",
            "host",
            "proxy-authorization",
            "x-forwarded-for",
            "anything-nobody-considered",
        ] {
            assert!(
                !header_allowed_from_renderer(dropped),
                "forwarded a header the renderer must not set: {dropped}"
            );
        }
    }

}
