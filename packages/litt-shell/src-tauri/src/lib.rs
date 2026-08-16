//! LiTT Shell - Tauri library
//!
//! This module contains the Tauri commands and the run function.

pub mod commands;

pub use commands::*;

/// Run the Tauri application.
///
/// This is the main entry point for the desktop application, owned by lib.rs.
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            generate_desktop_token,
            read_workspace_context
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
