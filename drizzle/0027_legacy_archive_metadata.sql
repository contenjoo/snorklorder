-- The legacy Market guard continues to reject deletion, identity and financial writes.
-- Only a one-way, metadata-only archival operation is permitted without strict identity.
DO $migration$
DECLARE
  definition text;
  anchor text := '  IF NEW."external_source" IS DISTINCT FROM ''market'' THEN';
  guard text := $guard$
  -- ARCHIVE_METADATA_ONLY: no payment, account, note, identity or fulfillment change.
  IF TG_OP = 'UPDATE'
    AND OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL
    AND NULLIF(BTRIM(NEW.archive_reason), '') IS NOT NULL
    AND OLD.external_source IS DISTINCT FROM 'market'
    AND (to_jsonb(NEW) - ARRAY['archived_at', 'archive_reason', 'updated_at'])
      IS NOT DISTINCT FROM
        (to_jsonb(OLD) - ARRAY['archived_at', 'archive_reason', 'updated_at']) THEN
    RETURN NEW;
  END IF;
$guard$;
BEGIN
  SELECT pg_get_functiondef('guard_market_account_request_write()'::regprocedure) INTO definition;
  IF strpos(definition, 'ARCHIVE_METADATA_ONLY') > 0 THEN RETURN; END IF;
  IF strpos(definition, anchor) = 0 THEN
    RAISE EXCEPTION 'Unexpected legacy guard definition; manual review required';
  END IF;
  EXECUTE replace(definition, anchor, guard || E'\n' || anchor);
END;
$migration$;
