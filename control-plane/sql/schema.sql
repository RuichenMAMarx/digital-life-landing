CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS cp_meta (
  key TEXT PRIMARY KEY,
  value_text TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cp_orders (
  uid TEXT PRIMARY KEY,
  order_id UUID NOT NULL DEFAULT gen_random_uuid(),
  plan_type TEXT NOT NULL,
  applicant TEXT NOT NULL,
  subject TEXT NOT NULL,
  relation TEXT NOT NULL,
  message TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS cp_orders_order_id_idx ON cp_orders(order_id);

CREATE TABLE IF NOT EXISTS cp_sessions (
  uid TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  binding JSONB NOT NULL DEFAULT '{}'::jsonb,
  assets JSONB NOT NULL DEFAULT '{"photos":[],"audio":[]}'::jsonb,
  channel JSONB NULL
);

CREATE TABLE IF NOT EXISTS cp_assignments (
  uid TEXT PRIMARY KEY,
  assignment JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cp_channels (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  entrypoint TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  active_uid TEXT NULL,
  assignments_count INTEGER NOT NULL DEFAULT 0,
  last_assigned_at TIMESTAMPTZ NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS cp_channels_enabled_sort_idx ON cp_channels(enabled, sort_order, id);
CREATE INDEX IF NOT EXISTS cp_channels_active_uid_idx ON cp_channels(active_uid);

INSERT INTO cp_meta(key, value_text, updated_at)
VALUES('roundRobinIndex', '0', NOW())
ON CONFLICT (key) DO NOTHING;
