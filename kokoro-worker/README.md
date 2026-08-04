# kokoro-worker

The free local narration engine for Storythread Studio's Audiobook
Converter. A small standalone HTTP server wrapping Kokoro-82M, spawned as
a subprocess by the Storythread backend and reachable only on localhost.
Ships as its own on-demand download (`kokoro-worker-<version>-win64.zip`,
built by `scripts/build-worker.ps1`, published as a GitHub PRERELEASE so
it never disturbs the app updater's `releases/latest`).

## Dev mode

The backend auto-detects this checkout and runs it via `uv run` -- no
build needed during development. Model files are not committed; download
them once into `models/`:

- `kokoro-v1.0.onnx` and `voices-v1.0.bin` from
  https://github.com/thewh1teagle/kokoro-onnx/releases (model-files-v1.0)

Set `STORYTHREAD_DISABLE_DEV_WORKER=1` in the backend's environment to
hide this checkout and rehearse the packaged install path.

## Bundled licenses (document per spec section 26)

| Component | License | Notes |
|---|---|---|
| Kokoro-82M model | Apache-2.0 | hexgrad/Kokoro-82M; commercial use permitted |
| kokoro-onnx | MIT | inference wrapper |
| onnxruntime | MIT | CPU execution provider only |
| espeakng-loader (espeak-ng) | GPL-3.0 | phonemizer fallback data/library. Storythread Studio is free and open source; the worker is a separate program with sources in this repository, satisfying GPL source-availability. Revisit if the app's licensing posture ever changes (spec 14.2 notes the misaki-without-espeak alternative). |
| phonemizer-fork, segments, csvw, language_tags | MIT/Apache/BSD family | G2P chain |
| FastAPI / uvicorn / pydantic | MIT/BSD | HTTP surface |

`WORKER_VERSION` in `main.py` is the single source of truth for the
artifact version; it joins Storythread's generated-state hashes, so a new
worker build correctly marks previously generated audio as stale.
