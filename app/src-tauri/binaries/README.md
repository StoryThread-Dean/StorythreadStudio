# Sidecar binaries

This folder holds the **bundled Python backend** that Tauri ships inside the
Storythread Studio installer in release builds. The contents are produced by
`scripts/build-backend.ps1` from the repo root.

## What's here

A frozen-Python `.exe` of the FastAPI backend, named with the platform suffix
Tauri's sidecar mechanism expects:

- `storythread-backend-x86_64-pc-windows-msvc.exe` -- Windows x64

On other platforms you'd add `storythread-backend-aarch64-apple-darwin`,
`storythread-backend-x86_64-unknown-linux-gnu`, etc.

## Why a placeholder is committed

Tauri's build script verifies that every path in `tauri.conf.json`'s
`externalBin` array exists -- even during `cargo check` and `npm run tauri
dev`. Without a file present at the configured path, the Rust crate fails
to compile, breaking dev mode entirely.

The committed `.exe` is a zero-byte placeholder so the build system stops
complaining. It is **never executed** in dev (the sidecar spawn in
`lib.rs` is gated by `#[cfg(not(debug_assertions))]`), and is **always
overwritten** by the real backend exe before `npm run tauri build` runs
during a release.

## Building the real binary

From the repo root:

```powershell
.\scripts\build-backend.ps1
```

This calls PyInstaller against `backend/backend.spec` and copies the
output `.exe` into this folder, replacing the placeholder. Re-run
whenever you change the FastAPI backend code and want to test the
release build flow locally.

## Why this folder is partially gitignored

The placeholder `.exe` is committed so dev mode works for fresh clones,
but **real PyInstaller-built binaries should never be committed** -- they
are 40-80 MB each and would bloat repo history quickly. The `.gitignore`
in this folder permits the placeholder name only; any other build
artifacts here are ignored.
