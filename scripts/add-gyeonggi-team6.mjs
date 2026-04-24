import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });

const sql = neon(process.env.DATABASE_URL);

// 경기 6팀 — MARKET GroupPurchaseTeam cmo7xsmkk000104jmw8eykpqb
// '경기도교육청' 등록은 실제 소속인 '경기도자동차과학고등학교'로 등록
const ENTRIES = [
  { code: "GGAUTOSCI", name: "경기도자동차과학고등학교", nameEn: "Gyeonggi Automotive Science High School", domain: null,       teacher: "허영주", email: "whatisaid85@gmail.com" },
  { code: "WIRYEMS",   name: "위례중학교",               nameEn: "Wirye Middle School",                   domain: null,       teacher: "장경임", email: "light9866@naver.com" },
  { code: "CHODANGHS", name: "초당고등학교",             nameEn: "Chodang High School",                   domain: null,       teacher: "권의선", email: "kesiawase@gmail.com" },
  { code: "MOGAM",     name: "목암중학교",               nameEn: "Mogam Middle School",                   domain: null,       teacher: "박희원", email: "fadeout00@gmail.com" },
  { code: "NAECHON",   name: "내촌중학교",               nameEn: "Naechon Middle School",                 domain: "goedu.kr", teacher: "송병찬", email: "sbc1151@goedu.kr" },
];

let addedSchools = 0, skippedSchools = 0, addedTeachers = 0, skippedTeachers = 0;

for (const e of ENTRIES) {
  let [school] = await sql`SELECT id, name, code FROM schools WHERE code = ${e.code}`;
  if (!school) {
    [school] = await sql`
      INSERT INTO schools (name, name_en, code, region, team, domain)
      VALUES (${e.name}, ${e.nameEn}, ${e.code}, '경기', '경기6팀', ${e.domain})
      RETURNING id, name, code
    `;
    addedSchools++;
    console.log("✓ school created:", school);
  } else {
    skippedSchools++;
    console.log("• school exists:", school);
  }

  const existing = await sql`SELECT id FROM teachers WHERE email = ${e.email} AND school_id = ${school.id}`;
  if (existing.length > 0) {
    skippedTeachers++;
    continue;
  }
  await sql`INSERT INTO teachers (school_id, name, email, status) VALUES (${school.id}, ${e.teacher}, ${e.email}, 'pending')`;
  addedTeachers++;
}

console.log(`\n✓ schools — added: ${addedSchools}, skipped: ${skippedSchools}`);
console.log(`✓ teachers — added: ${addedTeachers}, skipped: ${skippedTeachers}`);

// Verify
const team6 = await sql`
  SELECT s.id, s.name, s.name_en, s.code, s.team, t.name AS teacher, t.email
  FROM schools s
  LEFT JOIN teachers t ON t.school_id = s.id
  WHERE s.team = '경기6팀'
  ORDER BY s.id
`;
console.log(`\n경기6팀 final (${team6.length} rows):`);
console.table(team6);
