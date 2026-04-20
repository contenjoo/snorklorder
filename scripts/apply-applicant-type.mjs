import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });
const sql = neon(process.env.DATABASE_URL);

await sql`ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS applicant_type text NOT NULL DEFAULT 'school'`;
console.log("✓ applicant_type column added");

const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM account_requests`;
console.log(`account_requests rows: ${count}`);
