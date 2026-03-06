# Digital Life 架构说明（UID 下单 + Bot 独立会话）

English version: [ARCHITECTURE.en.md](./ARCHITECTURE.en.md)

## 1. 目标
- 官网作为流量入口，所有体验都先创建唯一 `UID`。
- 用户从官网一键跳转 Telegram bot，上交照片/语音。
- 素材完成后进入“独立会话”分配层，按 UID 路由到专属会话通道。
- 全链路可追踪（下单、绑定、素材、分配、会话状态）。

## 2. 当前实现（本仓库）
- `index.html + script.js`: 官网前端，`POST /api/apply` 创建 UID。
- `bot/server.js`: Telegram onboarding bot，采集素材并回调分配。
- `control-plane/src/server.js`: 控制面后端（下单、绑定、分配、状态）。
- `control-plane/src/storage/*`: 存储适配层（`json` / `postgres`）。

## 3. 核心流程
1. 用户在官网提交表单 -> `control-plane /api/apply` 生成 UID。
2. 前端拿到 UID，生成 Telegram deep link：`/start UID-550W-...`。
3. bot 绑定 UID/chatId -> `control-plane /api/bind`。
4. bot 收到 >=1 张照片 + >=10s 语音后 -> `control-plane /api/handoff`。
5. control-plane 轮询分配独立通道（telegram/whatsapp pool）。
6. bot 把分配结果回传用户，后续进入 active 会话。

## 4. 数据模型（逻辑）
- `Order`: 下单信息（planType/applicant/subject/relation/message）。
- `Session`: UID 当前状态（created/bound/handoff_pending/allocated/active）。
- `Asset`: 照片与音频元数据（本地路径、duration、时间戳）。
- `Assignment`: UID 对应独立通道映射（kind/channelId/entrypoint）。

## 5. 分配策略
- 默认 `round-robin` 在 `channelPool` 中轮询。
- 优先使用空闲通道；无空闲时允许复用（`reused=true` 标记）。
- 没有池配置时使用 `virtual` fallback（保证流程不中断）。

## 6. Repo 策略建议
- 当前阶段：保留单仓（landing + bot + control-plane）最省沟通成本。
- 进入多人并行后建议拆分：
  - `digital-life-landing`（静态站 + SDK）
  - `digital-life-control-plane`（后端 API）
  - `digital-life-bot`（Telegram/WhatsApp adapters）
- 拆分条件：需要独立发布节奏、独立权限管理、独立 SLA。

## 7. 生产版建议（下一阶段）
- 数据层：当前已支持 PostgreSQL；下一阶段可继续接 Redis（会话/锁/队列）。
- 任务层：加入异步队列（BullMQ/SQS）处理素材审核、媒资生成、分配回调。
- 可观测性：Sentry + Loki/ELK + Prometheus/Grafana。
- 安全：
  - bot token 与 API key 存 Secret Manager；
  - 所有内部 API 用 `x-control-plane-key` + IP allowlist。
