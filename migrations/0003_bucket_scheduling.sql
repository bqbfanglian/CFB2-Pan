ALTER TABLE uploads ADD COLUMN write_started INTEGER NOT NULL DEFAULT 1 CHECK (write_started IN (0, 1));
UPDATE uploads SET write_started = 0 WHERE state = 'open' AND multipart = 1 AND multipart_id IS NULL;

CREATE TABLE bucket_health (
  bucket_id TEXT PRIMARY KEY,
  retry_at INTEGER NOT NULL
);
