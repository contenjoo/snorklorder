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

function getArg(name, fallback) {
  const match = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!match) return fallback;
  return match.slice(name.length + 3);
}

const retentionDays = Number(getArg("days", "90"));
const apply = process.argv.includes("--apply");

if (!Number.isFinite(retentionDays) || retentionDays < 1) {
  throw new Error("--days must be a positive number");
}

const env = loadEnv();
const sql = neon(env.DATABASE_URL);

const candidates = await sql.query(`
  SELECT
    id,
    status,
    created_at,
    confirmed_at,
    json_array_length(teacher_ids::json)::int AS teacher_count,
    CASE
      WHEN confirmed_ids IS NULL THEN 0
      ELSE json_array_length(confirmed_ids::json)::int
    END AS confirmed_count
  FROM upgrade_batches
  WHERE status = 'confirmed'
    AND confirmed_at IS NOT NULL
    AND confirmed_at < now() - ($1::int * interval '1 day')
  ORDER BY confirmed_at
`, [retentionDays]);

console.log(`${apply ? "APPLY" : "DRY RUN"}: confirmed upgrade batches older than ${retentionDays} days`);
console.table(candidates);

if (!apply || candidates.length === 0) {
  console.log(apply ? "No rows deleted." : "No changes made. Add --apply to delete these rows.");
  process.exit(0);
}

const ids = candidates.map((row) => row.id);
const deleted = await sql.query(`
  DELETE FROM upgrade_batches
  WHERE id = ANY($1)
  RETURNING id
`, [ids]);

console.log(`Deleted ${deleted.length} upgrade_batches rows.`);
