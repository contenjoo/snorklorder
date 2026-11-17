import pg from 'pg';
import { readFileSync } from 'node:fs';
import { loadProcessingSettings } from './processing-mail-env.mjs';

const args = process.argv.slice(2);
const envIndex = args.indexOf('--env-file');
if (envIndex >= 0) loadProcessingSettings(args[envIndex + 1]);
const apply = args.includes('--apply');
if (!process.env.DATABASE_URL || (apply && process.env.CONFIRM_SCHOOL_STORE_LINKS_APPLY !== 'confirmed')) {
  throw new Error('Explicit database and school-store short-link migration authorization required');
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const target = await client.query("SELECT current_database() AS name, to_regclass('public.account_requests') IS NOT NULL AS requests");
  if (target.rows[0].name !== 'snorkl_order' || !target.rows[0].requests) throw new Error('Unexpected database');
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query("SET LOCAL statement_timeout = '15s'");
  await client.query(readFileSync(new URL('../drizzle/0029_school_store_input_links.sql', import.meta.url), 'utf8'));
  const columns = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='school_store_input_links' ORDER BY ordinal_position");
  if (columns.rows.map((row) => row.column_name).join(',') !== 'code_hash,signed_token,expires_at,created_at') {
    throw new Error('Unexpected short-link table schema');
  }
  const guards = await client.query("SELECT count(*)::int AS count FROM pg_constraint WHERE conrelid='public.school_store_input_links'::regclass AND conname IN ('school_store_input_links_pkey','school_store_input_links_code_hash_check','school_store_input_links_token_length_check','school_store_input_links_expiry_check')");
  if (guards.rows[0].count !== 4) throw new Error('Short-link constraints missing');
  await client.query(apply ? 'COMMIT' : 'ROLLBACK');
  const after = await client.query("SELECT to_regclass('public.school_store_input_links') IS NOT NULL AS exists");
  console.log({ applied: apply, transactionSchemaVerified: true, tableExists: after.rows[0].exists });
  if (apply && !after.rows[0].exists) process.exitCode = 1;
} catch {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error('School-store short-link migration failed; credentials omitted');
  process.exitCode = 1;
} finally {
  await client.end();
}
