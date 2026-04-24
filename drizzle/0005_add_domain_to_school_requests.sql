-- Add domain field to school_requests so teachers can provide the school email domain
-- when requesting a new school. On approve, this copies to schools.domain.
ALTER TABLE school_requests ADD COLUMN IF NOT EXISTS domain text;
