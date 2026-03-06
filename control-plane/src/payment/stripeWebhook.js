const crypto = require('crypto');
const { normalizeText, normalizePaymentStatus } = require('../lib/utils');

const STRIPE_UID_PREFIX = 'UID-550W-';

function safeCompareHex(a, b) {
  const left = Buffer.from(String(a || ''), 'hex');
  const right = Buffer.from(String(b || ''), 'hex');
  if (!left.length || !right.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function parseStripeSignatureHeader(header) {
  const parts = String(header || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  let timestamp = 0;
  const signatures = [];
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx);
    const value = part.slice(idx + 1);
    if (key === 't') {
      timestamp = Number(value || 0);
    } else if (key === 'v1') {
      signatures.push(value);
    }
  }

  return { timestamp, signatures };
}

function verifyStripeSignature({ rawBody, signatureHeader, webhookSecret, toleranceSeconds = 300 }) {
  const secret = String(webhookSecret || '');
  if (!secret) return false;

  const parsed = parseStripeSignatureHeader(signatureHeader);
  if (!parsed.timestamp || !parsed.signatures.length) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.timestamp) > Number(toleranceSeconds || 300)) {
    return false;
  }

  const payload = `${parsed.timestamp}.${String(rawBody || '')}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return parsed.signatures.some((sig) => safeCompareHex(sig, expected));
}

function unixSecondsToIso(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

function looksLikeUid(value) {
  const text = String(value || '').trim();
  if (!text.startsWith(STRIPE_UID_PREFIX)) return false;
  return text.length >= STRIPE_UID_PREFIX.length + 4;
}

function firstNonEmpty(values, maxLen = 128) {
  for (const v of values) {
    const normalized = normalizeText(v, maxLen);
    if (normalized) return normalized;
  }
  return '';
}

function extractIdentifiersFromObject(obj) {
  const source = obj && typeof obj === 'object' ? obj : {};
  const meta = source.metadata && typeof source.metadata === 'object' ? source.metadata : {};

  const uidCandidate = firstNonEmpty([
    meta.uid,
    meta.uid_code,
    meta.uidCode,
    meta.digital_life_uid,
    meta.digitalLifeUid,
    looksLikeUid(source.client_reference_id) ? source.client_reference_id : ''
  ], 128);

  const orderIdCandidate = firstNonEmpty([
    meta.order_id,
    meta.orderId,
    meta.order,
    source.client_reference_id
  ], 128);

  return {
    uid: looksLikeUid(uidCandidate) ? uidCandidate : '',
    orderId: orderIdCandidate || ''
  };
}

function mapStripeEventToPaymentUpdate(event) {
  const evt = event && typeof event === 'object' ? event : {};
  const type = normalizeText(evt.type, 128);
  const object = evt?.data?.object && typeof evt.data.object === 'object' ? evt.data.object : {};
  const ids = extractIdentifiersFromObject(object);

  const statusByType = {
    'checkout.session.completed': 'paid',
    'checkout.session.async_payment_succeeded': 'paid',
    'payment_intent.succeeded': 'paid',
    'charge.succeeded': 'paid',
    'checkout.session.async_payment_failed': 'failed',
    'payment_intent.payment_failed': 'failed',
    'charge.failed': 'failed',
    'charge.refunded': 'refunded',
    'payment_intent.canceled': 'canceled',
    'checkout.session.expired': 'canceled'
  };

  const mapped = statusByType[type] || '';
  if (!mapped) {
    return {
      supported: false,
      reason: 'unsupported_event_type',
      type,
      uid: ids.uid,
      orderId: ids.orderId
    };
  }

  const paymentStatus = normalizePaymentStatus(mapped, mapped);
  const paymentReference = firstNonEmpty([
    object.payment_intent,
    object.charge,
    object.id,
    evt.id
  ], 128) || null;

  const paymentMessage = firstNonEmpty([
    object?.last_payment_error?.message,
    object.failure_message,
    object.cancel_reason,
    object.payment_status,
    object.status,
    type
  ], 512) || null;

  const paidAt = paymentStatus === 'paid'
    ? (unixSecondsToIso(object.created) || unixSecondsToIso(evt.created))
    : undefined;

  return {
    supported: true,
    type,
    uid: ids.uid || '',
    orderId: ids.orderId || '',
    paymentStatus,
    paymentProvider: 'stripe',
    paymentReference,
    paymentMessage,
    paidAt
  };
}

module.exports = {
  verifyStripeSignature,
  mapStripeEventToPaymentUpdate
};
