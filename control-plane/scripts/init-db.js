require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const { Pool } = require('pg');

async function readJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL || '';
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const dataDir = path.resolve(process.env.CONTROL_PLANE_DATA_DIR || path.join(__dirname, '..', 'data'));
  const channelPoolFile = path.resolve(process.env.CHANNEL_POOL_FILE || path.join(dataDir, 'channel-pool.json'));
  const schemaPath = path.resolve(__dirname, '..', 'sql', 'schema.sql');
  const sslMode = (process.env.DATABASE_SSL || 'disable').trim().toLowerCase();

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: sslMode === 'require' ? { rejectUnauthorized: false } : undefined
  });

  try {
    const schemaSql = await fs.readFile(schemaPath, 'utf8');
    await pool.query(schemaSql);

    const channels = await readJson(channelPoolFile);
    if (Array.isArray(channels) && channels.length) {
      for (let i = 0; i < channels.length; i += 1) {
        const c = channels[i] || {};
        await pool.query(
          `INSERT INTO cp_channels(id, kind, label, entrypoint, enabled, active_uid, assignments_count, last_assigned_at, sort_order)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (id) DO UPDATE SET
             kind = EXCLUDED.kind,
             label = EXCLUDED.label,
             entrypoint = EXCLUDED.entrypoint,
             enabled = EXCLUDED.enabled,
             sort_order = EXCLUDED.sort_order`,
          [
            String(c.id || `channel-${i + 1}`),
            String(c.kind || 'custom'),
            String(c.label || ''),
            String(c.entrypoint || ''),
            c.enabled !== false,
            c.activeUid ? String(c.activeUid) : null,
            Number(c.assignmentsCount || 0),
            c.lastAssignedAt ? new Date(c.lastAssignedAt) : null,
            i
          ]
        );
      }
    }

    console.log('Database initialized successfully.');
    console.log(`Schema: ${schemaPath}`);
    console.log(`Channel seed: ${channelPoolFile}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('init-db failed:', err.message || err);
  process.exit(1);
});
