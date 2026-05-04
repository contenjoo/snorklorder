CREATE INDEX IF NOT EXISTS schools_team_idx ON schools (team);
CREATE INDEX IF NOT EXISTS schools_region_idx ON schools (region);

CREATE INDEX IF NOT EXISTS teachers_school_id_idx ON teachers (school_id);
CREATE INDEX IF NOT EXISTS teachers_school_email_idx ON teachers (school_id, email);
CREATE INDEX IF NOT EXISTS teachers_status_idx ON teachers (status);
CREATE INDEX IF NOT EXISTS teachers_created_at_idx ON teachers (created_at);

CREATE INDEX IF NOT EXISTS school_requests_status_created_at_idx ON school_requests (status, created_at);

CREATE INDEX IF NOT EXISTS account_requests_status_created_at_idx ON account_requests (status, created_at);
CREATE INDEX IF NOT EXISTS account_requests_created_at_idx ON account_requests (created_at);
