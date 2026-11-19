-- Durable outbox. Each lead contributes at most one qualification and one sale.
-- No names, phones, email addresses or chat content are stored here.
CREATE TABLE IF NOT EXISTS google_conversion_events (
 id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
 client_id text NOT NULL,
 lead_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('qualified','sale')),
 account_id text NOT NULL CHECK(account_id ~ '^[0-9]{10}$'),
 conversion_customer_id text NOT NULL CHECK(conversion_customer_id ~ '^[0-9]{10}$'),
 action_id text NOT NULL CHECK(action_id ~ '^[0-9]{1,20}$'),
 occurred_at timestamptz NOT NULL,
 value numeric NOT NULL CHECK(value>=0),
 gclid text,
 status text NOT NULL CHECK(status IN ('pending','processing','submitted','succeeded','failed','skipped','cancelled')),
 reason text,
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 processing_at timestamptz,
 request_id text,
 submitted_at timestamptz,
 warnings boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(client_id,lead_id,kind)
);
CREATE INDEX IF NOT EXISTS google_conversion_events_due ON google_conversion_events(status,next_attempt_at);
CREATE INDEX IF NOT EXISTS google_conversion_events_client ON google_conversion_events(client_id,created_at DESC);
