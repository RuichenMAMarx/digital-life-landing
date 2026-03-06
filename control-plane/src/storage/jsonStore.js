const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { pickChannel } = require('../lib/allocator');
const {
  nowIso,
  issueUid,
  normalizeChannel,
  defaultSession,
  mergeSession
} = require('../lib/utils');

function createEmptyState() {
  return {
    meta: {
      version: 1,
      roundRobinIndex: 0,
      updatedAt: nowIso()
    },
    ordersByUid: {},
    paymentEventsById: {},
    sessionsByUid: {},
    assignmentsByUid: {},
    channelPool: []
  };
}

function normalizeState(raw) {
  const next = createEmptyState();
  next.meta = {
    ...next.meta,
    ...(raw && raw.meta ? raw.meta : {})
  };

  next.ordersByUid = raw && raw.ordersByUid ? raw.ordersByUid : {};
  next.paymentEventsById = raw && raw.paymentEventsById ? raw.paymentEventsById : {};
  next.sessionsByUid = raw && raw.sessionsByUid ? raw.sessionsByUid : {};
  next.assignmentsByUid = raw && raw.assignmentsByUid ? raw.assignmentsByUid : {};

  if (Array.isArray(raw && raw.channelPool)) {
    next.channelPool = raw.channelPool.map((item, idx) => normalizeChannel(item, idx));
  }

  return next;
}

function createJsonStore(config) {
  const DATA_DIR = config.dataDir;
  const DB_FILE = path.join(DATA_DIR, 'db.json');
  const CHANNEL_POOL_FILE = config.channelPoolFile;

  let state = createEmptyState();
  let isSaving = false;
  let saveQueued = false;

  async function ensureDir() {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }

  async function flushState() {
    if (isSaving) {
      saveQueued = true;
      return;
    }

    isSaving = true;
    try {
      await ensureDir();
      state.meta.updatedAt = nowIso();
      await fs.writeFile(DB_FILE, JSON.stringify(state, null, 2), 'utf8');
    } finally {
      isSaving = false;
      if (saveQueued) {
        saveQueued = false;
        await flushState();
      }
    }
  }

  async function loadChannelPoolFromFile() {
    try {
      const raw = await fs.readFile(CHANNEL_POOL_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((item, idx) => normalizeChannel(item, idx));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn('load channel pool failed:', err.message);
      }
      return [];
    }
  }

  function upsertSession(uid, patch) {
    const current = state.sessionsByUid[uid] || defaultSession(uid, patch?.source || 'unknown');
    const merged = mergeSession(current, { ...patch, uid });
    state.sessionsByUid[uid] = merged;
    return merged;
  }

  function releaseChannelInternal(uid) {
    const assignment = state.assignmentsByUid[uid];
    if (!assignment) return false;

    const channel = state.channelPool.find((c) => c.id === assignment.channelId);
    if (channel && channel.activeUid === uid) {
      channel.activeUid = null;
    }

    delete state.assignmentsByUid[uid];
    return true;
  }

  function statusPayload(uid) {
    const order = state.ordersByUid[uid] || null;
    const session = state.sessionsByUid[uid] || null;
    const assignment = state.assignmentsByUid[uid] || null;

    return {
      uid,
      order,
      session,
      assignment,
      assetsSummary: {
        photos: session?.assets?.photos?.length || 0,
        audio: session?.assets?.audio?.length || 0
      },
      exists: Boolean(order || session)
    };
  }

  return {
    mode: 'json',

    async init() {
      await ensureDir();
      try {
        const raw = await fs.readFile(DB_FILE, 'utf8');
        state = normalizeState(JSON.parse(raw));
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.warn('load db failed:', err.message);
        }
        state = createEmptyState();
      }

      if (!Array.isArray(state.channelPool) || !state.channelPool.length) {
        state.channelPool = await loadChannelPoolFromFile();
        await flushState();
      }
    },

    async close() {
      await flushState();
    },

    async getHealth() {
      return {
        channelPoolSize: state.channelPool.length,
        activeAssignments: Object.keys(state.assignmentsByUid).length
      };
    },

    async createApplyOrder(input) {
      const uid = issueUid((candidate) => Boolean(state.ordersByUid[candidate]));
      const createdAt = nowIso();
      const order = {
        orderId: crypto.randomUUID(),
        uid,
        planType: input.planType,
        paymentStatus: input.paymentStatus || 'pending',
        paymentProvider: null,
        paymentReference: null,
        paymentMessage: null,
        paidAt: null,
        paymentUpdatedAt: createdAt,
        applicant: input.applicant,
        subject: input.subject,
        relation: input.relation,
        message: input.message,
        source: input.source,
        createdAt,
        updatedAt: createdAt
      };

      state.ordersByUid[uid] = order;
      upsertSession(uid, {
        uid,
        status: 'created',
        source: input.source,
        createdAt,
        updatedAt: createdAt
      });

      await flushState();
      return { uid, orderId: order.orderId, paymentStatus: order.paymentStatus };
    },

    async updateOrderPayment(input) {
      const current = state.ordersByUid[input.uid];
      if (!current) {
        return null;
      }

      const updatedAt = nowIso();
      const paymentStatus = input.paymentStatus || current.paymentStatus || 'pending';
      const nextPaidAt = input.paidAt !== undefined
        ? (input.paidAt || null)
        : (paymentStatus === 'paid' ? (current.paidAt || updatedAt) : current.paidAt || null);

      const next = {
        ...current,
        paymentStatus,
        paymentProvider: input.paymentProvider !== undefined
          ? input.paymentProvider
          : (current.paymentProvider || null),
        paymentReference: input.paymentReference !== undefined
          ? input.paymentReference
          : (current.paymentReference || null),
        paymentMessage: input.paymentMessage !== undefined
          ? input.paymentMessage
          : (current.paymentMessage || null),
        paidAt: nextPaidAt,
        paymentUpdatedAt: updatedAt,
        updatedAt
      };

      state.ordersByUid[input.uid] = next;
      await flushState();
      return next;
    },

    async updateOrderPaymentByOrderId(input) {
      if (!input.orderId) return null;
      const foundUid = Object.keys(state.ordersByUid).find(
        (uid) => String(state.ordersByUid[uid]?.orderId || '') === String(input.orderId)
      );
      if (!foundUid) return null;
      return this.updateOrderPayment({ ...input, uid: foundUid });
    },

    async isPaymentEventProcessed(eventId) {
      if (!eventId) return false;
      return Boolean(state.paymentEventsById[eventId]);
    },

    async recordPaymentEvent(input) {
      if (!input?.eventId) {
        return { recorded: false };
      }
      if (state.paymentEventsById[input.eventId]) {
        return { recorded: false, duplicate: true };
      }
      state.paymentEventsById[input.eventId] = {
        eventId: input.eventId,
        provider: input.provider || 'unknown',
        type: input.type || 'unknown',
        uid: input.uid || null,
        orderId: input.orderId || null,
        paymentStatus: input.paymentStatus || null,
        processedAt: nowIso(),
        raw: input.raw || null
      };
      await flushState();
      return { recorded: true, duplicate: false };
    },

    async bindSession(input) {
      const prev = state.sessionsByUid[input.uid] || null;
      const nextStatus = state.assignmentsByUid[input.uid]
        ? 'allocated'
        : (prev?.status === 'allocated' || prev?.status === 'active' ? prev.status : 'bound');

      const session = upsertSession(input.uid, {
        status: nextStatus,
        binding: {
          platform: input.platform,
          chatId: input.chatId,
          username: input.username || null,
          userId: input.userId || null,
          boundAt: nowIso()
        }
      });

      await flushState();
      return { uid: input.uid, sessionStatus: session.status };
    },

    async handoffSession(input) {
      const prevSession = state.sessionsByUid[input.uid] || null;
      const patch = {
        status: 'handoff_pending',
        ...(input.chatId
          ? {
              binding: {
                platform: 'telegram',
                chatId: input.chatId,
                boundAt: nowIso()
              }
            }
          : {})
      };

      const hasIncomingPhotos = Array.isArray(input.assets?.photos);
      const hasIncomingAudio = Array.isArray(input.assets?.audio);
      if (hasIncomingPhotos || hasIncomingAudio) {
        patch.assets = {
          photos: hasIncomingPhotos ? input.assets.photos : (prevSession?.assets?.photos || []),
          audio: hasIncomingAudio ? input.assets.audio : (prevSession?.assets?.audio || [])
        };
      }

      upsertSession(input.uid, patch);

      let assignment = state.assignmentsByUid[input.uid] || null;
      if (!assignment) {
        const picked = pickChannel(input.uid, state.channelPool, state.meta.roundRobinIndex, input.preferredKinds);
        assignment = picked.assignment;
        state.meta.roundRobinIndex = picked.nextRoundRobinIndex;
        state.assignmentsByUid[input.uid] = assignment;

        if (picked.pickedChannel) {
          picked.pickedChannel.activeUid = input.uid;
          picked.pickedChannel.lastAssignedAt = assignment.allocatedAt;
          picked.pickedChannel.assignmentsCount = Number(picked.pickedChannel.assignmentsCount || 0) + 1;
        }
      }

      const session = upsertSession(input.uid, {
        status: 'allocated',
        channel: assignment
      });

      await flushState();
      return { uid: input.uid, sessionStatus: session.status, assignment };
    },

    async allocateChannel(input) {
      let assignment = state.assignmentsByUid[input.uid] || null;
      if (assignment && !input.forceReallocate) {
        return { uid: input.uid, assignment, reusedExisting: true };
      }

      if (assignment && input.forceReallocate) {
        releaseChannelInternal(input.uid);
      }

      const picked = pickChannel(input.uid, state.channelPool, state.meta.roundRobinIndex, input.preferredKinds);
      assignment = picked.assignment;
      state.meta.roundRobinIndex = picked.nextRoundRobinIndex;
      state.assignmentsByUid[input.uid] = assignment;

      if (picked.pickedChannel) {
        picked.pickedChannel.activeUid = input.uid;
        picked.pickedChannel.lastAssignedAt = assignment.allocatedAt;
        picked.pickedChannel.assignmentsCount = Number(picked.pickedChannel.assignmentsCount || 0) + 1;
      }

      upsertSession(input.uid, { status: 'allocated', channel: assignment });
      await flushState();
      return { uid: input.uid, assignment, reusedExisting: false };
    },

    async releaseChannel(uid) {
      const released = releaseChannelInternal(uid);
      if (released) {
        upsertSession(uid, { status: 'active' });
        await flushState();
      }
      return { uid, released };
    },

    async patchSession(uid, patch) {
      const session = upsertSession(uid, patch || {});
      await flushState();
      return { uid, session };
    },

    async getStatus(uid) {
      return statusPayload(uid);
    },

    async getAdminState() {
      return {
        meta: state.meta,
        counts: {
          orders: Object.keys(state.ordersByUid).length,
          paymentEvents: Object.keys(state.paymentEventsById).length,
          sessions: Object.keys(state.sessionsByUid).length,
          assignments: Object.keys(state.assignmentsByUid).length,
          channels: state.channelPool.length
        }
      };
    }
  };
}

module.exports = {
  createJsonStore
};
