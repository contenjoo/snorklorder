import pg from "pg";
import { readFileSync } from "node:fs";
import { loadProcessingSettings } from "./processing-mail-env.mjs";

const args = process.argv.slice(2);
const envIndex = args.indexOf("--env-file");
if (envIndex >= 0) loadProcessingSettings(args[envIndex + 1]);
const apply = args.includes("--apply");
if (!process.env.DATABASE_URL || (apply && process.env.SCHOOL_BILLING_MIGRATION_APPLY !== "confirmed")) {
  throw new Error("Explicit database and school-billing migration authorization required");
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const expected = await client.query("SELECT to_regclass('public.account_requests') IS NOT NULL AS valid");
  if (!expected.rows[0].valid) throw new Error("Unexpected database");
  if (apply) {
    await client.query("BEGIN");
    await client.query(readFileSync(new URL("../drizzle/0025_school_billing_request.sql", import.meta.url), "utf8"));
    await client.query("COMMIT");
  }
  const result = await client.query(`
    SELECT
      (SELECT count(*)::int FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'schools'
          AND column_name = 'billing_account_request_id') AS columns,
      (SELECT count(*)::int FROM pg_indexes
        WHERE indexname = 'schools_billing_account_request_unique_idx') AS indexes,
      (SELECT count(*)::int FROM schools) AS schools
  `);
  console.log({ applied: apply, ...result.rows[0] });
} catch {
  await client.query("ROLLBACK").catch(() => undefined);
  console.error("School-billing migration failed; credentials omitted");
  process.exitCode = 1;
} finally {
  await client.end();
}
