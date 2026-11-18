CREATE TABLE bucket_settings (
  bucket_id TEXT PRIMARY KEY,
  name TEXT COLLATE NOCASE UNIQUE,
  region TEXT,
  quota INTEGER,
  priority INTEGER,
  credentials TEXT,
  paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
  removed INTEGER NOT NULL DEFAULT 0 CHECK (removed IN (0, 1))
);
