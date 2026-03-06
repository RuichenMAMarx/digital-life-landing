const path = require('path');
const { createJsonStore } = require('./jsonStore');
const { createPostgresStore } = require('./postgresStore');

function resolveStorageConfig() {
  const dataDir = path.resolve(process.env.CONTROL_PLANE_DATA_DIR || path.join(__dirname, '..', '..', 'data'));
  const channelPoolFile = path.resolve(process.env.CHANNEL_POOL_FILE || path.join(dataDir, 'channel-pool.json'));
  const databaseUrl = process.env.DATABASE_URL || '';
  const storageDriver = (process.env.STORAGE_DRIVER || '').trim().toLowerCase();
  const databaseSsl = (process.env.DATABASE_SSL || 'disable').trim().toLowerCase();

  const mode = storageDriver || (databaseUrl ? 'postgres' : 'json');

  return {
    mode,
    dataDir,
    channelPoolFile,
    databaseUrl,
    databaseSsl
  };
}

function createStoreFromEnv() {
  const config = resolveStorageConfig();
  if (config.mode === 'postgres') {
    if (!config.databaseUrl) {
      throw new Error('STORAGE_DRIVER=postgres requires DATABASE_URL');
    }
    return createPostgresStore(config);
  }
  return createJsonStore(config);
}

module.exports = {
  resolveStorageConfig,
  createStoreFromEnv
};
