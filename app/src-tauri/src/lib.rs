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
use std::sync::Mutex;

use tauri::Manager;

#[cfg(not(debug_assertions))]
use tauri_plugin_shell::ShellExt;

#[cfg(not(debug_assertions))]
use tauri_plugin_shell::process::CommandChild;

// Holds the running backend sidecar handle so it stays alive for the entire
// app lifetime. Stored in Tauri's managed state (think: app-wide global) so
// it isn't dropped when the setup closure returns.
//
// Why Mutex<Option<...>>?
//   Tauri's managed state must be Send + Sync so it can be accessed from any
//   thread. Mutex gives us safe interior mutability. Option lets us "take"
//   the child out when we need to kill it on exit.
#[cfg(not(debug_assertions))]
struct BackendSidecar(Mutex<Option<CommandChild>>);

// Kill the sidecar synchronously using taskkill rather than CommandChild::kill().
//
// Why not child.kill()?
//   In tauri-plugin-shell v2, CommandChild::kill() sends a kill command through
//   Tauri's async runtime (tokio). The call returns immediately -- the actual
//   TerminateProcess happens later in an async task. When on_window_event fires
//   and the handler returns, Tauri begins tearing down the runtime, and that
//   async task may never execute. The result: the backend stays alive on port
//   8000 after the window is gone.
//
//   std::process::Command::output() is fully synchronous -- it blocks until
//   taskkill.exe returns, which only happens after TerminateProcess succeeds.
//   The sidecar is guaranteed dead before we return from the event handler.
#[cfg(not(debug_assertions))]
fn kill_sidecar_sync() {
    let _ = std::process::Command::new("taskkill")
        .args(["/F", "/IM", "storythread-backend.exe"])
        .output();
}

// Drop is a belt-and-suspenders fallback in case on_window_event never fires
// (e.g. the app panics or is force-killed from Task Manager before the window
// is cleanly destroyed).
#[cfg(not(debug_assertions))]
impl Drop for BackendSidecar {
    fn drop(&mut self) {
        kill_sidecar_sync();
    }
}

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
            #[cfg(not(debug_assertions))]
            {
                // Kill any stale sidecar left over from a previous session.
                // This handles the upgrade case: the user installs a new version
                // while the old sidecar (from the pre-fix release) is still
                // running and holding port 8000. Without this, the new sidecar
                // fails to bind and the app can't talk to its own backend.
                // taskkill /F /IM kills by exe name; ignore the exit code
                // (non-zero when no matching process exists, which is fine).
                let _ = std::process::Command::new("taskkill")
                    .args(["/F", "/IM", "storythread-backend.exe"])
                    .output();

                // Give the OS a moment to release the port after the kill.
                // The TCP socket stays in TIME_WAIT briefly; 400ms is enough.
                std::thread::sleep(std::time::Duration::from_millis(400));

                // Register the state container first so we can store the
                // child handle into it right after spawning.
                _app.manage(BackendSidecar(Mutex::new(None)));

                match _app.shell().sidecar("storythread-backend") {
                    Ok(cmd) => {
                        match cmd.spawn() {
                            Ok((mut rx, child)) => {
                                // Store the CommandChild handle in managed state.
                                // This is the critical fix: without storing it the
                                // handle is dropped when setup() returns, the process
                                // becomes an orphan, and port 8000 stays open after
                                // the app window closes.
                                let state = _app.state::<BackendSidecar>();
                                *state.0.lock().unwrap() = Some(child);

                                // Detached drain task: discards every event until
                                // the child exits and the channel closes. We MUST
                                // drain the receiver -- the OS pipe buffer (~4 KB on
                                // Windows) fills up quickly (uvicorn's startup logs
                                // alone are enough), and a full buffer causes the
                                // child to block on its next write before it ever
                                // binds to port 8000.
                                tauri::async_runtime::spawn(async move {
                                    while rx.recv().await.is_some() {
                                        // discard stdout/stderr events
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
        // ── Sidecar cleanup on window close ─────────────────────────────
        // When the main (and only) window is destroyed, explicitly kill the
        // backend sidecar. This is the companion to the fix above: storing
        // the handle keeps the process alive; calling kill() here ensures it
        // stops when the writer closes the app.
        //
        // Why WindowEvent::Destroyed rather than CloseRequested?
        //   CloseRequested fires before the window is gone and can be
        //   cancelled (e.g. by an unsaved-changes dialog). Destroyed fires
        //   exactly once, after the window is fully gone -- the right moment
        //   to release OS resources like the port.
        .on_window_event(|_window, _event| {
            #[cfg(not(debug_assertions))]
            if let tauri::WindowEvent::Destroyed = _event {
                // kill_sidecar_sync() blocks until taskkill returns, so the
                // sidecar is dead before this handler returns and Tauri begins
                // tearing down the async runtime.
                kill_sidecar_sync();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
