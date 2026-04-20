-- Add applicant_type to distinguish school vs individual requests
ALTER TABLE "account_requests"
  ADD COLUMN IF NOT EXISTS "applicant_type" text NOT NULL DEFAULT 'school';
