# kokoro-worker.spec -- freezes the local narrator into kokoro-worker.exe.
# ========================================================================
# ONEDIR build (exe + _internal/), NOT onefile: the artifact ships as a
# zip that also carries models/ (~340MB), and onedir starts faster --
# no self-extraction of a 100MB archive on every worker spawn.
#
# The tricky dependencies, all handled via collect_all so their DATA
# files ride along (PyInstaller only auto-collects code):
#   espeakng_loader -- bundles espeak-ng.dll + espeak-ng-data inside the
#                      package; without its data the phonemizer dies at
#                      runtime with a cryptic espeak error.
#   phonemizer (phonemizer-fork) + segments + csvw + language_tags --
#                      the G2P chain kokoro-onnx drives.
#   kokoro_onnx     -- config/data files.
# onnxruntime has a builtin hook (DLLs collected automatically).
#
# Build:  uv run pyinstaller kokoro-worker.spec --noconfirm
# Output: dist/kokoro-worker/kokoro-worker.exe (+ _internal/)
# The release zip = that folder + models/ (see scripts/build-worker.ps1).

from PyInstaller.utils.hooks import collect_all

datas, binaries, hiddenimports = [], [], []
for package in ("kokoro_onnx", "espeakng_loader", "phonemizer",
                "segments", "csvw", "language_tags"):
    d, b, h = collect_all(package)
    datas += d
    binaries += b
    hiddenimports += h

a = Analysis(
    ["main.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="kokoro-worker",
    debug=False,
    strip=False,
    upx=False,
    # Console app: stdout/stderr land in the backend's worker.log; the
    # backend spawns with CREATE_NO_WINDOW so users never see a console.
    console=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="kokoro-worker",
)
