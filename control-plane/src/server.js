require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createStoreFromEnv, resolveStorageConfig } = require('./storage');
const { normalizeText, nowIso } = require('./lib/utils');

const PORT = Number(process.env.PORT || 8787);
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const TG_BOT_USERNAME = process.env.TG_BOT_USERNAME || 'splandour_550w_bot';
const CONTROL_PLANE_KEY = process.env.CONTROL_PLANE_KEY || '';

function internalAuth(req, res, next) {
  if (!CONTROL_PLANE_KEY) {
    return next();
  }

  const incoming = req.header('x-control-plane-key') || '';
  if (incoming !== CONTROL_PLANE_KEY) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  return next();
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

async function main() {
  const store = createStoreFromEnv();
  const storageConfig = resolveStorageConfig();
  await store.init();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', asyncHandler(async (req, res) => {
    const health = await store.getHealth();
    res.json({
      ok: true,
      service: 'digital-life-control-plane',
      mode: store.mode,
      now: nowIso(),
      channelPoolSize: health.channelPoolSize,
      activeAssignments: health.activeAssignments
    });
  }));

  app.post('/api/apply', asyncHandler(async (req, res) => {
    const planType = normalizeText(req.body?.planType, 16) || 'trial';
    const applicant = normalizeText(req.body?.applicant, 128);
    const subject = normalizeText(req.body?.subject, 128);
    const relation = normalizeText(req.body?.relation, 64);
    const message = normalizeText(req.body?.message, 2000);
    const source = normalizeText(req.body?.source, 64) || 'landing';

    if (!applicant || !subject || !relation || !message) {
      return res.status(400).json({ ok: false, error: 'missing required fields' });
    }

    const created = await store.createApplyOrder({
      planType,
      applicant,
      subject,
      relation,
      message,
      source
    });

    const deepLink = TG_BOT_USERNAME ? `https://t.me/${TG_BOT_USERNAME}?start=${created.uid}` : '';

    return res.json({
      ok: true,
      uid: created.uid,
      orderId: created.orderId,
      telegramDeepLink: deepLink,
      statusUrl: `${PUBLIC_BASE_URL}/api/session/${created.uid}/status`
    });
  }));

  app.post('/api/bind', internalAuth, asyncHandler(async (req, res) => {
    const uid = normalizeText(req.body?.uid, 128);
    const platform = normalizeText(req.body?.platform, 32) || 'telegram';
    const username = normalizeText(req.body?.username, 128);
    const userId = normalizeText(req.body?.userId, 64);
    const chatIdRaw = req.body?.chatId;
    const chatId = chatIdRaw === undefined || chatIdRaw === null ? null : String(chatIdRaw);

    if (!uid || !chatId) {
      return res.status(400).json({ ok: false, error: 'uid/chatId required' });
    }

    const bound = await store.bindSession({
      uid,
      platform,
      username,
      userId,
      chatId
    });

    return res.json({ ok: true, uid, sessionStatus: bound.sessionStatus });
  }));

  app.post('/api/handoff', internalAuth, asyncHandler(async (req, res) => {
    const uid = normalizeText(req.body?.uid, 128);
    if (!uid) {
      return res.status(400).json({ ok: false, error: 'uid required' });
    }

    const chatIdRaw = req.body?.chatId;
    const chatId = chatIdRaw === undefined || chatIdRaw === null ? null : String(chatIdRaw);
    const preferredKinds = Array.isArray(req.body?.preferredKinds) ? req.body.preferredKinds : [];
    const assets = req.body?.assets || null;

    const result = await store.handoffSession({
      uid,
      chatId,
      assets,
      preferredKinds
    });

    return res.json({
      ok: true,
      uid,
      sessionStatus: result.sessionStatus,
      assignment: result.assignment
    });
  }));

  app.post('/api/allocate-channel', internalAuth, asyncHandler(async (req, res) => {
    const uid = normalizeText(req.body?.uid, 128);
    const forceReallocate = Boolean(req.body?.forceReallocate);
    const preferredKinds = Array.isArray(req.body?.preferredKinds) ? req.body.preferredKinds : [];

    if (!uid) {
      return res.status(400).json({ ok: false, error: 'uid required' });
    }

    const result = await store.allocateChannel({ uid, forceReallocate, preferredKinds });
    return res.json({
      ok: true,
      uid,
      assignment: result.assignment,
      reusedExisting: result.reusedExisting
    });
  }));

  app.post('/api/release-channel', internalAuth, asyncHandler(async (req, res) => {
    const uid = normalizeText(req.body?.uid, 128);
    if (!uid) {
      return res.status(400).json({ ok: false, error: 'uid required' });
    }

    const result = await store.releaseChannel(uid);
    return res.json({ ok: true, uid, released: result.released });
  }));

  app.get('/api/session/:uid/status', asyncHandler(async (req, res) => {
    const uid = normalizeText(req.params.uid, 128);
    if (!uid) {
      return res.status(400).json({ ok: false, error: 'uid required' });
    }

    const status = await store.getStatus(uid);
    if (!status.exists) {
      return res.status(404).json({ ok: false, error: 'uid not found' });
    }

    return res.json({
      ok: true,
      uid,
      order: status.order,
      session: status.session,
      assignment: status.assignment,
      assetsSummary: status.assetsSummary
    });
  }));

  app.get('/api/admin/state', internalAuth, asyncHandler(async (req, res) => {
    const admin = await store.getAdminState();
    return res.json({
      ok: true,
      mode: store.mode,
      meta: admin.meta,
      counts: admin.counts
    });
  }));

  app.use((err, req, res, next) => {
    console.error('request failed:', err.message || err);
    res.status(500).json({ ok: false, error: err.message || 'internal_error' });
  });

  const server = app.listen(PORT, () => {
    console.log(`control-plane listening on ${PORT}`);
    console.log(`storage mode: ${store.mode}`);
    console.log(`channel pool source: ${storageConfig.channelPoolFile}`);
    if (store.mode === 'json') {
      console.log(`data dir: ${storageConfig.dataDir}`);
    }
  });

  const shutdown = async () => {
    server.close();
    await store.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('control-plane boot failed:', err);
  process.exit(1);
});
