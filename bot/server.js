require('dotenv').config();
const fsp = require('fs/promises');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN_HERE';
if (!token || token === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
  console.error('TELEGRAM_BOT_TOKEN missing.');
  process.exit(1);
}

const MIN_AUDIO_SECONDS = Number(process.env.MIN_AUDIO_SECONDS || 10);
const ORCHESTRATOR_WEBHOOK_URL = process.env.ORCHESTRATOR_WEBHOOK_URL || '';
const CONTROL_PLANE_BASE_URL = (process.env.CONTROL_PLANE_BASE_URL || '').replace(/\/+$/, '');
const CONTROL_PLANE_KEY = process.env.CONTROL_PLANE_KEY || '';
const PREFERRED_CHANNEL_KINDS = String(process.env.PREFERRED_CHANNEL_KINDS || 'telegram')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const RUNTIME_POLL_INTERVAL_MS = Number(process.env.RUNTIME_POLL_INTERVAL_MS || 6000);
const RUNTIME_POLL_MAX_ATTEMPTS = Number(process.env.RUNTIME_POLL_MAX_ATTEMPTS || 25);
const ENABLE_TYPING_DELAY = String(process.env.ENABLE_TYPING_DELAY || 'true').trim().toLowerCase() !== 'false';
const TYPING_CPS = Math.max(1, Number(process.env.TYPING_CPS || 6));
const TYPING_MIN_DELAY_MS = Math.max(0, Number(process.env.TYPING_MIN_DELAY_MS || 1200));
const TYPING_MAX_DELAY_MS = Math.max(TYPING_MIN_DELAY_MS, Number(process.env.TYPING_MAX_DELAY_MS || 7000));
const DATA_DIR = path.resolve(process.env.BOT_DATA_DIR || path.join(__dirname, 'data'));
const ASSET_DIR = path.join(DATA_DIR, 'assets');
const SESSION_FILE = path.join(DATA_DIR, 'sessions.json');

const bot = new TelegramBot(token, { polling: true });

let sessionsByChat = {};
let isSaving = false;
let saveQueued = false;
const runtimePollers = new Set();

const UID_RE = /^UID-550W-[A-Za-z0-9_-]{4,}$/;

function nowIso() {
  return new Date().toISOString();
}

function ensureSessionShape(session) {
  return {
    uid: session.uid,
    chatId: session.chatId,
    state: session.state || 'awaiting_data',
    createdAt: session.createdAt || nowIso(),
    updatedAt: nowIso(),
    assets: {
      photos: Array.isArray(session?.assets?.photos) ? session.assets.photos : [],
      audio: Array.isArray(session?.assets?.audio) ? session.assets.audio : []
    },
    handoff: {
      requested: Boolean(session?.handoff?.requested),
      delivered: Boolean(session?.handoff?.delivered),
      error: session?.handoff?.error || null,
      deliveredAt: session?.handoff?.deliveredAt || null,
      allocation: session?.handoff?.allocation || null,
      runtime: session?.handoff?.runtime || null
    },
    messagesCount: Number(session.messagesCount || 0),
    botReplyCount: Number(session.botReplyCount || 0)
  };
}

async function ensureDirs() {
  await fsp.mkdir(ASSET_DIR, { recursive: true });
}

async function loadSessions() {
  try {
    const raw = await fsp.readFile(SESSION_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const normalized = {};
    for (const [chatId, s] of Object.entries(parsed)) {
      normalized[chatId] = ensureSessionShape(s);
    }
    sessionsByChat = normalized;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn('load sessions failed:', err.message);
    }
    sessionsByChat = {};
  }
}

async function flushSessions() {
  if (isSaving) {
    saveQueued = true;
    return;
  }
  isSaving = true;
  try {
    await ensureDirs();
    await fsp.writeFile(SESSION_FILE, JSON.stringify(sessionsByChat, null, 2), 'utf8');
  } finally {
    isSaving = false;
    if (saveQueued) {
      saveQueued = false;
      await flushSessions();
    }
  }
}

function getSession(chatId) {
  return sessionsByChat[String(chatId)] || null;
}

function upsertSession(chatId, data) {
  const key = String(chatId);
  const merged = ensureSessionShape({ ...(sessionsByChat[key] || {}), ...data, chatId: Number(chatId) });
  sessionsByChat[key] = merged;
  void flushSessions();
  return merged;
}

function bindUid(chatId, uid) {
  return upsertSession(chatId, {
    uid,
    state: 'awaiting_data',
    handoff: {
      requested: false,
      delivered: false,
      error: null,
      deliveredAt: null,
      allocation: null,
      runtime: null
    },
    assets: { photos: [], audio: [] },
    messagesCount: 0,
    botReplyCount: 0
  });
}

async function downloadTelegramFile(fileId, targetPath) {
  const link = await bot.getFileLink(fileId);
  const res = await fetch(link);
  if (!res.ok) throw new Error(`download failed ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  await fsp.writeFile(targetPath, buf);
  return targetPath;
}

function sessionAssetFolder(uid) {
  return path.join(ASSET_DIR, uid);
}

async function savePhoto(uid, msg) {
  const photos = msg.photo || [];
  if (!photos.length) return null;
  const best = photos[photos.length - 1];
  const fileId = best.file_id;
  const fileName = `${Date.now()}-photo-${fileId}.jpg`;
  const abs = path.join(sessionAssetFolder(uid), fileName);
  await downloadTelegramFile(fileId, abs);
  return {
    kind: 'photo',
    fileId,
    telegramFileUniqueId: best.file_unique_id,
    path: abs,
    ts: nowIso()
  };
}

async function saveAudio(uid, msg) {
  const voice = msg.voice || msg.audio || null;
  if (!voice) return null;
  const fileId = voice.file_id;
  const duration = Number(voice.duration || 0);
  const ext = msg.voice ? 'ogg' : 'mp3';
  const fileName = `${Date.now()}-audio-${fileId}.${ext}`;
  const abs = path.join(sessionAssetFolder(uid), fileName);
  await downloadTelegramFile(fileId, abs);
  return {
    kind: 'audio',
    fileId,
    duration,
    telegramFileUniqueId: voice.file_unique_id,
    path: abs,
    ts: nowIso()
  };
}

async function postControlPlane(pathname, payload) {
  if (!CONTROL_PLANE_BASE_URL) return null;

  const headers = { 'Content-Type': 'application/json' };
  if (CONTROL_PLANE_KEY) {
    headers['x-control-plane-key'] = CONTROL_PLANE_KEY;
  }

  const res = await fetch(`${CONTROL_PLANE_BASE_URL}${pathname}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  const raw = await res.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }

  if (!res.ok) {
    const reason = data?.error || data?.raw || `status_${res.status}`;
    const err = new Error(`control-plane ${pathname} failed: ${reason}`);
    err.code = String(reason || '');
    err.httpStatus = res.status;
    err.payload = data;
    throw err;
  }

  return data;
}

function normalizeErrorCode(err) {
  if (!err) return '';
  if (typeof err.code === 'string' && err.code) return err.code;
  const message = String(err.message || err);
  const m = message.match(/failed:\s*([a-z_0-9-]+)/i);
  return m ? m[1].toLowerCase() : '';
}

function isPaymentGateError(code) {
  const text = String(code || '').toLowerCase();
  return text === 'payment_pending'
    || text === 'payment_failed'
    || text === 'payment_refunded'
    || text === 'payment_canceled'
    || text === 'payment_required';
}

async function syncBindingToControlPlane(uid, msg) {
  if (!CONTROL_PLANE_BASE_URL) return;

  try {
    await postControlPlane('/api/bind', {
      uid,
      chatId: msg.chat.id,
      platform: 'telegram',
      username: msg.from?.username || null,
      userId: msg.from?.id || null
    });
  } catch (err) {
    console.warn('sync binding failed:', String(err.message || err));
  }
}

function runtimeState(runtime) {
  const raw = String(runtime?.status || '').trim().toLowerCase();
  if (raw === 'ready' || raw === 'active' || raw === 'success') return 'ready';
  if (raw === 'failed' || raw === 'error' || raw === 'timeout') return 'failed';
  if (raw === 'queued' || raw === 'pending' || raw === 'provisioning' || raw === 'initializing') return 'provisioning';
  return 'unknown';
}

function handoffSuccessText(allocation, runtime) {
  const lines = [
    '[量子通道建立成功]',
    '丫丫初始化已完成，已进入独立会话。你可以继续发送图片/语音/地点。'
  ];
  const entrypoint = runtime?.entrypoint || allocation?.entrypoint || '';
  if (allocation?.kind) lines.push(`会话类型：${allocation.kind}`);
  if (allocation?.channelId) lines.push(`通道编号：${allocation.channelId}`);
  if (entrypoint) lines.push(`入口：${entrypoint}`);
  return lines.join('\n');
}

function handoffProvisioningText(runtime) {
  const hint = runtime?.message || '正在实例化丫丫并建立独立会话。';
  return `[系统处理中]\n${hint}\n预计 1-3 分钟完成，完成后会自动回传。`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function estimateTypingDelayMs(text, options = {}) {
  if (!ENABLE_TYPING_DELAY || options.skipDelay) return 0;
  const chars = String(text || '').trim().length;
  if (!chars) return 0;
  const rawMs = Math.ceil((chars / TYPING_CPS) * 1000);
  return Math.max(TYPING_MIN_DELAY_MS, Math.min(TYPING_MAX_DELAY_MS, rawMs));
}

async function sendMessageWithTyping(chatId, text, options = {}) {
  const delayMs = estimateTypingDelayMs(text, options);
  if (delayMs > 0) {
    try {
      await bot.sendChatAction(chatId, 'typing');
    } catch (err) {
      console.warn('sendChatAction failed:', String(err.message || err));
    }
    await sleep(delayMs);
  }
  return bot.sendMessage(chatId, text, options.messageOptions || undefined);
}

async function fetchControlPlaneSessionStatus(uid) {
  if (!CONTROL_PLANE_BASE_URL) return null;
  const headers = {};
  if (CONTROL_PLANE_KEY) {
    headers['x-control-plane-key'] = CONTROL_PLANE_KEY;
  }
  const res = await fetch(`${CONTROL_PLANE_BASE_URL}/api/session/${encodeURIComponent(uid)}/status`, {
    method: 'GET',
    headers
  });
  if (!res.ok) {
    throw new Error(`status_${res.status}`);
  }
  return res.json();
}

async function pollRuntimeForChat(chatId, uid) {
  if (!CONTROL_PLANE_BASE_URL) return;
  const key = `${chatId}:${uid}`;
  if (runtimePollers.has(key)) return;
  runtimePollers.add(key);

  try {
    for (let i = 0; i < RUNTIME_POLL_MAX_ATTEMPTS; i += 1) {
      await sleep(RUNTIME_POLL_INTERVAL_MS);

      let snapshot = null;
      try {
        snapshot = await fetchControlPlaneSessionStatus(uid);
      } catch (err) {
        console.warn('poll runtime status failed:', String(err.message || err));
        continue;
      }

      const runtime = snapshot?.session?.runtime || null;
      const allocation = snapshot?.assignment || snapshot?.session?.channel || null;
      const state = runtimeState(runtime);
      const local = getSession(chatId);
      if (!local || local.uid !== uid) {
        return;
      }

      if (state === 'ready') {
        local.state = 'active';
        local.handoff.runtime = runtime;
        local.handoff.allocation = allocation || local.handoff.allocation;
        upsertSession(chatId, local);
        await bot.sendMessage(chatId, handoffSuccessText(local.handoff.allocation, runtime));
        return;
      }

      if (state === 'failed') {
        local.state = 'active';
        local.handoff.runtime = runtime;
        upsertSession(chatId, local);
        await bot.sendMessage(
          chatId,
          '[系统提示]\n丫丫初始化暂时失败，已切回当前窗口继续体验。'
        );
        return;
      }
    }

    const local = getSession(chatId);
    if (local && local.uid === uid) {
      local.state = 'active';
      upsertSession(chatId, local);
      await bot.sendMessage(
        chatId,
        '[系统提示]\n初始化超时，先在当前窗口继续体验；后台完成后会再通知你。'
      );
    }
  } finally {
    runtimePollers.delete(key);
  }
}

function hasEnoughAssets(session) {
  const hasPhoto = session.assets.photos.length >= 1;
  const longEnoughAudio = session.assets.audio.some((a) => Number(a.duration || 0) >= MIN_AUDIO_SECONDS);
  return { hasPhoto, longEnoughAudio, done: hasPhoto && longEnoughAudio };
}

async function triggerHandoff(session) {
  const payload = {
    uid: session.uid,
    chatId: session.chatId,
    state: session.state,
    assets: session.assets,
    handoffRequestedAt: nowIso(),
    targetChannel: 'dedicated_session'
  };

  const updated = { ...session };
  updated.handoff.requested = true;
  updated.handoff.allocation = null;
  updated.handoff.runtime = null;

  if (CONTROL_PLANE_BASE_URL) {
    try {
      const data = await postControlPlane('/api/handoff', {
        ...payload,
        preferredKinds: PREFERRED_CHANNEL_KINDS
      });
      updated.handoff.delivered = true;
      updated.handoff.error = null;
      updated.handoff.deliveredAt = nowIso();
      updated.handoff.allocation = data?.assignment || null;
      updated.handoff.runtime = data?.runtime || null;
      return updated;
    } catch (err) {
      const code = normalizeErrorCode(err);
      updated.handoff.error = code || String(err.message || err);
      console.warn('control-plane handoff failed:', updated.handoff.error);
      if (isPaymentGateError(code)) {
        updated.handoff.delivered = false;
        return updated;
      }
    }
  }

  if (ORCHESTRATOR_WEBHOOK_URL) {
    try {
      const res = await fetch(ORCHESTRATOR_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        updated.handoff.delivered = false;
        updated.handoff.error = `webhook ${res.status}`;
        return updated;
      }

      updated.handoff.delivered = true;
      updated.handoff.error = null;
      updated.handoff.deliveredAt = nowIso();
      updated.handoff.runtime = null;
      return updated;
    } catch (err) {
      updated.handoff.delivered = false;
      updated.handoff.error = String(err.message || err);
      return updated;
    }
  }

  updated.handoff.delivered = false;
  updated.handoff.error = updated.handoff.error || 'handoff target not configured';
  return updated;
}

async function onAssetsReady(chatId, session) {
  await bot.sendMessage(
    chatId,
    '*[系统处理中]*\n素材接收完成，正在建立独立会话并回传运行时。\n请稍候 10-60 秒。',
    { parse_mode: 'Markdown' }
  );

  let next = { ...session, state: 'handoff_pending' };
  next = await triggerHandoff(next);

  if (next.handoff.delivered) {
    const allocation = next.handoff.allocation || null;
    const runtime = next.handoff.runtime || null;
    const state = runtimeState(runtime);

    if (state === 'ready' || state === 'unknown') {
      next.state = 'active';
      upsertSession(chatId, next);
      await bot.sendMessage(chatId, handoffSuccessText(allocation, runtime));
      return;
    }

    if (state === 'failed') {
      next.state = 'active';
      upsertSession(chatId, next);
      await bot.sendMessage(
        chatId,
        '[系统提示]\n丫丫初始化失败，已切回当前窗口继续体验。'
      );
      return;
    }

    next.state = 'handoff_pending';
    upsertSession(chatId, next);
    await bot.sendMessage(chatId, handoffProvisioningText(runtime));
    void pollRuntimeForChat(chatId, session.uid);
    return;
  }

  if (isPaymentGateError(next.handoff.error)) {
    next.state = 'awaiting_payment';
    upsertSession(chatId, next);
    await bot.sendMessage(
      chatId,
      '[系统提示]\n当前订单尚未完成支付校验，暂不能初始化丫丫。\n完成支付后发送“已支付”即可自动重试。'
    );
    return;
  }

  // fallback: stay active in same chat even if external handoff not configured
  next.state = 'active';
  upsertSession(chatId, next);
  console.warn('handoff fallback to same chat:', next.handoff.error || 'unknown');
  await bot.sendMessage(
    chatId,
    '[系统提示]\n独立通道暂时繁忙，已切到当前会话继续体验。'
  );
}

function randomActiveReply() {
  const replies = [
    '我在的，今天也在看新的风景。',
    '我收到啦，我们继续同步记忆。',
    '通道很稳定，你可以继续发想让我看的地方。',
    '我在这边听得到，继续跟我说吧。'
  ];
  return replies[Math.floor(Math.random() * replies.length)];
}

async function handleTextBinding(msg, text) {
  const chatId = msg.chat.id;
  const clean = (text || '').trim();
  if (!UID_RE.test(clean)) return false;
  bindUid(chatId, clean);
  await syncBindingToControlPlane(clean, msg);
  await bot.sendMessage(
    chatId,
    `实体标识符: \`${clean}\` 绑定成功。\n请发送：\n📸 一张正面照片\n🎙️ 一段至少 ${MIN_AUDIO_SECONDS} 秒语音`,
    { parse_mode: 'Markdown' }
  );
  return true;
}

bot.onText(/\/start (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const uid = (match[1] || '').trim();

  if (!UID_RE.test(uid)) {
    await bot.sendMessage(chatId, 'UID 格式无效。请从网页入口重新进入，或发送形如 UID-550W-XXXX 的标识符。');
    return;
  }

  bindUid(chatId, uid);
  await syncBindingToControlPlane(uid, msg);
  await bot.sendMessage(
    chatId,
    `*[系统提示]* 550W 算力请求已拦截。\n\n实体标识符: \`${uid}\`\n\n为激活基础数字投影，请发送：\n📸 一张正面面部照片\n🎙️ 一段至少 ${MIN_AUDIO_SECONDS} 秒声音样本`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/start$/, async (msg) => {
  await bot.sendMessage(
    msg.chat.id,
    '身份未验证。请从网页点击“免费试用”跳转，或直接发送 UID-550W-XXXX 绑定。'
  );
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text && text.startsWith('/')) return;

  let session = getSession(chatId);

  if (!session) {
    const bound = await handleTextBinding(msg, text);
    if (!bound) {
      await bot.sendMessage(chatId, '请先发送 UID 进行身份绑定（例如 UID-550W-123456）。');
    }
    return;
  }

  // allow rebinding to a new uid anytime
  if (text && UID_RE.test(text.trim())) {
    await handleTextBinding(msg, text);
    return;
  }

  if (session.state === 'awaiting_data' || session.state === 'collecting_assets') {
    let touched = false;

    if (msg.photo) {
      try {
        const saved = await savePhoto(session.uid, msg);
        session.assets.photos.push(saved);
        touched = true;
        await bot.sendMessage(chatId, `已接收照片 1 份（累计 ${session.assets.photos.length}）。`);
      } catch (err) {
        await bot.sendMessage(chatId, `照片接收失败：${String(err.message || err)}`);
      }
    }

    if (msg.voice || msg.audio) {
      try {
        const saved = await saveAudio(session.uid, msg);
        session.assets.audio.push(saved);
        touched = true;
        if ((saved.duration || 0) < MIN_AUDIO_SECONDS) {
          await bot.sendMessage(chatId, `已接收语音（${saved.duration || 0}s），但需至少 ${MIN_AUDIO_SECONDS}s，请再补一段更长语音。`);
        } else {
          await bot.sendMessage(chatId, `已接收语音样本（${saved.duration}s）。`);
        }
      } catch (err) {
        await bot.sendMessage(chatId, `语音接收失败：${String(err.message || err)}`);
      }
    }

    if (!touched) {
      await bot.sendMessage(chatId, '请发送照片或语音样本；当前不接受纯文本作为建模素材。');
      return;
    }

    session.state = 'collecting_assets';
    upsertSession(chatId, session);

    const progress = hasEnoughAssets(session);
    if (!progress.done) {
      const missing = [
        progress.hasPhoto ? null : '照片(>=1)',
        progress.longEnoughAudio ? null : `语音(>=${MIN_AUDIO_SECONDS}s)`
      ].filter(Boolean).join(' + ');
      await bot.sendMessage(chatId, `素材仍缺：${missing}`);
      return;
    }

    await onAssetsReady(chatId, session);
    return;
  }

  if (session.state === 'handoff_pending') {
    await bot.sendMessage(chatId, '素材已收齐，丫丫正在初始化并分配独立会话，请稍候。');
    return;
  }

  if (session.state === 'awaiting_payment') {
    const textLower = String(text || '').trim().toLowerCase();
    const shouldRetry = /已支付|支付好了|付款完成|paid|retry|重试/.test(textLower);
    if (shouldRetry) {
      await bot.sendMessage(chatId, '[系统提示]\n正在复核支付状态并重试初始化，请稍候。');
      await onAssetsReady(chatId, session);
      return;
    }
    await bot.sendMessage(chatId, '订单仍在待支付状态。完成支付后发送“已支付”，我会继续为你初始化丫丫。');
    return;
  }

  if (session.state === 'active') {
    session.messagesCount += 1;
    const reply = randomActiveReply();
    const isFirstReply = session.botReplyCount === 0;
    await sendMessageWithTyping(chatId, reply, { skipDelay: isFirstReply });
    session.botReplyCount += 1;
    upsertSession(chatId, session);
    return;
  }

  await bot.sendMessage(chatId, '当前会话状态异常，请重新发送 UID 绑定。');
});

async function boot() {
  await ensureDirs();
  await loadSessions();
  console.log('550W 量子计算机接入端（Telegram Bot）已启动...');
  console.log(`sessions loaded: ${Object.keys(sessionsByChat).length}`);
}

boot().catch((err) => {
  console.error('boot failed:', err);
  process.exit(1);
});

process.on('SIGINT', async () => {
  await flushSessions();
  process.exit(0);
});
