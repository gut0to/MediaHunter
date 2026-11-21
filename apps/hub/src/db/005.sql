ALTER TABLE jobs ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'
  CHECK (priority IN ('low', 'normal', 'high'));
ALTER TABLE jobs ADD COLUMN next_attempt_at INTEGER;
CREATE INDEX jobs_agent_schedule ON jobs(agent, state, next_attempt_at, priority, created);
