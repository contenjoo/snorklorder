import pg from "pg";
import { readFileSync } from "node:fs";
import { loadProcessingSettings } from "./processing-mail-env.mjs";

const args = process.argv.slice(2);
const envIndex = args.indexOf("--env-file");
if (envIndex >= 0) loadProcessingSettings(args[envIndex + 1]);
const apply = args.includes("--apply");
if (!process.env.DATABASE_URL || (apply && process.env.SCHOOL_REQUEST_INVOICE_MIGRATION_APPLY !== "confirmed")) {
  throw new Error("Explicit database and school-request invoice migration authorization required");
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const expected = await client.query("SELECT to_regclass('public.school_requests') IS NOT NULL AS valid");
  if (!expected.rows[0].valid) throw new Error("Unexpected database");
  if (apply) {
    await client.query("BEGIN");
    await client.query(readFileSync(new URL("../drizzle/0022_school_request_invoice.sql", import.meta.url), "utf8"));
    await client.query("COMMIT");
  }
  const result = await client.query(`
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'school_requests' AND column_name = 'account_request_id'
      ) AS account_request_id,
      to_regclass('public.school_requests_account_request_unique_idx') IS NOT NULL AS unique_index
  `);
  console.log({ applied: apply, ...result.rows[0] });
} catch {
  await client.query("ROLLBACK").catch(() => undefined);
  console.error("School request invoice migration failed; credentials omitted");
  process.exitCode = 1;
} finally {
  await client.end();
}
