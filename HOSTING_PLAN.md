# Hosting 与采购清单

## 1. MVP（2-4 周可上线）
- 静态官网：Cloudflare Pages / Vercel
- 控制面后端：1 台 2vCPU/4GB 云主机（或 Render/Fly.io）
- bot 服务：1 台 2vCPU/2GB（可和后端合并）
- 数据库：PostgreSQL 1 实例（Supabase/Neon/RDS，控制面已支持 PG）
- 对象存储：S3/R2（保存上传素材、生成素材）
- 域名与 TLS：Cloudflare

## 2. 建议购买/开通的服务
1. 云主机（2 台起）
- 用途：control-plane + bot runtime
- 建议：东京/新加坡区域，降低亚洲用户时延

2. PostgreSQL 托管
- 用途：UID 订单、会话状态、分配记录、审计日志
- 最低配置：1 vCPU / 2GB RAM / 20GB SSD

3. 对象存储（S3/R2）
- 用途：照片、语音、视频库存
- 需要：生命周期策略（冷存/归档）

4. 消息队列（可选但建议）
- 用途：分配任务、素材处理、重试
- 选项：Redis + BullMQ / SQS

5. 可观测平台
- 日志：Loki/ELK
- 错误：Sentry
- 指标：Prometheus + Grafana

6. 通讯通道资源
- Telegram bot（已具备）
- WhatsApp Business API（Twilio/360dialog/Meta BSP）
- 若要“独立号码会话”，需要购买多条 WA sender 或多账号池

## 3. 预估成本（MVP 级别）
- 主机 + DB + 存储 + 监控：约 80~300 USD/月（看并发和存储量）
- WhatsApp Business 费用：按会话/模板计费，取决于国家和 BSP

## 4. 部署拓扑
- `landing`：静态托管
- `control-plane`：Node.js API（建议容器化）
- `bot`：Node.js polling/webhook 服务
- `db`：PostgreSQL
- `storage`：S3/R2

## 5. 上线前必须项
- 机器人 token 全部轮换（当前已暴露过）
- control-plane key 设置强随机值
- HTTPS 强制 + CORS 白名单
- 备份策略（DB 每日快照，素材生命周期）
