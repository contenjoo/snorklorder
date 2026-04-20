import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });
const sql = neon(process.env.DATABASE_URL);
const [school] = await sql`SELECT id, name, code, region FROM schools WHERE code = 'DONGDUKGIRLS'`;
console.log("school:", school);
if (school) {
  const teachers = await sql`SELECT id, name, email, status FROM teachers WHERE school_id = ${school.id} ORDER BY id`;
  console.log(`teachers: ${teachers.length}`);
  for (const t of teachers) console.log(`  - ${t.name} <${t.email}>`);
}
