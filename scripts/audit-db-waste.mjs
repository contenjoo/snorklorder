import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

function loadEnv() {
  const env = {};
  const lines = readFileSync(".env.local", "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    env[line.slice(0, index)] = line.slice(index + 1).replace(/^"|"$/g, "");
  }
  return env;
}

const env = loadEnv();
const sql = neon(env.DATABASE_URL);

const tableSizes = await sql.query(`
  SELECT
    relname,
    n_live_tup,
    n_dead_tup,
    pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
    pg_size_pretty(pg_relation_size(relid)) AS table_size,
    pg_size_pretty(pg_indexes_size(relid)) AS index_size
  FROM pg_stat_user_tables
  ORDER BY pg_total_relation_size(relid) DESC
`);

const indexes = await sql.query(`
  SELECT
    relname AS table_name,
    indexrelname AS index_name,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
    idx_scan
  FROM pg_stat_user_indexes
  ORDER BY pg_relation_size(indexrelid) DESC, indexrelname
`);

const sameSchoolDuplicates = await sql.query(`
  SELECT school_id, email, count(*)::int AS count
  FROM teachers
  GROUP BY school_id, email
  HAVING count(*) > 1
  ORDER BY count DESC, email
`);

const accountOptionalColumns = await sql.query(`
  SELECT
    count(*)::int AS total,
    count(*) FILTER (WHERE old_email IS NULL OR old_email = $1)::int AS old_email_empty,
    count(*) FILTER (WHERE from_type IS NULL OR from_type = $1)::int AS from_type_empty,
    count(*) FILTER (WHERE extension_date IS NULL OR extension_date = $1)::int AS extension_date_empty,
    count(*) FILTER (WHERE invoice_number IS NULL OR invoice_number = $1)::int AS invoice_number_empty,
    count(*) FILTER (WHERE payment_link IS NULL OR payment_link = $1)::int AS payment_link_empty,
    count(*) FILTER (WHERE confirm_token IS NULL OR confirm_token = $1)::int AS confirm_token_empty
  FROM account_requests
`, [""]);

const oldBatches = await sql.query(`
  SELECT
    status,
    count(*)::int AS count,
    min(created_at) AS oldest,
    max(created_at) AS newest
  FROM upgrade_batches
  GROUP BY status
  ORDER BY status
`);

console.log("TABLE_SIZES");
console.table(tableSizes);
console.log("INDEXES");
console.table(indexes);
console.log("TEACHER_DUPLICATES_SAME_SCHOOL");
console.table(sameSchoolDuplicates);
console.log("ACCOUNT_OPTIONAL_COLUMNS");
console.table(accountOptionalColumns);
console.log("UPGRADE_BATCH_STATUS");
console.table(oldBatches);
