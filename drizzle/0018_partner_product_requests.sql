BEGIN;

ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS partner_request_id text;
ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS partner_item_id text;
ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS partner_revision integer;
ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS partner_payload_hash text;
ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS teacher_name text;
ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS subject text;
ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS partner_lifecycle_state text NOT NULL DEFAULT 'active';
ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS partner_notification_operation_id text;
ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS partner_notification_sent_at timestamp;

ALTER TABLE account_requests DROP CONSTRAINT IF EXISTS account_requests_partner_lifecycle_state_check;
ALTER TABLE account_requests ADD CONSTRAINT account_requests_partner_lifecycle_state_check
  CHECK (partner_lifecycle_state IN ('active', 'cancelled'));

CREATE INDEX IF NOT EXISTS account_requests_partner_request_idx
  ON account_requests(partner_request_id, partner_revision);
CREATE UNIQUE INDEX IF NOT EXISTS account_requests_partner_item_unique_idx
  ON account_requests(partner_request_id, partner_item_id)
  WHERE partner_request_id IS NOT NULL AND partner_item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS partner_request_operations (
  operation_id text PRIMARY KEY,
  partner_request_id text NOT NULL,
  revision integer NOT NULL,
  mode text NOT NULL,
  payload_hash text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT partner_request_operations_mode_check CHECK (mode IN ('upsert', 'cancel'))
);
CREATE INDEX IF NOT EXISTS partner_request_operations_request_idx
  ON partner_request_operations(partner_request_id, revision);

COMMIT;
