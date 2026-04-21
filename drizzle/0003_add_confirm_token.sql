-- Add Jon's upgrade-confirmation token/timestamp to account_requests
ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS confirm_token text UNIQUE;
ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS confirmed_at timestamp;
