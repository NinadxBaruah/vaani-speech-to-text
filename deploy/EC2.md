# Deploying to AWS EC2

Three containers on one instance:

| Container   | What                                                                     | Exposed       |
| ----------- | ------------------------------------------------------------------------ | ------------- |
| `app`       | Node: API, live-transcription WebSocket, built web app (port 3000)       | internal only |
| `stt-local` | Python: self-hosted Whisper Hinglish model on faster-whisper (port 8000) | internal only |
| `caddy`     | Reverse proxy with a free Let's Encrypt certificate                      | 80, 443       |

**HTTPS is required**: browsers block the microphone on plain `http://` (except `localhost`).

## Current instance

- `t4g.large` (2 vCPU AWS Graviton / ARM64, 8 GB RAM, 19 GB disk), Ubuntu 24.04, region `ap-southeast-1`.
- Public IP `13.228.120.191`, domain **`vaani.myonlineclipboard.com`** (A record). Without a domain,
  `13-228-120-191.sslip.io` also works.
  (Use an Elastic IP so the address survives a stop/start.)
- ARM64 is fine: both images are built on the instance from multi-arch base images.

## 1. Security group

Inbound: **22** (your IP only), **80** and **443** (anywhere). Port 80 is needed for the certificate challenge.

## 2. Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker
```

## 3. Get the code and secrets

```bash
git clone <your-repo-url> stt && cd stt
cp .env.example .env && nano .env      # set SARVAM_API_KEY and DB_URI (LOCAL_STT_URL is set by compose)
```

## 4. Run

```bash
cd deploy
echo "DOMAIN=vaani.myonlineclipboard.com" > .env   # compose reads deploy/.env; survives restarts and sudo
sudo docker compose up -d --build
```

The first build takes several minutes: the `stt-local` image downloads the model from Hugging Face and
converts it to CTranslate2 int8. Database migrations run automatically when `app` starts.

Check it:

```bash
docker compose ps                              # all three "running" / "healthy"
docker compose logs -f app stt-local
curl https://$DOMAIN/api/health                # {"ok":true,"db":true}
curl -s https://$DOMAIN/api/meta | grep -o '"available":[a-z]*'   # both engines true
```

## Updating

```bash
git pull && cd deploy && sudo docker compose up -d --build
```

## Sizing notes

- `stt-local` is capped at 2 GB RAM in compose; it idles at ~160 MB. One inference runs at a time.
  Measured on a 4-thread x86 laptop: ~0.7–1.7 s per phrase. Whisper always encodes a 30 s window, so cost is
  per phrase rather than per second of audio. Expect it to be somewhat slower on the 2 vCPU Graviton.
- Many simultaneous self-hosted sessions will queue. For more users, add `stt-local` replicas or a bigger
  instance; Sarvam sessions are unaffected because they don't use our CPU.
