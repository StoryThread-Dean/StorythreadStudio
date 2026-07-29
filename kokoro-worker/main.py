# kokoro-worker/main.py -- the free local narrator engine.
# =========================================================
# A tiny standalone HTTP server wrapping Kokoro-82M (via kokoro-onnx).
# The Storythread backend spawns this as a SUBPROCESS and talks to it
# over localhost -- the worker never touches workspaces, settings, or
# the network beyond 127.0.0.1. One job: text in, audio out.
#
# Why a separate program (spec 14.1): the Storythread backend ships as a
# frozen PyInstaller exe and cannot install the ONNX runtime into itself
# at runtime. This worker is its own artifact -- installed on demand,
# versioned independently, disposable.
#
# Endpoints:
#   GET  /health      {ok, worker_version, model, voices_loaded}
#   GET  /voices      {voices: [{id, label, language, gender_presentation}]}
#   POST /synthesize  {text, voice, speed} -> WAV bytes + X-Duration-Seconds
#
# Run: python main.py --port 8811 [--models-dir models]

import argparse
import io
import sys
import wave

import numpy as np
import uvicorn
from fastapi import FastAPI, HTTPException, Response
from kokoro_onnx import Kokoro
from pydantic import BaseModel

# Bumped on every released worker build. Joins the generated-state hash
# on the Storythread side (spec 24.1) -- a retrained model or tokenizer
# change here must mark existing audio stale over there.
WORKER_VERSION = "kokoro-worker 0.1.0"
MODEL_ID = "kokoro-82m-v1.0"

app = FastAPI(title="Storythread Kokoro Worker")
kokoro: Kokoro | None = None

# Kokoro voice ids follow a 2-letter prefix convention: a=American,
# b=British; f=female, m=male. Decode it into friendly metadata so the
# Storythread UI can group voices without hard-coding names twice.
_ACCENT = {"a": "American", "b": "British"}
_GENDER = {"f": "female", "m": "male"}


def _voice_meta(voice_id: str) -> dict:
    accent = _ACCENT.get(voice_id[:1], "Other")
    gender = _GENDER.get(voice_id[1:2], "other")
    name = voice_id.split("_", 1)[-1].capitalize()
    return {
        "id": voice_id,
        "label": f"{name} ({accent} {gender})",
        "language": "en-US" if accent == "American" else "en-GB",
        "gender_presentation": gender,
    }


@app.get("/health")
def health():
    return {
        "ok": kokoro is not None,
        "worker_version": WORKER_VERSION,
        "model": MODEL_ID,
        "voices_loaded": len(kokoro.get_voices()) if kokoro else 0,
    }


@app.get("/voices")
def voices():
    if kokoro is None:
        raise HTTPException(status_code=503, detail="Model not loaded.")
    return {"voices": [_voice_meta(v) for v in sorted(kokoro.get_voices())]}


class SynthesizeRequest(BaseModel):
    text: str
    voice: str
    speed: float = 1.0


@app.post("/synthesize")
def synthesize(request: SynthesizeRequest):
    if kokoro is None:
        raise HTTPException(status_code=503, detail="Model not loaded.")
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Empty text.")
    try:
        samples, sample_rate = kokoro.create(
            request.text, voice=request.voice, speed=request.speed, lang="en-us",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Synthesis failed: {e}")

    duration = float(len(samples)) / float(sample_rate)

    # float32 [-1, 1] -> 16-bit PCM WAV in memory. The Storythread side
    # transcodes to the canonical FLAC intermediate at assembly stage;
    # WAV keeps this worker dependency-free beyond kokoro itself.
    pcm = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2")
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm.tobytes())

    return Response(
        content=buffer.getvalue(),
        media_type="audio/wav",
        headers={"X-Duration-Seconds": f"{duration:.3f}"},
    )


def main() -> None:
    global kokoro
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--models-dir", default="models")
    args = parser.parse_args()

    try:
        kokoro = Kokoro(
            f"{args.models_dir}/kokoro-v1.0.onnx",
            f"{args.models_dir}/voices-v1.0.bin",
        )
    except Exception as e:
        # A clear startup failure beats a mysteriously dead health check.
        print(f"FATAL: could not load Kokoro model from {args.models_dir}: {e}",
              file=sys.stderr)
        raise SystemExit(2)

    # localhost only -- this worker must never be reachable off-machine.
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
