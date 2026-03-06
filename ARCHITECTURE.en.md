# Digital Life Architecture (UID Ordering + Dedicated Bot Sessions)

## 1. Objectives
- The website is the traffic entry point, and every user journey starts with a unique `UID`.
- Users jump from the website to Telegram bot and upload photo/voice samples.
- After assets are complete, the system allocates a dedicated conversation channel based on UID routing.
- The full funnel is traceable: order, bind, asset collection, allocation, session status.

## 2. Current Implementation (This Repo)
- `index.html + script.js`: Landing frontend, creates UID via `POST /api/apply`.
- `bot/server.js`: Telegram onboarding bot for asset intake and handoff callback.
- `control-plane/src/server.js`: Control-plane APIs (order/bind/allocation/status).
- `control-plane/src/storage/*`: storage adapters (`json` / `postgres`).

## 3. Core Flow
1. User submits form on landing -> `control-plane /api/apply` issues UID.
2. Frontend builds Telegram deep link: `/start UID-550W-...`.
3. Bot binds `uid + chatId` -> `control-plane /api/bind`.
4. Bot receives >=1 photo and >=10s voice -> `control-plane /api/handoff`.
5. Control-plane allocates dedicated channel from pool (`telegram/whatsapp`, round-robin).
6. Bot returns allocation result and enters active session mode.

## 4. Data Model (Logical)
- `Order`: order details (planType/applicant/subject/relation/message).
- `Session`: state machine (`created/bound/handoff_pending/allocated/active`).
- `Asset`: photo/audio metadata (path, duration, timestamp).
- `Assignment`: UID-to-channel mapping (kind/channelId/entrypoint).

## 5. Allocation Strategy
- Default strategy: round-robin in `channelPool`.
- Prefer idle channels; allow reuse when pool is saturated (`reused=true`).
- Fallback to virtual assignment when no pool is configured.

## 6. Repo Strategy
- Current stage: monorepo (landing + bot + control-plane) for speed.
- Recommended split for team scaling:
  - `digital-life-landing` (static frontend + client SDK)
  - `digital-life-control-plane` (backend APIs)
  - `digital-life-bot` (Telegram/WhatsApp adapters)
- Split when independent release cadence, permissions, and SLA are required.

## 7. Production Next Steps
- Data layer: PostgreSQL is implemented; add Redis for queue/locks.
- Job layer: BullMQ/SQS for async media processing and retries.
- Observability: Sentry + Loki/ELK + Prometheus/Grafana.
- Security:
  - move bot tokens/API keys into secret manager;
  - enforce `x-control-plane-key` + IP allowlist for internal APIs.
