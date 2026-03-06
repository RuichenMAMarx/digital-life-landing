# Control Plane (UID Ordering + Session Allocation)

Control-plane responsibilities:
- Issue UID from website orders
- Handle bot UID binding and asset handoff
- Allocate dedicated conversation channels
- Orchestrate Yaya runtime provisioning (optional webhook mode)

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
- `POST /api/handoff` (allocation + runtime provisioning trigger)
- `POST /api/order/payment` (payment callback/manual payment patch)
- `POST /api/payment/webhook/stripe` (Stripe payment callback with signature verification + idempotent event log)
- `POST /api/allocate-channel`
- `POST /api/release-channel`
- `POST /api/runtime/callback` (async runtime status callback)
- `GET /api/session/:uid/status`
- `GET /api/admin/state`
- `GET /health`

## Runtime Orchestration Config
- `RUNTIME_ORCHESTRATOR_MODE=none`: default demo mode, returns ready directly
- `RUNTIME_ORCHESTRATOR_MODE=webhook`: calls `RUNTIME_ORCHESTRATOR_URL` to provision runtime
- Related vars:
  - `RUNTIME_ORCHESTRATOR_URL`
  - `RUNTIME_ORCHESTRATOR_KEY`
  - `RUNTIME_ORCHESTRATOR_TIMEOUT_MS`

## Security
- Keep `CONTROL_PLANE_KEY` enabled in production.
- Internal bot requests should include `x-control-plane-key`.

## Payment Gate Config
- `REQUIRE_PAYMENT_FOR_HANDOFF=true`: only `paid/waived` orders can enter `/api/handoff`
- `FREE_PLAN_TYPES=trial,demo`: these plans are auto-marked as `waived` at order creation
- Supported payment statuses: `pending | paid | waived | failed | refunded | canceled`

## Stripe Webhook Config
- `STRIPE_WEBHOOK_SECRET`: Stripe endpoint secret
- `STRIPE_WEBHOOK_REQUIRE_SIGNATURE=true`: whether to enforce `stripe-signature` validation
- `STRIPE_WEBHOOK_TOLERANCE_SECONDS=300`: signature timestamp tolerance window
- Include `uid` (or `order_id/orderId`) in Stripe Checkout metadata for reliable order matching
