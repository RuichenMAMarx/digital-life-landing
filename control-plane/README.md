# Control Plane (UID 下单 + 会话分配)

控制面负责：
- 官网 `UID` 下单与状态追踪
- Telegram bot 的 UID 绑定与素材回传
- 独立会话分配（轮询策略）

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
- `POST /api/handoff`：素材齐后请求分配独立会话
- `POST /api/allocate-channel`：手动分配（运维）
- `POST /api/release-channel`：释放会话占用
- `GET /api/session/:uid/status`：查询状态
- `GET /api/admin/state`：查看当前计数
- `GET /health`：健康检查

## 鉴权
- 默认可不设密钥（方便本地联调）。
- 生产务必设置 `CONTROL_PLANE_KEY`，并让 bot 请求头携带 `x-control-plane-key`。

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
