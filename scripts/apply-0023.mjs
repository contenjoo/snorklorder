import pg from "pg";
import { readFileSync } from "node:fs";
import { loadProcessingSettings } from "./processing-mail-env.mjs";

const args = process.argv.slice(2);
const envIndex = args.indexOf("--env-file");
if (envIndex >= 0) loadProcessingSettings(args[envIndex + 1]);
const apply = args.includes("--apply");
if (!process.env.DATABASE_URL || (apply && process.env.CONFIRM_SCOPE_MIGRATION_APPLY !== "confirmed")) {
  throw new Error("Explicit database and confirm-scope migration authorization required");
}

// The scope check's same-school branch must require an approved teacher.
const SCOPE_MARKER = "t.status IN ('pending','sent') AND t.verification_status='approved'";
const DEFINITION_QUERY = `
  SELECT
    to_regprocedure('public.confirm_teacher_batch(text,integer[])') IS NOT NULL AS confirm_function,
    coalesce(position($1 IN pg_get_functiondef(to_regprocedure('public.confirm_teacher_batch(text,integer[])'))) > 0, false) AS requires_approved
`;

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const expected = await client.query("SELECT to_regclass('public.upgrade_batches') IS NOT NULL AND to_regclass('public.teachers') IS NOT NULL AS valid");
  if (!expected.rows[0].valid) throw new Error("Unexpected database");
  if (apply) {
    await client.query("BEGIN");
    await client.query(readFileSync(new URL("../drizzle/0023_confirm_requires_approved.sql", import.meta.url), "utf8"));
    const inTx = await client.query(DEFINITION_QUERY, [SCOPE_MARKER]);
    if (!inTx.rows[0].confirm_function || !inTx.rows[0].requires_approved) throw new Error("Verification failed");
    await client.query("COMMIT");
  }
  const result = await client.query(DEFINITION_QUERY, [SCOPE_MARKER]);
  console.log({ applied: apply, ...result.rows[0] });
  if (apply && !(result.rows[0].confirm_function && result.rows[0].requires_approved)) process.exitCode = 1;
} catch {
  await client.query("ROLLBACK").catch(() => undefined);
  console.error("Confirm-scope migration failed; credentials omitted");
  process.exitCode = 1;
} finally {
  await client.end();
}
