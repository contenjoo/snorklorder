import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });
const sql = neon(process.env.DATABASE_URL);
const rows = await sql`SELECT id, school_name, applicant_type, status, created_at FROM account_requests ORDER BY created_at DESC LIMIT 10`;
console.log(`total recent: ${rows.length}`);
for (const r of rows) console.log(`  #${r.id} [${r.applicant_type}] ${r.school_name} — ${r.status} @ ${r.created_at}`);
const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM account_requests`;
console.log(`TOTAL rows: ${count}`);
