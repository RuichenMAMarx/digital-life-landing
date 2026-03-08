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
  C -->|"runtime provision webhook"| R["Yaya Runtime (openclaw)"]
  R -->|"POST /api/runtime/callback"| C
  C --> DB[("JSON or PostgreSQL")]
  T --> FS[("Local Asset Storage")]
```

## Repository Layout
- `index.html / script.js / style.css`: 官网前端（静态可直接部署）
- `bot/`: Telegram onboarding bot（UID 绑定、素材采集、回调分配）
- `control-plane/`: UID 下单、状态管理、独立会话分配 API（`json/postgres` 双存储）

## Quick Start (Local)
0. Use project Node runtime (recommended)
```bash
nvm install
nvm use
./scripts/npmw -v
```

1. Start control-plane
```bash
./scripts/npmw --prefix control-plane install
cp .env.example .env
./scripts/npmw --prefix control-plane start
```

2. Start bot
```bash
./scripts/npmw --prefix bot install
cp .env.example .env
# set TELEGRAM_BOT_TOKEN + CONTROL_PLANE_BASE_URL + CONTROL_PLANE_KEY
node server.js
```

3. Start landing
```bash
cp config.local.example.js config.local.js
# Ensure you are at repository root
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
- `POST /api/order/payment`
- `POST /api/payment/webhook/stripe`
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
- Multi-System Integration (ZH): [docs/SYSTEM_INTEGRATION.zh-CN.md](./docs/SYSTEM_INTEGRATION.zh-CN.md)
- Multi-System Integration (EN): [docs/SYSTEM_INTEGRATION.en.md](./docs/SYSTEM_INTEGRATION.en.md)
- Architecture (ZH): [ARCHITECTURE.md](./ARCHITECTURE.md)
- Architecture (EN): [ARCHITECTURE.en.md](./ARCHITECTURE.en.md)
- Hosting Plan (ZH): [HOSTING_PLAN.md](./HOSTING_PLAN.md)
- Hosting Plan (EN): [HOSTING_PLAN.en.md](./HOSTING_PLAN.en.md)
- Control-plane (ZH): [control-plane/README.md](./control-plane/README.md)
- Control-plane (EN): [control-plane/README.en.md](./control-plane/README.en.md)
- PM Meeting Brief (ZH): [docs/MEETING_BRIEF.zh-CN.md](./docs/MEETING_BRIEF.zh-CN.md)
- PM Meeting Brief (EN): [docs/MEETING_BRIEF.en.md](./docs/MEETING_BRIEF.en.md)
- User Journey Map (ZH): [docs/USER_JOURNEY_MAP.zh-CN.md](./docs/USER_JOURNEY_MAP.zh-CN.md)
- User Journey Map (EN): [docs/USER_JOURNEY_MAP.en.md](./docs/USER_JOURNEY_MAP.en.md)
- Investor Product Memo (ZH): [docs/INVESTOR_PRODUCT_MEMO.zh-CN.md](./docs/INVESTOR_PRODUCT_MEMO.zh-CN.md)
- Investor Product Memo (EN): [docs/INVESTOR_PRODUCT_MEMO.en.md](./docs/INVESTOR_PRODUCT_MEMO.en.md)
- Bilingual Talk Track (Investor-facing): [docs/BILINGUAL_TALK_TRACK.md](./docs/BILINGUAL_TALK_TRACK.md)
- Orchestration Runbook (ZH): [docs/ORCHESTRATION_RUNBOOK.zh-CN.md](./docs/ORCHESTRATION_RUNBOOK.zh-CN.md)
- Orchestration Runbook (EN): [docs/ORCHESTRATION_RUNBOOK.en.md](./docs/ORCHESTRATION_RUNBOOK.en.md)
