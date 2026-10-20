BEGIN;
-- Keep the original request, financial state, identifiers and delivery history.
ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS archive_reason text;
CREATE TABLE IF NOT EXISTS account_request_admin_audit (
  id bigserial PRIMARY KEY,
  operation_id text NOT NULL,
  request_id integer NOT NULL REFERENCES account_requests(id) ON DELETE RESTRICT,
  action text NOT NULL,
  reason text NOT NULL,
  before_row jsonb NOT NULL,
  after_row jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operation_id, request_id)
);
COMMIT;
