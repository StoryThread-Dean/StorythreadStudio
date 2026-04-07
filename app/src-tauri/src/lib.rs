// lib.rs -- Tauri Application Entry Point
// =========================================
// This file is the Rust "heart" of the Tauri desktop shell.
// Tauri uses Rust for the native layer (window management, OS integration,
// file system access, etc.) and lets the web frontend (React) handle the UI.
//
// Think of Tauri like a picture frame:
//   - The frame (Rust/Tauri) is the native window, menus, and OS features
//   - The picture (React/Vite) is the UI rendered inside it
//   - Plugins add extra capabilities to the frame (file dialogs, etc.)
//
// We don't need custom Rust commands yet -- our Python FastAPI backend
// handles all business logic. This file mainly registers plugins.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // opener plugin: lets the app open URLs and files in the OS default app
        .plugin(tauri_plugin_opener::init())
        // dialog plugin: provides native OS folder and file picker dialogs
        // Used on the Project Home screen when the user clicks "New Project"
        // or "Open Project" -- shows a real Windows folder browser dialog
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
