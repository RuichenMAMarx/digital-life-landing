require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createStoreFromEnv, resolveStorageConfig } = require('./storage');
const {
  normalizeText,
  normalizePlanType,
  normalizePaymentStatus,
  resolveFreePlanTypes,
  deriveInitialPaymentStatus,
  evaluateHandoffPaymentEligibility,
  nowIso
} = require('./lib/utils');
const { createRuntimeOrchestratorFromEnv } = require('./runtime/orchestrator');
const { verifyStripeSignature, mapStripeEventToPaymentUpdate } = require('./payment/stripeWebhook');

const PORT = Number(process.env.PORT || 8787);
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const TG_BOT_USERNAME = process.env.TG_BOT_USERNAME || 'splandour_550w_bot';
const CONTROL_PLANE_KEY = process.env.CONTROL_PLANE_KEY || '';
const REQUIRE_PAYMENT_FOR_HANDOFF = String(process.env.REQUIRE_PAYMENT_FOR_HANDOFF || 'true').trim().toLowerCase() !== 'false';
const FREE_PLAN_TYPES = resolveFreePlanTypes(process.env.FREE_PLAN_TYPES);
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_WEBHOOK_REQUIRE_SIGNATURE = String(process.env.STRIPE_WEBHOOK_REQUIRE_SIGNATURE || 'true').trim().toLowerCase() !== 'false';
const STRIPE_WEBHOOK_TOLERANCE_SECONDS = Number(process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS || 300);

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
  const runtimeOrchestrator = createRuntimeOrchestratorFromEnv();
  const storageConfig = resolveStorageConfig();
  await store.init();

  const app = express();
  app.use(cors());
  app.post('/api/payment/webhook/stripe', express.raw({ type: 'application/json' }), asyncHandler(async (req, res) => {
    const rawBuffer = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));
    const rawBody = rawBuffer.toString('utf8');

    if (STRIPE_WEBHOOK_REQUIRE_SIGNATURE) {
      const stripeSignature = req.header('stripe-signature') || '';
      const verified = verifyStripeSignature({
        rawBody,
        signatureHeader: stripeSignature,
        webhookSecret: STRIPE_WEBHOOK_SECRET,
        toleranceSeconds: STRIPE_WEBHOOK_TOLERANCE_SECONDS
      });
      if (!verified) {
        return res.status(400).json({ ok: false, error: 'invalid_stripe_signature' });
      }
    }

    let event = null;
    try {
      event = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return res.status(400).json({ ok: false, error: 'invalid_json' });
    }

    const eventId = normalizeText(event?.id, 128);
    const eventType = normalizeText(event?.type, 128) || 'unknown';
    if (!eventId) {
      return res.status(400).json({ ok: false, error: 'missing_event_id' });
    }

    if (typeof store.isPaymentEventProcessed === 'function') {
      const alreadyProcessed = await store.isPaymentEventProcessed(eventId);
      if (alreadyProcessed) {
        return res.json({ ok: true, duplicate: true, eventId, eventType });
      }
    }

    const mapped = mapStripeEventToPaymentUpdate(event);
    if (!mapped.supported) {
      if (typeof store.recordPaymentEvent === 'function') {
        await store.recordPaymentEvent({
          eventId,
          provider: 'stripe',
          type: eventType,
          uid: mapped.uid || null,
          orderId: mapped.orderId || null,
          paymentStatus: null,
          raw: { ignored: true, reason: mapped.reason, type: eventType }
        });
      }
      return res.json({ ok: true, ignored: true, reason: mapped.reason, eventId, eventType });
    }

    let order = null;
    if (mapped.uid) {
      order = await store.updateOrderPayment({
        uid: mapped.uid,
        paymentStatus: mapped.paymentStatus,
        paymentProvider: mapped.paymentProvider,
        paymentReference: mapped.paymentReference,
        paymentMessage: mapped.paymentMessage,
        paidAt: mapped.paidAt
      });
    }
    if (!order && mapped.orderId && typeof store.updateOrderPaymentByOrderId === 'function') {
      order = await store.updateOrderPaymentByOrderId({
        orderId: mapped.orderId,
        paymentStatus: mapped.paymentStatus,
        paymentProvider: mapped.paymentProvider,
        paymentReference: mapped.paymentReference,
        paymentMessage: mapped.paymentMessage,
        paidAt: mapped.paidAt
      });
    }

    if (typeof store.recordPaymentEvent === 'function') {
      await store.recordPaymentEvent({
        eventId,
        provider: 'stripe',
        type: mapped.type || eventType,
        uid: mapped.uid || null,
        orderId: mapped.orderId || null,
        paymentStatus: mapped.paymentStatus,
        raw: {
          matchedOrder: Boolean(order),
          paymentReference: mapped.paymentReference,
          paymentMessage: mapped.paymentMessage
        }
      });
    }

    if (!order) {
      return res.json({
        ok: true,
        ignored: true,
        reason: 'order_not_found',
        eventId,
        eventType,
        uid: mapped.uid || null,
        orderId: mapped.orderId || null
      });
    }

    return res.json({
      ok: true,
      eventId,
      eventType,
      uid: order.uid,
      orderId: order.orderId,
      paymentStatus: order.paymentStatus
    });
  }));
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', asyncHandler(async (req, res) => {
    const health = await store.getHealth();
    res.json({
      ok: true,
      service: 'digital-life-control-plane',
      mode: store.mode,
      runtimeMode: runtimeOrchestrator.mode,
      requirePaymentForHandoff: REQUIRE_PAYMENT_FOR_HANDOFF,
      freePlanTypes: Array.from(FREE_PLAN_TYPES),
      stripeWebhookSignatureRequired: STRIPE_WEBHOOK_REQUIRE_SIGNATURE,
      now: nowIso(),
      channelPoolSize: health.channelPoolSize,
      activeAssignments: health.activeAssignments
    });
  }));

  app.post('/api/apply', asyncHandler(async (req, res) => {
    const planType = normalizePlanType(req.body?.planType);
    const paymentStatus = deriveInitialPaymentStatus(planType, FREE_PLAN_TYPES);
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
      paymentStatus,
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
      paymentStatus: created.paymentStatus || paymentStatus,
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

    const before = await store.getStatus(uid);
    if (!before?.exists || !before.order) {
      return res.status(404).json({ ok: false, error: 'uid not found' });
    }

    const paymentGate = evaluateHandoffPaymentEligibility(before.order, {
      requirePaymentForHandoff: REQUIRE_PAYMENT_FOR_HANDOFF,
      freePlanTypes: FREE_PLAN_TYPES
    });
    if (!paymentGate.allowed) {
      return res.status(402).json({
        ok: false,
        error: paymentGate.reason,
        uid,
        orderId: before.order.orderId,
        paymentStatus: paymentGate.paymentStatus
      });
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

    const statusSnapshot = await store.getStatus(uid);
    const runtime = await runtimeOrchestrator.provision({
      uid,
      order: statusSnapshot.order,
      session: statusSnapshot.session,
      assignment: result.assignment,
      callbackUrl: `${PUBLIC_BASE_URL}/api/runtime/callback`,
      statusUrl: `${PUBLIC_BASE_URL}/api/session/${uid}/status`
    });

    const patch = { runtime };
    if (runtime.status === 'ready') {
      patch.status = 'active';
    } else if (runtime.status === 'failed') {
      patch.status = 'allocated';
    }
    const patched = await store.patchSession(uid, patch);

    return res.json({
      ok: true,
      uid,
      sessionStatus: patched.session?.status || result.sessionStatus,
      assignment: result.assignment,
      runtime
    });
  }));

  app.post('/api/order/payment', internalAuth, asyncHandler(async (req, res) => {
    const uid = normalizeText(req.body?.uid, 128);
    const orderId = normalizeText(req.body?.orderId, 128);
    if (!uid && !orderId) {
      return res.status(400).json({ ok: false, error: 'uid or orderId required' });
    }

    const paymentStatus = normalizePaymentStatus(req.body?.paymentStatus, '');
    if (!paymentStatus) {
      return res.status(400).json({
        ok: false,
        error: 'invalid paymentStatus',
        expected: ['pending', 'paid', 'waived', 'failed', 'refunded', 'canceled']
      });
    }

    const paymentProvider = normalizeText(req.body?.paymentProvider, 64) || null;
    const paymentReference = normalizeText(req.body?.paymentReference, 128) || null;
    const paymentMessage = normalizeText(req.body?.paymentMessage, 512) || null;
    const paidAtRaw = normalizeText(req.body?.paidAt, 64);
    if (paidAtRaw) {
      const parsedPaidAt = new Date(paidAtRaw);
      if (Number.isNaN(parsedPaidAt.getTime())) {
        return res.status(400).json({ ok: false, error: 'invalid paidAt' });
      }
    }

    const payload = {
      paymentStatus,
      paymentProvider,
      paymentReference,
      paymentMessage,
      paidAt: paidAtRaw || undefined
    };

    let order = null;
    if (uid) {
      order = await store.updateOrderPayment({ ...payload, uid });
    }
    if (!order && orderId && typeof store.updateOrderPaymentByOrderId === 'function') {
      order = await store.updateOrderPaymentByOrderId({ ...payload, orderId });
    }

    if (!order) {
      return res.status(404).json({ ok: false, error: 'order not found' });
    }

    return res.json({ ok: true, uid: order.uid, orderId: order.orderId, order });
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

  app.post('/api/runtime/callback', internalAuth, asyncHandler(async (req, res) => {
    const uid = normalizeText(req.body?.uid || req.body?.runtime?.uid, 128);
    if (!uid) {
      return res.status(400).json({ ok: false, error: 'uid required' });
    }

    const runtime = runtimeOrchestrator.normalizeCallback(req.body || {});
    const patch = { runtime };
    if (runtime.status === 'ready') {
      patch.status = 'active';
    } else if (runtime.status === 'failed') {
      patch.status = 'allocated';
    }

    const patched = await store.patchSession(uid, patch);
    return res.json({
      ok: true,
      uid,
      sessionStatus: patched.session?.status || null,
      runtime
    });
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
      runtimeMode: runtimeOrchestrator.mode,
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
    console.log(`runtime orchestrator mode: ${runtimeOrchestrator.mode}`);
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
