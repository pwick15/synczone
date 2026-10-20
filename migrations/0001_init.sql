CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  initials TEXT NOT NULL,
  tz TEXT NOT NULL,
  color INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX participants_session ON participants(session_id);

CREATE TABLE meetings (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  -- Window covered by the grid, as UTC epoch milliseconds [start_utc, end_utc).
  start_utc INTEGER NOT NULL,
  end_utc INTEGER NOT NULL,
  slot_minutes INTEGER NOT NULL,
  -- The time zone the creator picked the dates in, kept for display.
  tz TEXT NOT NULL,
  created_by TEXT,
  -- Optional locked-in time, as UTC epoch milliseconds.
  chosen_start INTEGER,
  chosen_end INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX meetings_session ON meetings(session_id);

-- One row per person per meeting. `slots` is a JSON array of slot indexes,
-- where index i starts at start_utc + i * slot_minutes.
CREATE TABLE availability (
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  slots TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (meeting_id, participant_id)
);
