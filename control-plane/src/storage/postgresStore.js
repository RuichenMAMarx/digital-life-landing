const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const { pickChannel } = require('../lib/allocator');
const {
  nowIso,
  normalizeChannel,
  generateUidCandidate,
  defaultSession,
  mergeSession
} = require('../lib/utils');

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function mapOrderRow(row) {
  if (!row) return null;
  return {
    orderId: row.order_id,
    uid: row.uid,
    planType: row.plan_type,
    applicant: row.applicant,
    subject: row.subject,
    relation: row.relation,
    message: row.message,
    source: row.source,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapSessionRow(row) {
  if (!row) return null;
  return {
    uid: row.uid,
    status: row.status,
    source: row.source,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    binding: row.binding || {
      platform: null,
      chatId: null,
      username: null,
      userId: null,
      boundAt: null
    },
    assets: row.assets || { photos: [], audio: [] },
    channel: row.channel || null
  };
}

function mapAssignmentRow(row) {
  if (!row) return null;
  return row.assignment || null;
}

function mapChannelRows(rows) {
  return rows.map((row, idx) => normalizeChannel({
    id: row.id,
    kind: row.kind,
    label: row.label,
    entrypoint: row.entrypoint,
    enabled: row.enabled,
    activeUid: row.active_uid,
    assignmentsCount: row.assignments_count,
    lastAssignedAt: toIso(row.last_assigned_at)
  }, idx));
}

async function readChannelPoolFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
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

function createPostgresStore(config) {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl === 'require' ? { rejectUnauthorized: false } : undefined
  });

  async function withTx(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async function ensureSchemaReady() {
    const check = await pool.query("SELECT to_regclass('public.cp_meta') AS t");
    const exists = Boolean(check.rows[0] && check.rows[0].t);
    if (!exists) {
      throw new Error('schema_not_ready: run `npm run db:init` in control-plane first');
    }
  }

  async function ensureMetaAndChannels() {
    await withTx(async (client) => {
      await client.query(
        `INSERT INTO cp_meta(key, value_text, updated_at)
         VALUES('roundRobinIndex', '0', NOW())
         ON CONFLICT (key) DO NOTHING`
      );

      const countRes = await client.query('SELECT COUNT(*)::int AS count FROM cp_channels');
      const count = Number(countRes.rows[0]?.count || 0);
      if (count > 0) return;

      const channels = await readChannelPoolFile(config.channelPoolFile);
      for (let i = 0; i < channels.length; i += 1) {
        const c = channels[i];
        await client.query(
          `INSERT INTO cp_channels(id, kind, label, entrypoint, enabled, active_uid, assignments_count, last_assigned_at, sort_order)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (id) DO UPDATE SET
             kind = EXCLUDED.kind,
             label = EXCLUDED.label,
             entrypoint = EXCLUDED.entrypoint,
             enabled = EXCLUDED.enabled,
             sort_order = EXCLUDED.sort_order`,
          [
            c.id,
            c.kind,
            c.label,
            c.entrypoint,
            c.enabled,
            c.activeUid,
            Number(c.assignmentsCount || 0),
            c.lastAssignedAt ? new Date(c.lastAssignedAt) : null,
            i
          ]
        );
      }
    });
  }

  async function getRoundRobinIndex(client, lock = false) {
    const sql = lock
      ? `SELECT value_text FROM cp_meta WHERE key = 'roundRobinIndex' FOR UPDATE`
      : `SELECT value_text FROM cp_meta WHERE key = 'roundRobinIndex'`;
    const row = (await client.query(sql)).rows[0];
    return Number(row?.value_text || 0);
  }

  async function setRoundRobinIndex(client, value) {
    await client.query(
      `INSERT INTO cp_meta(key, value_text, updated_at)
       VALUES('roundRobinIndex', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value_text = EXCLUDED.value_text, updated_at = NOW()`,
      [String(Number(value || 0))]
    );
  }

  async function getOrderByUid(client, uid) {
    const row = (await client.query('SELECT * FROM cp_orders WHERE uid = $1', [uid])).rows[0];
    return mapOrderRow(row);
  }

  async function getSessionByUid(client, uid) {
    const row = (await client.query('SELECT * FROM cp_sessions WHERE uid = $1', [uid])).rows[0];
    return mapSessionRow(row);
  }

  async function getAssignmentByUid(client, uid) {
    const row = (await client.query('SELECT assignment FROM cp_assignments WHERE uid = $1', [uid])).rows[0];
    return mapAssignmentRow(row);
  }

  async function upsertSession(client, uid, patch) {
    const current = (await getSessionByUid(client, uid)) || defaultSession(uid, patch?.source || 'unknown');
    const merged = mergeSession(current, { ...patch, uid });

    await client.query(
      `INSERT INTO cp_sessions(uid, status, source, created_at, updated_at, binding, assets, channel)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb)
       ON CONFLICT (uid) DO UPDATE SET
         status = EXCLUDED.status,
         source = EXCLUDED.source,
         updated_at = EXCLUDED.updated_at,
         binding = EXCLUDED.binding,
         assets = EXCLUDED.assets,
         channel = EXCLUDED.channel`,
      [
        merged.uid,
        merged.status,
        merged.source,
        new Date(merged.createdAt),
        new Date(merged.updatedAt),
        JSON.stringify(merged.binding || {}),
        JSON.stringify(merged.assets || { photos: [], audio: [] }),
        JSON.stringify(merged.channel || null)
      ]
    );

    return merged;
  }

  async function setAssignment(client, uid, assignment) {
    await client.query(
      `INSERT INTO cp_assignments(uid, assignment, created_at, updated_at)
       VALUES($1,$2::jsonb,NOW(),NOW())
       ON CONFLICT (uid) DO UPDATE SET assignment = EXCLUDED.assignment, updated_at = NOW()`,
      [uid, JSON.stringify(assignment)]
    );
  }

  async function releaseChannelInTx(client, uid) {
    const assignment = await getAssignmentByUid(client, uid);
    if (!assignment) return false;

    if (assignment.channelId) {
      await client.query(
        `UPDATE cp_channels SET active_uid = NULL WHERE id = $1 AND active_uid = $2`,
        [assignment.channelId, uid]
      );
    }

    await client.query('DELETE FROM cp_assignments WHERE uid = $1', [uid]);
    return true;
  }

  async function allocateInTx(client, uid, preferredKinds) {
    const rows = (await client.query(
      `SELECT * FROM cp_channels WHERE enabled = TRUE ORDER BY sort_order, id FOR UPDATE`
    )).rows;
    const channels = mapChannelRows(rows);
    const rr = await getRoundRobinIndex(client, true);
    const picked = pickChannel(uid, channels, rr, preferredKinds);

    if (picked.pickedChannel) {
      await client.query(
        `UPDATE cp_channels
         SET active_uid = $2,
             assignments_count = assignments_count + 1,
             last_assigned_at = NOW()
         WHERE id = $1`,
        [picked.pickedChannel.id, uid]
      );
    }

    await setRoundRobinIndex(client, picked.nextRoundRobinIndex);
    await setAssignment(client, uid, picked.assignment);
    return picked.assignment;
  }

  async function buildStatus(uid) {
    const client = await pool.connect();
    try {
      const [order, session, assignment] = await Promise.all([
        getOrderByUid(client, uid),
        getSessionByUid(client, uid),
        getAssignmentByUid(client, uid)
      ]);

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
    } finally {
      client.release();
    }
  }

  return {
    mode: 'postgres',

    async init() {
      await ensureSchemaReady();
      await ensureMetaAndChannels();
    },

    async close() {
      await pool.end();
    },

    async getHealth() {
      const [channels, active] = await Promise.all([
        pool.query('SELECT COUNT(*)::int AS count FROM cp_channels WHERE enabled = TRUE'),
        pool.query('SELECT COUNT(*)::int AS count FROM cp_assignments')
      ]);

      return {
        channelPoolSize: Number(channels.rows[0]?.count || 0),
        activeAssignments: Number(active.rows[0]?.count || 0)
      };
    },

    async createApplyOrder(input) {
      return withTx(async (client) => {
        let uid = '';
        for (let i = 0; i < 10; i += 1) {
          const candidate = generateUidCandidate();
          const exists = (await client.query('SELECT 1 FROM cp_orders WHERE uid = $1', [candidate])).rowCount > 0;
          if (!exists) {
            uid = candidate;
            break;
          }
        }
        if (!uid) {
          uid = `UID-550W-${Date.now()}-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
        }

        const createdAt = nowIso();
        const orderId = crypto.randomUUID();
        await client.query(
          `INSERT INTO cp_orders(order_id, uid, plan_type, applicant, subject, relation, message, source, created_at, updated_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
          [
            orderId,
            uid,
            input.planType,
            input.applicant,
            input.subject,
            input.relation,
            input.message,
            input.source,
            new Date(createdAt)
          ]
        );

        await upsertSession(client, uid, {
          uid,
          status: 'created',
          source: input.source,
          createdAt,
          updatedAt: createdAt
        });

        return { uid, orderId };
      });
    },

    async bindSession(input) {
      return withTx(async (client) => {
        const prev = await getSessionByUid(client, input.uid);
        const existingAssignment = await getAssignmentByUid(client, input.uid);
        const nextStatus = existingAssignment
          ? 'allocated'
          : (prev?.status === 'allocated' || prev?.status === 'active' ? prev.status : 'bound');

        const session = await upsertSession(client, input.uid, {
          status: nextStatus,
          binding: {
            platform: input.platform,
            chatId: input.chatId,
            username: input.username || null,
            userId: input.userId || null,
            boundAt: nowIso()
          }
        });

        return { uid: input.uid, sessionStatus: session.status };
      });
    },

    async handoffSession(input) {
      return withTx(async (client) => {
        const prevSession = await getSessionByUid(client, input.uid);
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

        await upsertSession(client, input.uid, patch);

        let assignment = await getAssignmentByUid(client, input.uid);
        if (!assignment) {
          assignment = await allocateInTx(client, input.uid, input.preferredKinds);
        }

        const session = await upsertSession(client, input.uid, {
          status: 'allocated',
          channel: assignment
        });

        return { uid: input.uid, sessionStatus: session.status, assignment };
      });
    },

    async allocateChannel(input) {
      return withTx(async (client) => {
        let assignment = await getAssignmentByUid(client, input.uid);
        if (assignment && !input.forceReallocate) {
          return { uid: input.uid, assignment, reusedExisting: true };
        }

        if (assignment && input.forceReallocate) {
          await releaseChannelInTx(client, input.uid);
        }

        assignment = await allocateInTx(client, input.uid, input.preferredKinds);
        await upsertSession(client, input.uid, {
          status: 'allocated',
          channel: assignment
        });
        return { uid: input.uid, assignment, reusedExisting: false };
      });
    },

    async releaseChannel(uid) {
      return withTx(async (client) => {
        const released = await releaseChannelInTx(client, uid);
        if (released) {
          await upsertSession(client, uid, { status: 'active' });
        }
        return { uid, released };
      });
    },

    async getStatus(uid) {
      return buildStatus(uid);
    },

    async getAdminState() {
      const [orders, sessions, assignments, channels, meta] = await Promise.all([
        pool.query('SELECT COUNT(*)::int AS count FROM cp_orders'),
        pool.query('SELECT COUNT(*)::int AS count FROM cp_sessions'),
        pool.query('SELECT COUNT(*)::int AS count FROM cp_assignments'),
        pool.query('SELECT COUNT(*)::int AS count FROM cp_channels'),
        pool.query("SELECT value_text, updated_at FROM cp_meta WHERE key = 'roundRobinIndex'")
      ]);

      return {
        meta: {
          version: 1,
          roundRobinIndex: Number(meta.rows[0]?.value_text || 0),
          updatedAt: toIso(meta.rows[0]?.updated_at)
        },
        counts: {
          orders: Number(orders.rows[0]?.count || 0),
          sessions: Number(sessions.rows[0]?.count || 0),
          assignments: Number(assignments.rows[0]?.count || 0),
          channels: Number(channels.rows[0]?.count || 0)
        }
      };
    }
  };
}

module.exports = {
  createPostgresStore
};
