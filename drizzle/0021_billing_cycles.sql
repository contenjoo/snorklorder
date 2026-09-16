CREATE TABLE IF NOT EXISTS billing_cycles (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  kind text NOT NULL DEFAULT 'regular',
  status text NOT NULL DEFAULT 'collecting',
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  locked_at timestamptz,
  send_started_at timestamptz,
  sent_at timestamptz,
  request_gmail_message_id text,
  invoice_number text,
  invoice_gmail_message_id text,
  receipt_gmail_message_id text,
  invoice_received_at timestamptz,
  paid_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_cycles_kind_check CHECK (kind IN ('regular', 'backlog')),
  CONSTRAINT billing_cycles_status_check CHECK (status IN (
    'collecting', 'ready', 'sending', 'sent', 'send_unknown',
    'invoice_mismatch', 'invoiced', 'payment_mismatch', 'paid', 'empty'
  )),
  CONSTRAINT billing_cycles_period_check CHECK (period_end > period_start)
);

CREATE INDEX IF NOT EXISTS billing_cycles_status_period_end_idx
  ON billing_cycles(status, period_end);
CREATE UNIQUE INDEX IF NOT EXISTS billing_cycles_invoice_gmail_message_id_unique_idx
  ON billing_cycles(invoice_gmail_message_id) WHERE invoice_gmail_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS billing_cycles_request_gmail_message_id_unique_idx
  ON billing_cycles(request_gmail_message_id) WHERE request_gmail_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS billing_cycles_receipt_gmail_message_id_unique_idx
  ON billing_cycles(receipt_gmail_message_id) WHERE receipt_gmail_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS billing_cycle_items (
  id serial PRIMARY KEY,
  cycle_id integer NOT NULL REFERENCES billing_cycles(id) ON DELETE RESTRICT,
  account_request_id integer NOT NULL REFERENCES account_requests(id) ON DELETE RESTRICT,
  school_name_en text NOT NULL,
  request_type text NOT NULL,
  account_type text,
  quantity integer NOT NULL DEFAULT 1,
  extension_date text,
  included_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_cycle_items_quantity_check CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS billing_cycle_items_cycle_id_idx
  ON billing_cycle_items(cycle_id);
CREATE UNIQUE INDEX IF NOT EXISTS billing_cycle_items_account_request_unique_idx
  ON billing_cycle_items(account_request_id);

CREATE OR REPLACE FUNCTION enforce_collecting_billing_cycle_item()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cycle_status text;
DECLARE target_cycle_id integer;
BEGIN
  target_cycle_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.cycle_id ELSE NEW.cycle_id END;
  SELECT status INTO cycle_status
  FROM billing_cycles
  WHERE id = target_cycle_id
  FOR KEY SHARE;
  IF cycle_status IS DISTINCT FROM 'collecting' THEN
    RAISE EXCEPTION 'billing cycle % is frozen', target_cycle_id;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS billing_cycle_items_collecting_only ON billing_cycle_items;
CREATE TRIGGER billing_cycle_items_collecting_only
  BEFORE INSERT OR UPDATE OR DELETE ON billing_cycle_items
  FOR EACH ROW EXECUTE FUNCTION enforce_collecting_billing_cycle_item();
