# backend.spec -- PyInstaller build spec for the Storythread Studio backend.
# ============================================================================
# Run with:
#   uv run pyinstaller backend.spec --clean --noconfirm
# (or use scripts/build-backend.ps1 from the repo root which calls this).
#
# Output: dist/storythread-backend.exe  (a single-file frozen FastAPI server)
#
# This spec exists so we can declare the hidden imports PyInstaller's
# static-analysis pass misses. Most of these are uvicorn protocol
# implementations that are loaded by string name at runtime ("auto" loop,
# auto HTTP protocol, etc.) -- the analyzer can't see them, so they have
# to be listed explicitly or the bundled exe crashes on first request.

# -*- mode: python ; coding: utf-8 -*-

block_cipher = None


a = Analysis(
    ['run_backend.py'],
    pathex=['.'],
    binaries=[],
    datas=[],
    hiddenimports=[
        # ── uvicorn internals ──────────────────────────────────────────────
        # Loaded by string name from uvicorn.config based on autodetected
        # capability. PyInstaller can't trace string-based imports.
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.loops.asyncio',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.http.h11_impl',
        'uvicorn.protocols.http.httptools_impl',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.protocols.websockets.wsproto_impl',
        'uvicorn.protocols.websockets.websockets_impl',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'uvicorn.lifespan.off',
        # ── HTTP / parsing ─────────────────────────────────────────────────
        'h11',
        'httptools',
        'websockets',
        'wsproto',
        # ── Backend dependencies that Pyinstaller occasionally misses ──────
        'aiosqlite',
        'httpx',
        'starlette',
        'starlette.middleware',
        'starlette.middleware.cors',
        'pyyaml',
        'yaml',
        # certifi bundles the TLS root certs httpx needs for OpenRouter
        # calls. Without it, the frozen exe sometimes fails SSL verification.
        'certifi',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Trim the bundle. These are pulled in by transitive deps but we
        # don't need them and they each add 5-50 MB to the exe.
        'tkinter',
        'matplotlib',
        'numpy',
        'pandas',
        'scipy',
        'PIL',
        'IPython',
        'jupyter',
        'pytest',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)


pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)


exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='storythread-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    # UPX compression cuts size but occasionally breaks DLL loading on
    # Windows Defender systems. The size savings aren't worth the risk
    # for a tool we want beginners to install painlessly.
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    # console=False hides the cmd window that would otherwise flash open
    # when Tauri spawns the sidecar. Logs still go to stdout (which Tauri
    # can capture) -- they just don't open their own window.
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
