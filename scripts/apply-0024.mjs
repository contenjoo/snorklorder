import pg from "pg";
import { readFileSync } from "node:fs";
import { loadProcessingSettings } from "./processing-mail-env.mjs";

const args = process.argv.slice(2);
const envIndex = args.indexOf("--env-file");
if (envIndex >= 0) loadProcessingSettings(args[envIndex + 1]);
const apply = args.includes("--apply");
if (!process.env.DATABASE_URL || (apply && process.env.TERM_YEARS_MIGRATION_APPLY !== "confirmed")) {
  throw new Error("Explicit database and term-years migration authorization required");
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const expected = await client.query("SELECT to_regclass('public.billing_cycle_items') IS NOT NULL AS valid");
  if (!expected.rows[0].valid) throw new Error("Unexpected database");
  if (apply) {
    await client.query("BEGIN");
    await client.query(readFileSync(new URL("../drizzle/0024_term_years.sql", import.meta.url), "utf8"));
    await client.query("COMMIT");
  }
  const result = await client.query(`
    SELECT
      (SELECT count(*)::int FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'term_years'
          AND table_name IN ('account_requests', 'billing_cycle_items')) AS columns,
      (SELECT count(*)::int FROM pg_constraint
        WHERE conname IN ('account_requests_term_years_check', 'billing_cycle_items_term_years_check')) AS checks,
      (SELECT count(*)::int FROM account_requests) AS account_requests
  `);
  console.log({ applied: apply, ...result.rows[0] });
} catch {
  await client.query("ROLLBACK").catch(() => undefined);
  console.error("Term-years migration failed; credentials omitted");
  process.exitCode = 1;
} finally {
  await client.end();
}
