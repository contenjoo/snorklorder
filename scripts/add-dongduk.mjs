import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });

const sql = neon(process.env.DATABASE_URL);

const TEACHERS = [
  ["Youngmi Shin", "ymshin@sonline20.sen.go.kr"],
  ["barcamoral", "barcamoral@sonline20.sen.go.kr"],
  ["bolddaek", "bolddaek@sonline20.sen.go.kr"],
  ["bradsin119", "bradsin119@sonline20.sen.go.kr"],
  ["choizarr", "choizarr@sonline20.sen.go.kr"],
  ["ethicscap", "ethicscap@sonline20.sen.go.kr"],
  ["everflavor", "everflavor@sonline20.sen.go.kr"],
  ["hbjclass", "hbjclass@sonline20.sen.go.kr"],
  ["heesung0128", "heesung0128@sonline20.sen.go.kr"],
  ["hjkw0707", "hjkw0707@sonline20.sen.go.kr"],
  ["kijomi90", "kijomi90@sonline20.sen.go.kr"],
  ["myeongwon007", "myeongwon007@sonline20.sen.go.kr"],
  ["qtbbo", "qtbbo@sonline20.sen.go.kr"],
  ["rladuswn2", "rladuswn2@sonline20.sen.go.kr"],
  ["ssetcysm", "ssetcysm@sonline20.sen.go.kr"],
  ["teach", "teach@senedu.kr"],
  ["theprocess", "theprocess@sonline20.sen.go.kr"],
  ["unite23", "unite23@sonline20.sen.go.kr"],
  ["wbpark3355", "wbpark3355@sonline20.sen.go.kr"],
  ["wildberry912", "wildberry912@sonline20.sen.go.kr"],
  ["yoonjw823", "yoonjw823@sonline20.sen.go.kr"],
];

// 1) Insert school (or get existing)
let [school] = await sql`SELECT id, name, code FROM schools WHERE code = 'DONGDUKGIRLS'`;
if (!school) {
  [school] = await sql`
    INSERT INTO schools (name, name_en, code, region, team, domain)
    VALUES ('동덕여자고등학교', 'Dongduk Girls'' High School', 'DONGDUKGIRLS', '서울', NULL, 'sonline20.sen.go.kr')
    RETURNING id, name, code
  `;
  console.log("✓ school created:", school);
} else {
  console.log("• school exists:", school);
}

// 2) Insert teachers (skip existing by email+school)
let added = 0, skipped = 0;
for (const [name, email] of TEACHERS) {
  const existing = await sql`SELECT id FROM teachers WHERE email = ${email} AND school_id = ${school.id}`;
  if (existing.length > 0) { skipped++; continue; }
  await sql`INSERT INTO teachers (school_id, name, email, status) VALUES (${school.id}, ${name}, ${email}, 'pending')`;
  added++;
}
console.log(`✓ teachers — added: ${added}, skipped (already exist): ${skipped}`);

// 3) Verify
const all = await sql`SELECT id, name, email FROM teachers WHERE school_id = ${school.id} ORDER BY id`;
console.log(`total teachers for ${school.name}: ${all.length}`);
