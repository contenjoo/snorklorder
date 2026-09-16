ALTER TABLE school_requests
  ADD COLUMN IF NOT EXISTS account_request_id integer
    REFERENCES account_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS billing_request_created_at timestamp;

CREATE UNIQUE INDEX IF NOT EXISTS school_requests_account_request_unique_idx
  ON school_requests(account_request_id)
  WHERE account_request_id IS NOT NULL;
