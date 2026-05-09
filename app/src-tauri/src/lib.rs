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
// Plugins registered here:
//   - opener:  open URLs / files in the OS default app
//   - dialog:  native folder/file picker dialogs
//   - shell:   spawn the bundled Python backend as a sidecar (release only)
//   - updater: check GitHub Releases for new versions on launch
//   - process: let the JS side trigger app restart after an update installs

#[cfg(not(debug_assertions))]
use tauri_plugin_shell::ShellExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // opener plugin: lets the app open URLs and files in the OS default app
        .plugin(tauri_plugin_opener::init())
        // dialog plugin: provides native OS folder and file picker dialogs
        // Used on the Project Home screen when the user clicks "New Project"
        // or "Open Project" -- shows a real Windows folder browser dialog
        .plugin(tauri_plugin_dialog::init())
        // shell plugin: required for sidecar spawning in release builds.
        // In dev (npm run tauri dev) the backend is started manually via
        // 'uv run uvicorn'; the sidecar binary doesn't even exist yet --
        // it's produced by scripts/build-backend.ps1 at release time.
        .plugin(tauri_plugin_shell::init())
        // updater plugin: registers the JS bridge so the frontend can call
        // .check() on launch and downloadAndInstall() when the writer
        // approves an update. The signing public key + endpoint URL come
        // from tauri.conf.json's "plugins.updater" block.
        .plugin(tauri_plugin_updater::Builder::new().build())
        // process plugin: exposes 'relaunch' to JS so the update flow can
        // restart the app cleanly after the installer replaces the binary.
        .plugin(tauri_plugin_process::init())
        .setup(|_app| {
            // ── Sidecar spawn (release builds only) ─────────────────────
            // Production builds embed a frozen Python+FastAPI exe (built by
            // scripts/build-backend.ps1). We spawn it on app start so the
            // React frontend can talk to localhost:8000 without the user
            // having to install Python.
            //
            // Why guarded by #[cfg(not(debug_assertions))]?
            //   In dev mode the sidecar binary doesn't exist (Tauri only
            //   bundles it during `tauri build`). Trying to spawn it would
            //   fail and noisily crash the dev startup. The dev workflow
            //   has the developer running 'uv run uvicorn' in a separate
            //   terminal; that's fine.
            //
            // Lifecycle: Tauri tracks spawned child processes and kills
            // them when the app exits, so we don't have to stash the
            // CommandChild handle for explicit cleanup.
            #[cfg(not(debug_assertions))]
            {
                match _app.shell().sidecar("storythread-backend") {
                    Ok(cmd) => {
                        // Spawn returns (Receiver<CommandEvent>, CommandChild).
                        // We MUST drain the receiver: Tauri pipes the child's
                        // stdout/stderr through it, and if nothing reads, the
                        // OS pipe buffer (~4KB on Windows) fills up and the
                        // child blocks on its next write. uvicorn's startup
                        // logs are enough to fill it, so without draining the
                        // backend hangs forever before binding to port 8000.
                        match cmd.spawn() {
                            Ok((mut rx, _child)) => {
                                // Detached drain task: discards every event
                                // until the child exits and the channel
                                // closes. Tauri kills the child on app exit,
                                // which closes the channel, which ends this
                                // loop. No explicit cleanup required.
                                tauri::async_runtime::spawn(async move {
                                    while rx.recv().await.is_some() {
                                        // discard
                                    }
                                });
                            }
                            Err(e) => {
                                eprintln!("Failed to spawn backend sidecar: {e}");
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("Sidecar 'storythread-backend' not found: {e}");
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
