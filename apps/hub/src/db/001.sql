CREATE TABLE devices (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL,
  last_seen INTEGER NOT NULL, revoked INTEGER
);
CREATE TABLE pairing_codes (
  hash TEXT PRIMARY KEY, kind TEXT NOT NULL, expires INTEGER NOT NULL, consumed INTEGER
);
CREATE TABLE scans (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES devices(id), page_origin TEXT NOT NULL, expires INTEGER NOT NULL
);
CREATE TABLE candidates (
  id TEXT PRIMARY KEY, scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  metadata TEXT NOT NULL, source TEXT
);
CREATE TABLE jobs (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES devices(id), agent TEXT NOT NULL REFERENCES devices(id),
  candidate_id TEXT NOT NULL, media_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
  bytes_downloaded INTEGER NOT NULL DEFAULT 0, error_code TEXT, lease_id TEXT, lease_until INTEGER,
  created INTEGER NOT NULL, updated INTEGER NOT NULL, UNIQUE(owner, idempotency_key)
);
CREATE INDEX jobs_agent_queue ON jobs(agent, state, created);
CREATE INDEX jobs_owner_history ON jobs(owner, created);
CREATE INDEX scans_expiry ON scans(expires);
