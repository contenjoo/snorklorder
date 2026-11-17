-- A separate lookup for short school-store input links. Existing purchase,
-- request, billing, payment and email records are not changed.
CREATE TABLE IF NOT EXISTS "school_store_input_links" (
  "code_hash" text PRIMARY KEY,
  "signed_token" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "school_store_input_links_code_hash_check"
    CHECK ("code_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "school_store_input_links_token_length_check"
    CHECK (length("signed_token") BETWEEN 1 AND 4096),
  CONSTRAINT "school_store_input_links_expiry_check"
    CHECK ("expires_at" > "created_at")
);
CREATE INDEX IF NOT EXISTS "school_store_input_links_expires_at_idx"
  ON "school_store_input_links" ("expires_at");
