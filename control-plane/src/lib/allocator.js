const crypto = require('crypto');
const { nowIso, normalizeText } = require('./utils');

function filterChannels(channels, preferredKinds) {
  const preferred = Array.isArray(preferredKinds)
    ? preferredKinds.map((item) => normalizeText(item, 64)).filter(Boolean)
    : [];

  const enabled = channels.filter((c) => c.enabled !== false);
  if (!enabled.length) return [];
  if (!preferred.length) return enabled;

  const picked = enabled.filter((c) => preferred.includes(c.kind));
  return picked.length ? picked : enabled;
}

function allocateVirtual(uid, reason = 'empty_channel_pool') {
  return {
    uid,
    assignmentId: crypto.randomUUID(),
    strategy: 'virtual_fallback',
    kind: 'virtual',
    channelId: `virtual-${uid}`,
    label: 'Virtual Dedicated Session',
    entrypoint: '',
    reused: false,
    reason,
    allocatedAt: nowIso()
  };
}

function pickChannel(uid, channels, roundRobinIndex, preferredKinds) {
  const candidates = filterChannels(channels, preferredKinds);
  if (!candidates.length) {
    return {
      assignment: allocateVirtual(uid),
      pickedChannel: null,
      nextRoundRobinIndex: 0
    };
  }

  const start = Number(roundRobinIndex || 0) % candidates.length;
  let picked = null;
  let pickedIndex = -1;

  for (let i = 0; i < candidates.length; i += 1) {
    const idx = (start + i) % candidates.length;
    const c = candidates[idx];
    if (!c.activeUid || c.activeUid === uid) {
      picked = c;
      pickedIndex = idx;
      break;
    }
  }

  let reused = false;
  if (!picked) {
    picked = candidates[start];
    pickedIndex = start;
    reused = true;
  }

  const assignment = {
    uid,
    assignmentId: crypto.randomUUID(),
    strategy: 'round_robin',
    kind: picked.kind,
    channelId: picked.id,
    label: picked.label,
    entrypoint: picked.entrypoint,
    reused,
    allocatedAt: nowIso()
  };

  return {
    assignment,
    pickedChannel: picked,
    nextRoundRobinIndex: (pickedIndex + 1) % candidates.length
  };
}

module.exports = {
  pickChannel,
  allocateVirtual,
  filterChannels
};
