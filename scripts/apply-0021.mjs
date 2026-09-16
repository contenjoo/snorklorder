import pg from "pg";
import { readFileSync } from "node:fs";
import { loadProcessingSettings } from "./processing-mail-env.mjs";

const args = process.argv.slice(2);
const envIndex = args.indexOf("--env-file");
if (envIndex >= 0) loadProcessingSettings(args[envIndex + 1]);
const apply = args.includes("--apply");
if (!process.env.DATABASE_URL || (apply && process.env.BILLING_CYCLES_MIGRATION_APPLY !== "confirmed")) {
  throw new Error("Explicit database and billing-cycle migration authorization required");
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const expected = await client.query("SELECT to_regclass('public.account_requests') IS NOT NULL AS valid");
  if (!expected.rows[0].valid) throw new Error("Unexpected database");
  if (apply) {
    await client.query("BEGIN");
    await client.query(readFileSync(new URL("../drizzle/0021_billing_cycles.sql", import.meta.url), "utf8"));
    await client.query("COMMIT");
  }
  const result = await client.query("SELECT to_regclass('public.billing_cycles') IS NOT NULL AS cycles, to_regclass('public.billing_cycle_items') IS NOT NULL AS items");
  console.log({ applied: apply, ...result.rows[0] });
} catch {
  await client.query("ROLLBACK").catch(() => undefined);
  console.error("Billing cycle migration failed; credentials omitted");
  process.exitCode = 1;
} finally {
  await client.end();
}
