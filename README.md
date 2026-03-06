# digital-life-landing

UID 驱动的官网 + Telegram onboarding bot + control-plane 后端。

## 目录
- `index.html / script.js / style.css`：官网前端（GitHub Pages 可直接部署）
- `bot/`：Telegram onboarding bot（收素材 + 回调分配）
- `control-plane/`：UID 下单、状态管理、独立会话分配 API（支持 `json/postgres` 双存储）

## 本地联调
1. 启动控制面
```bash
cd control-plane
npm install
cp .env.example .env
npm start
```

若要使用 PostgreSQL：
```bash
cd control-plane
npm run db:init
npm start
```

2. 启动 bot
```bash
cd bot
npm install
cp .env.example .env
# 配置 TELEGRAM_BOT_TOKEN + CONTROL_PLANE_BASE_URL + CONTROL_PLANE_KEY
node server.js
```

3. 启动官网（任意静态服务）
```bash
# 在仓库根目录
python3 -m http.server 8080
```

打开 `http://localhost:8080`，提交表单后将拿到后端签发 UID 并跳转 Telegram。

## 关键文档
- 架构设计：[ARCHITECTURE.md](./ARCHITECTURE.md)
- 部署与采购：[HOSTING_PLAN.md](./HOSTING_PLAN.md)
- 控制面说明：[control-plane/README.md](./control-plane/README.md)
