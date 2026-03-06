# digital-life-landing

UID 驱动的数字生命体验系统：官网下单 -> Telegram 采集素材 -> 控制面分配独立会话。

## System Architecture
```mermaid
flowchart LR
  U["User"] --> W["Landing (GitHub Pages / Vercel)"]
  W -->|"POST /api/apply"| C["Control Plane API"]
  C -->|"UID + Deep Link"| W
  U -->|"/start UID-..."| T["Telegram Bot"]
  T -->|"POST /api/bind"| C
  U -->|"photo + voice"| T
  T -->|"POST /api/handoff"| C
  C --> A["Session Allocator (Round Robin)"]
  A --> CH["Channel Pool (TG / WhatsApp)"]
  C --> DB[("JSON or PostgreSQL")]
  T --> FS[("Local Asset Storage")]
```

## Repository Layout
- `index.html / script.js / style.css`: 官网前端（静态可直接部署）
- `bot/`: Telegram onboarding bot（UID 绑定、素材采集、回调分配）
- `control-plane/`: UID 下单、状态管理、独立会话分配 API（`json/postgres` 双存储）

## Quick Start (Local)
1. Start control-plane
```bash
cd control-plane
npm install
cp .env.example .env
npm start
```

2. Start bot
```bash
cd bot
npm install
cp .env.example .env
# set TELEGRAM_BOT_TOKEN + CONTROL_PLANE_BASE_URL + CONTROL_PLANE_KEY
node server.js
```

3. Start landing
```bash
cd /Users/hongwen/.openclaw/workspace/digital-life-landing
python3 -m http.server 8080
```

Visit `http://localhost:8080`.

## PostgreSQL Mode
```bash
cd control-plane
cp .env.example .env
# set STORAGE_DRIVER=postgres
# set DATABASE_URL=postgresql://user:pass@host:5432/db
npm install
npm run db:init
npm start
```

## Docker Deployment (control-plane + postgres)
```bash
cd control-plane
docker compose up --build
```

## Production Deployment
1. Frontend: deploy repo root static files to GitHub Pages or Vercel.
2. Control-plane: deploy `control-plane/` as Node service (Render/Fly.io/Railway/VM).
3. Bot: deploy `bot/` as long-running Node process.
4. Storage: use PostgreSQL in production.
5. Secrets: set `CONTROL_PLANE_KEY`, rotate Telegram bot token.

## Required Environment Variables
### control-plane
- `PORT`
- `PUBLIC_BASE_URL`
- `TG_BOT_USERNAME`
- `CONTROL_PLANE_KEY`
- `STORAGE_DRIVER` (`json` or `postgres`)
- `DATABASE_URL` (required for postgres)
- `DATABASE_SSL` (`disable` or `require`)
- `CONTROL_PLANE_DATA_DIR`
- `CHANNEL_POOL_FILE`

### bot
- `TELEGRAM_BOT_TOKEN`
- `MIN_AUDIO_SECONDS`
- `BOT_DATA_DIR`
- `CONTROL_PLANE_BASE_URL`
- `CONTROL_PLANE_KEY`
- `PREFERRED_CHANNEL_KINDS`

## Key API Endpoints
- `POST /api/apply`
- `POST /api/bind`
- `POST /api/handoff`
- `POST /api/allocate-channel`
- `POST /api/release-channel`
- `GET /api/session/:uid/status`
- `GET /api/admin/state`
- `GET /health`

## Security Notes
- Never commit `.env` files.
- `CONTROL_PLANE_KEY` must be enabled in production.
- Bot token has appeared in chat history previously; rotate it before production.

## Additional Docs
- Architecture (ZH): [ARCHITECTURE.md](./ARCHITECTURE.md)
- Architecture (EN): [ARCHITECTURE.en.md](./ARCHITECTURE.en.md)
- Hosting Plan (ZH): [HOSTING_PLAN.md](./HOSTING_PLAN.md)
- Hosting Plan (EN): [HOSTING_PLAN.en.md](./HOSTING_PLAN.en.md)
- Control-plane (ZH): [control-plane/README.md](./control-plane/README.md)
- Control-plane (EN): [control-plane/README.en.md](./control-plane/README.en.md)
- PM Meeting Brief (ZH): [docs/MEETING_BRIEF.zh-CN.md](./docs/MEETING_BRIEF.zh-CN.md)
- PM Meeting Brief (EN): [docs/MEETING_BRIEF.en.md](./docs/MEETING_BRIEF.en.md)
- Bilingual Talk Track: [docs/BILINGUAL_TALK_TRACK.md](./docs/BILINGUAL_TALK_TRACK.md)
