ALTER TABLE jobs ADD COLUMN total_bytes INTEGER;
CREATE TABLE device_actions (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  agent TEXT NOT NULL REFERENCES devices(id),
  action TEXT NOT NULL,
  created INTEGER NOT NULL,
  consumed INTEGER
);
CREATE INDEX device_actions_pending ON device_actions(agent, consumed, created);
