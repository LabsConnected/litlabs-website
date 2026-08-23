//! Tauri commands for LiTT Shell desktop app

use std::time::{SystemTime, UNIX_EPOCH};
use base64::Engine as _;

/// Exchange a Clerk token for a short-lived terminal JWT.
///
/// The desktop app NEVER holds TERMINAL_AUTH_SECRET. Instead, it obtains
/// a Clerk session token from the embedded webview's Clerk session and
/// exchanges it for a terminal JWT via the terminal-server's
/// /api/token-exchange endpoint. The server verifies the Clerk token
/// and mints the terminal JWT server-side.
///
/// Args:
/// - clerkToken: The Clerk session JWT (from the webview's Clerk session)
/// - terminalUrl: The terminal-server URL (defaults to http://127.0.0.1:4001)
///
/// Returns:
/// - A terminal JWT string that can be used for /api/command, /api/runtime, etc.
#[tauri::command]
pub async fn exchange_clerk_token(
    clerk_token: String,
    terminal_url: Option<String>,
) -> Result<String, String> {
    let base_url = terminal_url
        .unwrap_or_else(|| {
            std::env::var("LITT_TERMINAL_URL").unwrap_or_else(|_| "http://127.0.0.1:4001".to_string())
        });

    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/api/token-exchange", base_url))
        .header("Authorization", format!("Bearer {}", clerk_token))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Token exchange request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Token exchange failed ({}): {}", status, body));
    }

    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse token exchange response: {}", e))?;

    let terminal_token = payload["terminalToken"]
        .as_str()
        .ok_or("Missing terminalToken in response")?;

    Ok(terminal_token.to_string())
}

/// Generate a dev token for local development only.
///
/// This is ONLY used when no Clerk token is available — i.e. local dev
/// mode without authentication. It produces an unsigned "dev-" prefixed
/// token that the terminal-server accepts only when TERMINAL_AUTH_SECRET
/// is not configured (local dev mode).
///
/// HARD-DISABLED in production builds. The `cfg!(debug_assertions)` check
/// ensures this command always returns an error in release builds —
/// no unsigned dev tokens can ever be generated in production.
///
/// In production, the desktop app must use exchange_clerk_token instead.
#[tauri::command]
pub async fn generate_dev_token(cwd: Option<String>) -> Result<String, String> {
    // ─── Hard-disable in production builds ────────────────────────
    // debug_assertions is false in release builds. This is a compile-time
    // check — the entire function body is dead code in release builds
    // and the optimizer removes it. There is no runtime path that can
    // bypass this in a production binary.
    if !cfg!(debug_assertions) {
        return Err(
            "generate_dev_token is disabled in production builds. \
             Use exchange_clerk_token with a Clerk session token."
                .to_string(),
        );
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();

    let payload = if let Some(path) = cwd {
        serde_json::json!({
            "sub": "desktop-local-dev",
            "aud": "littree-terminal",
            "iat": timestamp as i64,
            "exp": (timestamp + 3600) as i64,
            "cwd": path
        })
    } else {
        serde_json::json!({
            "sub": "desktop-local-dev",
            "aud": "littree-terminal",
            "iat": timestamp as i64,
            "exp": (timestamp + 3600) as i64
        })
    };

    let payload_str = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    let encoded_payload = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload_str);

    // Dev mode: unsigned token with "dev-" prefix for local development
    Ok(format!("dev-{}", encoded_payload))
}

/// Read workspace context from the desktop-cwd.json file
///
/// This reads the workspace context written by the CLI when launching the desktop app.
#[tauri::command]
pub async fn read_workspace_context() -> Result<String, String> {
    let home = dirs::home_dir()
        .ok_or_else(|| "Could not determine home directory".to_string())?;
    let context_path = home.join(".litt").join("runtime").join("desktop-cwd.json");

    let content = std::fs::read_to_string(context_path)
        .map_err(|e| format!("Could not read workspace context: {}", e))?;

    Ok(content)
}
