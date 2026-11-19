CREATE TABLE IF NOT EXISTS media_backup_runs (
  day date PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  drive_file_id text,
  sha256 text,
  file_count integer,
  source_bytes bigint,
  archive_kind text CHECK (archive_kind IN ('full', 'incremental', 'no_changes')),
  error_code text
);

CREATE TABLE IF NOT EXISTS media_backup_files (
  relative_path text PRIMARY KEY,
  bytes bigint NOT NULL,
  mtime_ms bigint NOT NULL,
  backed_up_day date NOT NULL REFERENCES media_backup_runs(day)
);
