CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES entries(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('folder', 'file')),
  bucket_id TEXT,
  object_key TEXT,
  version_id TEXT,
  bytes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  CHECK ((kind = 'folder' AND bucket_id IS NULL AND object_key IS NULL AND version_id IS NULL)
      OR (kind = 'file' AND bucket_id IS NOT NULL AND object_key IS NOT NULL AND version_id IS NOT NULL))
);

CREATE UNIQUE INDEX entries_name ON entries(parent_id, name) WHERE deleted_at IS NULL;
CREATE INDEX entries_list ON entries(parent_id, deleted_at, kind, name, id);
CREATE INDEX entries_bucket ON entries(bucket_id);
CREATE INDEX entries_pending_deletion ON entries(deleted_at) WHERE deleted_at IS NOT NULL;
INSERT INTO entries (id, name, kind, created_at, updated_at) VALUES ('root', '我的文件', 'folder', 0, 0);

CREATE TABLE uploads (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL,
  name TEXT NOT NULL,
  bucket_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  multipart INTEGER NOT NULL,
  multipart_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('open', 'done', 'cancelled', 'cleaned')),
  expires_at INTEGER NOT NULL,
  lock_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX uploads_bucket ON uploads(bucket_id, state);
CREATE INDEX uploads_expiry ON uploads(state, expires_at);
CREATE INDEX uploads_parent ON uploads(parent_id, state);

CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  digest TEXT NOT NULL UNIQUE,
  file_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  password_salt TEXT,
  password_hash TEXT,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE share_attempts (
  share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  requester TEXT NOT NULL,
  window INTEGER NOT NULL,
  attempts INTEGER NOT NULL,
  PRIMARY KEY (share_id, requester, window)
);

CREATE INDEX share_attempts_expiry ON share_attempts(window);

CREATE TABLE demo_parts (
  upload_id TEXT NOT NULL,
  part_number INTEGER NOT NULL,
  etag TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  PRIMARY KEY (upload_id, part_number)
);
