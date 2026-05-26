CREATE TABLE IF NOT EXISTS "domain_requests" (
  "id" serial PRIMARY KEY NOT NULL,
  "school_name" text NOT NULL,
  "school_name_en" text,
  "domain" text NOT NULL,
  "team" text,
  "note" text,
  "status" text NOT NULL DEFAULT 'pending',
  "confirm_token" text UNIQUE NOT NULL,
  "confirmed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "domain_requests_status_idx" ON "domain_requests" ("status");
CREATE INDEX IF NOT EXISTS "domain_requests_created_at_idx" ON "domain_requests" ("created_at");
