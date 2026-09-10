CREATE TABLE IF NOT EXISTS processing_mail_outbox (
  message_id text PRIMARY KEY,
  snapshots jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('prepared','sent')),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE TABLE IF NOT EXISTS processing_mail_evidence (
  message_id text PRIMARY KEY,
  parent_id text NOT NULL,
  sender text NOT NULL,
  received_at timestamptz NOT NULL,
  gmail_id text,
  authenticated boolean NOT NULL,
  source_verified boolean NOT NULL,
  excerpt text NOT NULL,
  reason text NOT NULL,
  snapshots jsonb NOT NULL,
  selected_ids jsonb NOT NULL,
  incomplete boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS processing_mail_decisions (
  message_id text NOT NULL REFERENCES processing_mail_evidence(message_id),
  request_id integer NOT NULL REFERENCES account_requests(id),
  outcome text NOT NULL CHECK (outcome IN ('applied','already_confirmed','review','excluded')),
  reason text NOT NULL,
  reviewed_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, request_id)
);
CREATE TABLE IF NOT EXISTS processing_mail_cursor (
  mailbox text PRIMARY KEY,
  uid_validity text NOT NULL,
  last_uid bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS processing_mail_review_idx ON processing_mail_decisions(outcome, updated_at DESC);
