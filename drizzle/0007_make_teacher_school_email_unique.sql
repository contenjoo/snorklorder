CREATE UNIQUE INDEX IF NOT EXISTS teachers_school_email_unique_idx ON teachers (school_id, email);
DROP INDEX IF EXISTS teachers_school_email_idx;
