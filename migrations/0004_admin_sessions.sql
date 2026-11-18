CREATE TABLE admin_sessions (
  digest TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE INDEX admin_sessions_expiry ON admin_sessions(expires_at);

CREATE TABLE admin_login_attempts (
  requester TEXT NOT NULL,
  window INTEGER NOT NULL,
  attempts INTEGER NOT NULL,
  PRIMARY KEY (requester, window)
);

CREATE INDEX admin_login_attempts_expiry ON admin_login_attempts(window);
