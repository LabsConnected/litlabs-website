//! Tauri commands for LiTT Shell desktop app

use std::time::{SystemTime, UNIX_EPOCH};
use base64::Engine as _;

/// Generate a terminal auth token for the desktop runtime
///
/// This command generates a short-lived JWT-style token that can be used
/// to authenticate with the terminal-server. The token signature is created
/// using the TERMINAL_AUTH_SECRET environment variable.
///
/// Args:
/// - cwd: Optional working directory to include in the token payload
///
/// Returns:
/// - A token string in the format: base64url(payload).base64url(signature)
///   OR "dev-" + base64url(payload) for unsigned dev tokens
///
/// Security: The secret key is only accessible from the Rust backend,
/// never exposed to the frontend.
#[tauri::command]
pub async fn generate_desktop_token(cwd: Option<String>) -> Result<String, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();

    let payload = if let Some(path) = cwd {
        serde_json::json!({
            "sub": "desktop-local",
            "aud": "littree-terminal",
            "iat": timestamp as i64,
            "exp": (timestamp + 3600) as i64,
            "cwd": path
        })
    } else {
        serde_json::json!({
            "sub": "desktop-local",
            "aud": "littree-terminal",
            "iat": timestamp as i64,
            "exp": (timestamp + 3600) as i64
        })
    };

    let payload_str = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    let encoded_payload = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload_str);

    // Check if TERMINAL_AUTH_SECRET is configured for signed tokens
    if let Ok(secret) = std::env::var("TERMINAL_AUTH_SECRET") {
        if secret.len() >= 32 {
            // Compute HMAC-SHA256 using the hmac and sha2 crates
            let signature = {
                use hmac::{Hmac, Mac};
                use sha2::Sha256;
                type HmacSha256 = Hmac<Sha256>;

                let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
                    .map_err(|_| "HMAC key error")?;
                mac.update(encoded_payload.as_bytes());
                let result = mac.finalize();
                base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(result.into_bytes())
            };

            return Ok(format!("{}.{}", encoded_payload, signature));
        }
    }

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
