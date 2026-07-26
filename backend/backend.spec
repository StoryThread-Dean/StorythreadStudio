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
import certifi

block_cipher = None


a = Analysis(
    ['run_backend.py'],
    pathex=['.'],
    binaries=[],
    # Include certifi's cacert.pem so HTTPS calls (OpenRouter) work in the
    # frozen exe. Without this data file, certifi.where() returns a path
    # that doesn't exist inside the bundle and httpx raises an SSLError on
    # every external request. The hidden import above pulls in the Python
    # module; this datas entry pulls in the actual certificate file.
    datas=[
        (certifi.where(), 'certifi'),
        # Name Generator seed data: the JSON files names_store.py loads into
        # names.db at startup. In the frozen exe they extract to
        # sys._MEIPASS/app/data/names -- names_store._data_dir() looks there
        # when sys.frozen is set. Without this entry the packaged app would
        # serve an empty Name Generator.
        ('app/data/names', 'app/data/names'),
    ],
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
        # Export format libraries (DOCX and EPUB generation, Markdown->HTML)
        'docx',
        'docx.opc',
        'docx.opc.part',
        'docx.opc.pkgreader',
        'docx.oxml',
        'docx.oxml.ns',
        'docx.shared',
        'docx.enum.text',
        'ebooklib',
        'ebooklib.epub',
        'markdown',
        'markdown.extensions',
        'markdown.extensions.extra',
        'lxml',
        'lxml.etree',
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
