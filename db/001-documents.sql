-- PostgreSQL is authoritative. JSONB preserves every legacy field during import.
-- Rollback: restore the verified pre-migration snapshot using the documented runbook.
CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS app_documents (
  name text PRIMARY KEY CHECK (name ~ '^[a-z0-9][a-z0-9-]*\.json$'),
  payload jsonb NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS backup_runs (
  day date PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  drive_file_id text,
  sha256 text,
  error_code text
);
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key text PRIMARY KEY,
  attempts integer NOT NULL,
  resets_at timestamptz NOT NULL
);
