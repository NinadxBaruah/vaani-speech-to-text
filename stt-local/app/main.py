"""
Self-hosted speech-to-text sidecar.

Serves Oriserve/Whisper-Hindi2Hinglish-Swift (a whisper-base fine-tune, Apache-2.0) with
faster-whisper / CTranslate2 int8 on CPU. Input: raw PCM16LE mono 16 kHz. Output: Hinglish text.

The Node app does voice-activity segmentation and calls this service once per utterance
(and periodically for live partials). This service is only reachable on the internal network.
See docs/PLAN.md section 13.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Annotated

import numpy as np
from fastapi import FastAPI, HTTPException, Query, Request
from faster_whisper import WhisperModel
from starlette.concurrency import run_in_threadpool

MODEL_DIR = os.environ.get("MODEL_DIR", "/model")
MODEL_NAME = os.environ.get("MODEL_NAME", "Oriserve/Whisper-Hindi2Hinglish-Swift")
MODEL_REVISION = os.environ.get("MODEL_REVISION", "unknown")
COMPUTE_TYPE = os.environ.get("COMPUTE_TYPE", "int8")
CPU_THREADS = int(os.environ.get("CPU_THREADS", str(os.cpu_count() or 2)))
# The model card uses "en"; "hi" did as well or better on our Hindi/English/mixed test clips.
DEFAULT_LANGUAGE = os.environ.get("DEFAULT_LANGUAGE", "hi")

SAMPLE_RATE = 16_000
MAX_SECONDS = 30  # Whisper's context window
MAX_BYTES = SAMPLE_RATE * 2 * MAX_SECONDS

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stt-local")

log.info("loading %s (%s) from %s, compute=%s threads=%d", MODEL_NAME, MODEL_REVISION, MODEL_DIR, COMPUTE_TYPE, CPU_THREADS)
_started = time.perf_counter()
model = WhisperModel(MODEL_DIR, device="cpu", compute_type=COMPUTE_TYPE, cpu_threads=CPU_THREADS, num_workers=1)
log.info("model ready in %.1f s", time.perf_counter() - _started)

# One CTranslate2 worker: serialise requests so a burst of partials can't starve a final.
_lock = threading.Lock()

app = FastAPI(title="stt-local", docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "ok": True,
        "model": MODEL_NAME,
        "revision": MODEL_REVISION,
        "computeType": COMPUTE_TYPE,
        "threads": CPU_THREADS,
    }


@app.post("/transcribe")
async def transcribe(
    request: Request,
    beam: Annotated[int, Query(ge=1, le=5)] = 1,
    language: Annotated[str, Query(pattern=r"^[a-z]{2}$")] = DEFAULT_LANGUAGE,
) -> dict[str, object]:
    body = await request.body()
    if not body or len(body) % 2:
        raise HTTPException(400, "Body must be PCM16LE mono 16 kHz audio")
    if len(body) > MAX_BYTES:
        raise HTTPException(413, f"At most {MAX_SECONDS} s of audio per request")

    audio = np.frombuffer(body, dtype="<i2").astype(np.float32) / 32768.0
    started = time.perf_counter()
    # CPU-bound: run off the event loop; the lock inside keeps it to one inference at a time.
    text = await run_in_threadpool(_transcribe_sync, audio, beam, language)
    inference_ms = round((time.perf_counter() - started) * 1000)
    return {"text": text, "audioS": round(len(audio) / SAMPLE_RATE, 2), "inferenceMs": inference_ms}


def _transcribe_sync(audio: np.ndarray, beam: int, language: str) -> str:
    with _lock:
        segments, _info = model.transcribe(
            audio,
            language=language,
            task="transcribe",
            beam_size=beam,
            vad_filter=False,  # the Node app already segments by voice activity
            condition_on_previous_text=False,
            without_timestamps=True,
            temperature=0.0,
        )
        # Skip segments the model itself flags as probably-not-speech (Whisper hallucinates on noise).
        parts = [
            s.text.strip()
            for s in segments
            if not (s.no_speech_prob > 0.6 and s.avg_logprob < -1.0)
        ]
    return " ".join(p for p in parts if p)
