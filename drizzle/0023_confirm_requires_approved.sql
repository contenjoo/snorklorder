-- 0023: HQ confirm link may only add same-school teachers that are already approved.
-- Original batch ids stay allowed as-is. Idempotent (CREATE OR REPLACE only).
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
   SELECT 1 FROM teachers t WHERE t.id=requested.id AND (t.id=ANY(original_ids) OR (t.school_id=ANY(school_ids) AND t.status IN ('pending','sent') AND t.verification_status='approved'))
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
