CREATE TABLE IF NOT EXISTS security_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS security_rate_limits (key text PRIMARY KEY, count integer NOT NULL, reset_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS security_rate_limits_expiry_idx ON security_rate_limits(reset_at);
ALTER TABLE upgrade_batches ADD COLUMN IF NOT EXISTS token_expires_at timestamp DEFAULT ((now() AT TIME ZONE 'UTC')+interval '7 days');
ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS token_expires_at timestamp DEFAULT ((now() AT TIME ZONE 'UTC')+interval '7 days');
ALTER TABLE domain_requests ADD COLUMN IF NOT EXISTS token_expires_at timestamp DEFAULT ((now() AT TIME ZONE 'UTC')+interval '7 days');
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM security_migrations WHERE name='0019_token_grace') THEN
  INSERT INTO security_migrations(name) VALUES('0019_token_grace');
 END IF;
END $$;
ALTER TABLE upgrade_batches ALTER COLUMN token_expires_at SET DEFAULT ((now() AT TIME ZONE 'UTC')+interval '30 days');
ALTER TABLE account_requests ALTER COLUMN token_expires_at SET DEFAULT ((now() AT TIME ZONE 'UTC')+interval '30 days');
ALTER TABLE domain_requests ALTER COLUMN token_expires_at SET DEFAULT ((now() AT TIME ZONE 'UTC')+interval '30 days');
CREATE OR REPLACE FUNCTION confirm_teacher_batch(p_token text, p_ids integer[])
RETURNS TABLE(teacher_id integer) LANGUAGE plpgsql SET timezone='UTC' AS $$
DECLARE b upgrade_batches%ROWTYPE; original_ids integer[]; school_ids integer[]; actual_ids integer[];
BEGIN
 SELECT * INTO b FROM upgrade_batches WHERE token=p_token AND token_expires_at>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_CONFIRM_TOKEN'; END IF;
 SELECT coalesce(array_agg(value::integer),'{}'::integer[]) INTO original_ids FROM jsonb_array_elements_text(b.teacher_ids::jsonb);
 SELECT coalesce(array_agg(DISTINCT school_id),'{}'::integer[]) INTO school_ids FROM teachers WHERE id=ANY(original_ids);
 PERFORM id FROM teachers WHERE id=ANY(p_ids) ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM unnest(p_ids) AS requested(id) WHERE NOT EXISTS(
   SELECT 1 FROM teachers t WHERE t.id=requested.id AND (t.id=ANY(original_ids) OR (t.school_id=ANY(school_ids) AND t.status IN ('pending','sent')))
 )) THEN RAISE EXCEPTION 'CONFIRM_SCOPE_VIOLATION'; END IF;
 WITH changed AS (
 UPDATE teachers SET status='upgraded', verification_status='approved',
 approved_at=CASE WHEN verification_status='approved' THEN approved_at ELSE now() END,
 approved_by=CASE WHEN verification_status='approved' THEN approved_by ELSE 'hq_confirm' END
 WHERE id=ANY(p_ids) AND status IN ('pending','sent') RETURNING id
 ) SELECT coalesce(array_agg(id),'{}'::integer[]) INTO actual_ids FROM changed;
 UPDATE upgrade_batches SET
 teacher_ids=(SELECT coalesce(jsonb_agg(DISTINCT id),'[]'::jsonb)::text FROM unnest(original_ids||p_ids) id),
 confirmed_ids=(SELECT coalesce(jsonb_agg(DISTINCT id),'[]'::jsonb)::text FROM unnest(
   ARRAY(SELECT value::integer FROM jsonb_array_elements_text(coalesce(b.confirmed_ids,'[]')::jsonb))||p_ids) id),
 status='confirmed', confirmed_at=coalesce(confirmed_at,now()) WHERE id=b.id;
 RETURN QUERY SELECT unnest(actual_ids);
END $$;
CREATE OR REPLACE FUNCTION verify_teacher_email(p_hash text) RETURNS text LANGUAGE plpgsql SET timezone='UTC' AS $$
DECLARE tid integer; sid integer; address text; allowed text[]; verdict text;
BEGIN
 SELECT teacher_id INTO tid FROM email_verification_tokens WHERE token=p_hash;
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM id FROM teachers WHERE id=tid FOR UPDATE;
 UPDATE email_verification_tokens SET used_at=now() WHERE token=p_hash AND used_at IS NULL AND expires_at>now() RETURNING teacher_id INTO tid;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT school_id,email INTO sid,address FROM teachers WHERE id=tid;
 SELECT array_remove(array_prepend(lower(trim(domain)),string_to_array(lower(replace(coalesce(allowed_domains,''),' ','')),',')),NULL) INTO allowed FROM schools WHERE id=sid;
 verdict:=CASE WHEN lower(split_part(address,'@',2))=ANY(allowed) THEN 'approved' ELSE 'email_verified' END;
 UPDATE teachers SET email_verified_at=now(),verification_status=verdict,
 approved_at=CASE WHEN verdict='approved' THEN now() ELSE NULL END,
 approved_by=CASE WHEN verdict='approved' THEN 'domain' ELSE NULL END,
 escalated_at=CASE WHEN verdict='email_verified' AND NOT EXISTS(SELECT 1 FROM school_admins WHERE school_id=sid) THEN now() ELSE NULL END
 WHERE id=tid AND verification_status='unverified';
 UPDATE email_verification_tokens SET used_at=now() WHERE teacher_id=tid AND used_at IS NULL;
 RETURN (SELECT verification_status FROM teachers WHERE id=tid);
END $$;
ALTER TABLE school_login_tokens ADD COLUMN IF NOT EXISTS browser_hash text;
