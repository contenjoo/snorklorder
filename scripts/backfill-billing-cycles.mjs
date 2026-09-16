import pg from "pg";
import { loadProcessingSettings } from "./processing-mail-env.mjs";

const args = process.argv.slice(2);
const envIndex = args.indexOf("--env-file");
if (envIndex >= 0) loadProcessingSettings(args[envIndex + 1]);
const apply = args.includes("--apply");
if (!process.env.DATABASE_URL || (apply && process.env.BILLING_BACKLOG_APPLY !== "confirmed")) {
  throw new Error("Explicit database and backlog authorization required");
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const legacyPattern = String.raw`/ 주문번호: [A-Za-z0-9][A-Za-z0-9._:/-]{0,199} /`;
const baseWhere = `
  ar.needs_invoice = true
  AND ar.processing_email_sent_at IS NOT NULL
  AND ar.invoice_number IS NULL
  AND ar.invoice_email_send_started_at IS NULL
  AND ar.invoice_email_sent_at IS NULL
  AND ar.status IN ('sent', 'processed')
  AND ar.market_void_state NOT IN ('prepared', 'voided')
  AND ar.partner_lifecycle_state = 'active'
  AND NULLIF(BTRIM(ar.school_name_en), '') IS NOT NULL
  AND NOT (
    COALESCE(NULLIF(ar.channel, ''), 'company') = 'company'
    AND COALESCE(ar.notes ~ $1, false)
    AND (
      ar.external_source IS DISTINCT FROM 'market'
      OR NULLIF(BTRIM(ar.market_request_id), '') IS NULL
      OR NULLIF(BTRIM(ar.market_order_id), '') IS NULL
      OR NULLIF(BTRIM(ar.order_number), '') IS NULL
      OR NULLIF(BTRIM(ar.idempotency_key), '') IS NULL
      OR ar.draft_only IS DISTINCT FROM true
    )
  )
  AND NOT EXISTS (SELECT 1 FROM billing_cycle_items bci WHERE bci.account_request_id = ar.id)`;

try {
  await client.connect();
  operation: {
  const expected = await client.query("SELECT to_regclass('public.billing_cycles') IS NOT NULL AS cycles, to_regclass('public.billing_cycle_items') IS NOT NULL AS items");
  if (!expected.rows[0].cycles || !expected.rows[0].items) throw new Error("Billing cycle migration is not applied");
  const candidates = await client.query(`SELECT ar.id FROM account_requests ar WHERE ${baseWhere} ORDER BY ar.id`, [legacyPattern]);
  const review = await client.query(`
    SELECT ar.id,
      CASE
        WHEN ar.invoice_email_send_started_at IS NOT NULL AND ar.invoice_email_sent_at IS NULL THEN 'invoice_delivery_unknown'
        WHEN ar.invoice_email_sent_at IS NOT NULL THEN 'legacy_invoice_already_sent'
        WHEN NULLIF(BTRIM(ar.school_name_en), '') IS NULL THEN 'english_school_name_missing'
        WHEN ar.market_void_state IN ('prepared', 'voided') THEN 'market_voided'
        ELSE 'policy_excluded'
      END AS reason
    FROM account_requests ar
    WHERE ar.needs_invoice = true AND ar.processing_email_sent_at IS NOT NULL
      AND ar.invoice_number IS NULL
      AND NOT EXISTS (SELECT 1 FROM billing_cycle_items bci WHERE bci.account_request_id = ar.id)
      AND NOT (${baseWhere})
    ORDER BY ar.id`, [legacyPattern]);
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const code = `BACKLOG-${kst.toISOString().slice(0, 10)}`;
  console.log({ apply, code, candidateIds: candidates.rows.map((row) => row.id), manualReview: review.rows });
  if (!apply || candidates.rowCount === 0) break operation;

  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('billing-backlog'))");
  const existing = await client.query("SELECT id FROM billing_cycles WHERE code = $1", [code]);
  if (existing.rowCount > 0) {
    await client.query("ROLLBACK");
    console.log({ applied: false, code, reason: "backlog_cycle_already_exists" });
    break operation;
  }
  const cycle = await client.query(`
    INSERT INTO billing_cycles(code, kind, status, period_start, period_end)
    SELECT $2, 'backlog', 'collecting', MIN(ar.processing_email_sent_at), now()
    FROM account_requests ar WHERE ${baseWhere}
    RETURNING id`, [legacyPattern, code]);
  const cycleId = cycle.rows[0].id;
  const inserted = await client.query(`
    INSERT INTO billing_cycle_items(cycle_id, account_request_id, school_name_en, request_type, account_type, quantity, extension_date)
    SELECT $2, ar.id, ar.school_name_en, ar.type, ar.account_type,
      CASE WHEN ar.quantity > 0 THEN ar.quantity ELSE 1 END, ar.extension_date
    FROM account_requests ar WHERE ${baseWhere}
    ON CONFLICT (account_request_id) DO NOTHING
    RETURNING account_request_id`, [legacyPattern, cycleId]);
  await client.query(`
    UPDATE billing_cycles
    SET status = CASE WHEN $2::integer > 0 THEN 'ready' ELSE 'empty' END,
        locked_at = now(), updated_at = now()
    WHERE id = $1 AND status = 'collecting'`, [cycleId, inserted.rowCount]);
  await client.query("COMMIT");
  console.log({ applied: true, code, cycleId, insertedIds: inserted.rows.map((row) => row.account_request_id) });
  }
} catch {
  await client.query("ROLLBACK").catch(() => undefined);
  console.error("Billing backlog operation failed; credentials omitted");
  process.exitCode = 1;
} finally {
  await client.end();
}
