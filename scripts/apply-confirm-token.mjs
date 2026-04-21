import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });
const sql = neon(process.env.DATABASE_URL);

await sql`ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS confirm_token text UNIQUE`;
await sql`ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS confirmed_at timestamp`;
console.log("✓ confirm_token + confirmed_at columns ensured");

// Verify
const cols = await sql`
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_name = 'account_requests' AND column_name IN ('confirm_token', 'confirmed_at')
  ORDER BY column_name
`;
console.log("verified columns:");
for (const c of cols) console.log(`  - ${c.column_name} ${c.data_type} nullable=${c.is_nullable}`);

const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM account_requests`;
console.log(`account_requests rows intact: ${count}`);
