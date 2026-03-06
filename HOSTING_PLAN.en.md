# Hosting and Procurement Plan

## 1. MVP Setup (2-4 weeks)
- Static landing: Cloudflare Pages / Vercel
- Control-plane backend: 1 instance (2 vCPU / 4GB) or Render/Fly.io
- Bot runtime: 1 instance (2 vCPU / 2GB), can be co-hosted with backend in early stage
- Database: 1 PostgreSQL instance (Supabase/Neon/RDS)
- Object storage: S3/R2 for uploaded and generated assets
- Domain + TLS: Cloudflare

## 2. Services to Purchase/Enable
1. Cloud compute (minimum 2 instances)
- Use: control-plane API + bot runtime
- Region suggestion: Tokyo/Singapore for lower APAC latency

2. Managed PostgreSQL
- Use: UID orders, session state, allocation log, audit trails
- Baseline: 1 vCPU / 2GB RAM / 20GB SSD

3. Object storage (S3/R2)
- Use: photos, voice, video inventory
- Requirement: lifecycle policies (tiering/archive)

4. Queue system (optional but recommended)
- Use: allocation jobs, media processing, retries
- Options: Redis + BullMQ / SQS

5. Observability stack
- Logs: Loki/ELK
- Errors: Sentry
- Metrics: Prometheus + Grafana

6. Messaging resources
- Telegram bot (already in use)
- WhatsApp Business API (Twilio/360dialog/Meta BSP)
- For true dedicated-number sessions, multiple senders/accounts are needed

## 3. MVP Cost Range
- Infra (compute + DB + storage + monitoring): ~USD 80-300/month (depends on traffic/storage)
- WhatsApp costs: conversation/template based, country-dependent

## 4. Deployment Topology
- `landing`: static hosting
- `control-plane`: Node.js API (containerized recommended)
- `bot`: Node.js long-running worker (polling/webhook)
- `db`: PostgreSQL
- `storage`: S3/R2

## 5. Mandatory Pre-Launch Checklist
- Rotate all bot tokens (token exposure happened in chat history)
- Set strong random `CONTROL_PLANE_KEY`
- Enforce HTTPS + CORS allowlist
- Enable backup policy (daily DB snapshot + storage lifecycle)
