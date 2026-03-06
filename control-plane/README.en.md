# Control Plane (UID Ordering + Session Allocation)

Control-plane responsibilities:
- Issue UID from website orders
- Handle bot UID binding and asset handoff
- Allocate dedicated conversation channels

## Storage Modes
- `json` (default): fast local demo, state in `data/db.json`
- `postgres`: production-ready mode with SQL persistence

Select mode via `STORAGE_DRIVER`.
If `STORAGE_DRIVER` is unset but `DATABASE_URL` exists, postgres mode is used.

## Quick Start (JSON)
```bash
cd control-plane
npm install
cp .env.example .env
npm start
```

## Quick Start (PostgreSQL)
```bash
cd control-plane
npm install
cp .env.example .env
# set STORAGE_DRIVER=postgres and DATABASE_URL
npm run db:init
npm start
```

## Docker (Postgres + Control-plane)
```bash
cd control-plane
docker compose up --build
```

## Main APIs
- `POST /api/apply`
- `POST /api/bind`
- `POST /api/handoff`
- `POST /api/allocate-channel`
- `POST /api/release-channel`
- `GET /api/session/:uid/status`
- `GET /api/admin/state`
- `GET /health`

## Security
- Keep `CONTROL_PLANE_KEY` enabled in production.
- Internal bot requests should include `x-control-plane-key`.
