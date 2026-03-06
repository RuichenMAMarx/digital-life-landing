# Control Plane (UID 下单 + 会话分配)

English version: [README.en.md](./README.en.md)

控制面负责：
- 官网 `UID` 下单与状态追踪
- Telegram bot 的 UID 绑定与素材回传
- 独立会话分配（轮询策略）
- 丫丫运行时实例化编排（可选 webhook）

## 存储模式
- `json`（默认）：快速演示，状态保存在 `data/db.json`
- `postgres`：生产建议，状态保存在 PostgreSQL

通过 `STORAGE_DRIVER` 控制，未配置时若检测到 `DATABASE_URL` 则自动使用 `postgres`。

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
# 设置 STORAGE_DRIVER=postgres + DATABASE_URL
npm run db:init
npm start
```

## Docker (PostgreSQL + Control-plane)
```bash
cd control-plane
docker compose up --build
```

## 主要接口
- `POST /api/apply`：官网创建 UID
- `POST /api/bind`：bot 绑定 `uid <-> tg chat`
- `POST /api/handoff`：素材齐后请求分配独立会话，并触发运行时实例化
- `POST /api/order/payment`：更新订单支付状态（支付回调/人工补单）
- `POST /api/payment/webhook/stripe`：Stripe 支付回调（签名校验 + 幂等事件）
- `POST /api/allocate-channel`：手动分配（运维）
- `POST /api/release-channel`：释放会话占用
- `POST /api/runtime/callback`：运行时异步回传实例化状态
- `GET /api/session/:uid/status`：查询状态
- `GET /api/admin/state`：查看当前计数
- `GET /health`：健康检查

## 运行时编排配置
- `RUNTIME_ORCHESTRATOR_MODE=none`：默认，直接返回 ready（演示模式）
- `RUNTIME_ORCHESTRATOR_MODE=webhook`：调用 `RUNTIME_ORCHESTRATOR_URL` 实例化丫丫
- 相关变量：
  - `RUNTIME_ORCHESTRATOR_URL`
  - `RUNTIME_ORCHESTRATOR_KEY`
  - `RUNTIME_ORCHESTRATOR_TIMEOUT_MS`

## 鉴权
- 默认可不设密钥（方便本地联调）。
- 生产务必设置 `CONTROL_PLANE_KEY`，并让 bot 请求头携带 `x-control-plane-key`。

## 支付门禁配置
- `REQUIRE_PAYMENT_FOR_HANDOFF=true`：开启后，只有 `paid/waived` 订单可进入 `/api/handoff`
- `FREE_PLAN_TYPES=trial,demo`：这些计划类型在创建订单时自动标记为 `waived`
- 支持的支付状态：`pending | paid | waived | failed | refunded | canceled`

## Stripe 回调配置
- `STRIPE_WEBHOOK_SECRET`：Stripe endpoint secret
- `STRIPE_WEBHOOK_REQUIRE_SIGNATURE=true`：是否强制校验 `stripe-signature`
- `STRIPE_WEBHOOK_TOLERANCE_SECONDS=300`：签名时间窗口
- 建议在 Stripe Checkout metadata 中带上 `uid`（或 `order_id/orderId`）用于订单匹配

## 数据文件（JSON 模式）
- `data/db.json`
- `data/channel-pool.json`（可选）

## PostgreSQL 表
- `cp_meta`
- `cp_orders`
- `cp_sessions`
- `cp_assignments`
- `cp_channels`

建表脚本位于：`sql/schema.sql`。

## 样例调用
```bash
curl -X POST http://localhost:8787/api/apply \
  -H 'content-type: application/json' \
  -d '{
    "planType":"trial",
    "applicant":"Hosuke",
    "subject":"Yaya",
    "relation":"parent",
    "message":"爸爸想你了",
    "source":"landing"
  }'
```
