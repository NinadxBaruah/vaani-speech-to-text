# syntax=docker/dockerfile:1
# Self-hosted STT sidecar: Oriserve/Whisper-Hindi2Hinglish-Swift on faster-whisper (CTranslate2 int8, CPU).
# Works on amd64 and arm64 (e.g. AWS Graviton).

ARG MODEL_NAME=Oriserve/Whisper-Hindi2Hinglish-Swift
# Pinned commit of the official repo, so every build converts exactly the same weights.
ARG MODEL_REVISION=cd0d4d013062d542569135460a79025337df1982

# ---------- convert: HF checkpoint → CTranslate2 int8 (heavy deps stay in this stage) ----------
FROM python:3.12-slim AS convert
ARG MODEL_NAME
ARG MODEL_REVISION
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 HF_HUB_DISABLE_TELEMETRY=1
WORKDIR /work
RUN pip install torch==2.15.0 --index-url https://download.pytorch.org/whl/cpu
COPY requirements-convert.txt .
RUN pip install -r requirements-convert.txt
RUN ct2-transformers-converter \
      --model "$MODEL_NAME" \
      --revision "$MODEL_REVISION" \
      --output_dir /model \
      --quantization int8 \
      --copy_files tokenizer.json preprocessor_config.json \
  && ls -la /model

# ---------- runtime ----------
FROM python:3.12-slim
ARG MODEL_NAME
ARG MODEL_REVISION
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PYTHONUNBUFFERED=1 \
    MODEL_DIR=/model MODEL_NAME=${MODEL_NAME} MODEL_REVISION=${MODEL_REVISION} COMPUTE_TYPE=int8
WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY --from=convert /model /model
COPY app ./app

RUN useradd --create-home --uid 10001 stt
USER stt
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"]
