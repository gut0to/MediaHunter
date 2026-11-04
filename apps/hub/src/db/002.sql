CREATE TABLE job_events (
  id INTEGER PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX job_events_by_job ON job_events(job_id, id);
CREATE TRIGGER job_created_event AFTER INSERT ON jobs
BEGIN
  INSERT INTO job_events (job_id, state, created) VALUES (NEW.id, NEW.state, NEW.updated);
END;
CREATE TRIGGER job_transition_event AFTER UPDATE OF state ON jobs
WHEN OLD.state <> NEW.state
BEGIN
  INSERT INTO job_events (job_id, state, created) VALUES (NEW.id, NEW.state, NEW.updated);
END;
