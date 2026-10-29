import pg from 'pg';
import { readFileSync } from 'node:fs';
import { loadProcessingSettings } from './processing-mail-env.mjs';

const args = process.argv.slice(2);
const envIndex = args.indexOf('--env-file');
if (envIndex >= 0) loadProcessingSettings(args[envIndex + 1]);
const apply = args.includes('--apply');
if (!process.env.DATABASE_URL || (apply && process.env.ACCOUNT_COLLECTION_MIGRATION_APPLY !== 'confirmed')) {
  throw new Error('Explicit database and account-collection migration authorization required');
}
const verify = `SELECT
  (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public'
    AND table_name='market_account_collection_sync' AND column_name IN
    ('collection_id','submission_hash','payload_hash','source_kind','market_order_id','order_number','request_ids','created_at')) AS columns,
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='market_account_collection_receipt_immutable' AND NOT tgisinternal) AS immutable,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='market_account_collection_sync_requests_idx') AS lookup_index,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='account_requests' AND column_name='market_collection_id') AS account_column,
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='account_requests_collection_duplicate_guard' AND NOT tgisinternal) AS request_guard`;
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const expected = await client.query(`SELECT to_regclass('public.account_requests') IS NOT NULL
    AND to_regclass('public.market_order_void_fences') IS NOT NULL AS valid`);
  if (!expected.rows[0].valid) throw new Error('Unexpected database');
  if (apply) {
    await client.query('BEGIN');
    await client.query(readFileSync(new URL('../drizzle/0028_market_account_collection_sync.sql', import.meta.url), 'utf8'));
    const checked = (await client.query(verify)).rows[0];
    if (checked.columns !== 8 || !checked.immutable || !checked.lookup_index || !checked.account_column || !checked.request_guard) throw new Error('Migration verification failed');
    await client.query('COMMIT');
  }
  console.log({ applied: apply, ...(await client.query(verify)).rows[0] });
} catch {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error('Account-collection migration failed; credentials omitted');
  process.exitCode = 1;
} finally { await client.end(); }
