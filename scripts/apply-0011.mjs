// 0011 전용 명시적 마이그레이션 적용기 (범용 splitter 아님 — 문장을 직접 나열)
import { neon } from "@neondatabase/serverless";
import fs from "fs";

const env = fs.readFileSync(".env.local", "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, "");
const sql = neon(url);

// 적용 순서대로 명시 (IF NOT EXISTS 라 재실행 안전)
const statements = [
  `ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "allowed_domains" text`,
  `ALTER TABLE "teachers" ADD COLUMN IF NOT EXISTS "verification_status" text DEFAULT 'unverified' NOT NULL`,
  `ALTER TABLE "teachers" ADD COLUMN IF NOT EXISTS "email_verified_at" timestamp`,
  `ALTER TABLE "teachers" ADD COLUMN IF NOT EXISTS "approved_at" timestamp`,
  `ALTER TABLE "teachers" ADD COLUMN IF NOT EXISTS "approved_by" text`,
  `ALTER TABLE "teachers" ADD COLUMN IF NOT EXISTS "rejected_reason" text`,
  `ALTER TABLE "teachers" ADD COLUMN IF NOT EXISTS "escalated_at" timestamp`,
  `UPDATE "teachers" SET "verification_status"='approved', "email_verified_at"="created_at", "approved_at"="created_at", "approved_by"='legacy' WHERE "verification_status"='unverified'`,
  `CREATE INDEX IF NOT EXISTS "teachers_school_vstatus_idx" ON "teachers" ("school_id","verification_status")`,
  `CREATE TABLE IF NOT EXISTS "school_admins" ("id" serial PRIMARY KEY NOT NULL, "school_id" integer NOT NULL REFERENCES "schools"("id"), "email" text NOT NULL, "role" text DEFAULT 'admin' NOT NULL, "created_at" timestamp DEFAULT now() NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS "school_admins_email_idx" ON "school_admins" ("email")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "school_admins_school_email_unique_idx" ON "school_admins" ("school_id","email")`,
  `CREATE TABLE IF NOT EXISTS "email_verification_tokens" ("id" serial PRIMARY KEY NOT NULL, "teacher_id" integer NOT NULL REFERENCES "teachers"("id"), "code" text NOT NULL, "token" text NOT NULL UNIQUE, "expires_at" timestamp NOT NULL, "used_at" timestamp, "created_at" timestamp DEFAULT now() NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS "email_verification_tokens_teacher_idx" ON "email_verification_tokens" ("teacher_id")`,
  `CREATE INDEX IF NOT EXISTS "email_verification_tokens_token_idx" ON "email_verification_tokens" ("token")`,
  `CREATE TABLE IF NOT EXISTS "school_login_tokens" ("id" serial PRIMARY KEY NOT NULL, "email" text NOT NULL, "school_id" integer NOT NULL REFERENCES "schools"("id"), "token" text NOT NULL UNIQUE, "expires_at" timestamp NOT NULL, "used_at" timestamp, "created_at" timestamp DEFAULT now() NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS "school_login_tokens_token_idx" ON "school_login_tokens" ("token")`,
];

// 사전 카운트 (백필 영향 확인용)
const before = (await sql.query(`SELECT count(*)::int c FROM teachers`))[0].c;
const beforeUnverified = (await sql.query(`SELECT count(*)::int c FROM teachers WHERE verification_status IS NULL`).catch(() => [{ c: "n/a(col없음)" }]))[0].c;
console.log(`[before] teachers total=${before}, verification_status NULL=${beforeUnverified}`);

let i = 0;
for (const s of statements) {
  i++;
  await sql.query(s);
  console.log(`  ✓ [${i}/${statements.length}] ${s.slice(0, 70)}...`);
}

console.log("\n=== 검증 ===");
// 1) teachers 컬럼 확인
const tcols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='teachers' ORDER BY ordinal_position`;
console.log("teachers cols:", tcols.map(c => c.column_name).join(", "));
// 2) 백필 결과: unverified 가 0 이어야 함, 전부 approved=legacy
const vdist = await sql`SELECT verification_status, count(*)::int c FROM teachers GROUP BY verification_status ORDER BY c DESC`;
console.log("verification_status 분포:", vdist.map(r => `${r.verification_status}=${r.c}`).join(", "));
const after = (await sql.query(`SELECT count(*)::int c FROM teachers`))[0].c;
console.log(`teachers total: before=${before} after=${after} (동일해야 함: ${before === after ? "OK" : "MISMATCH!"})`);
// 3) 신규 테이블 확인
const tbls = await sql`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('school_admins','email_verification_tokens','school_login_tokens') ORDER BY tablename`;
console.log("신규 테이블:", tbls.map(t => t.tablename).join(", "), tbls.length === 3 ? "(3/3 OK)" : "(누락!)");
// 4) schools.allowed_domains
const scol = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='schools' AND column_name='allowed_domains'`;
console.log("schools.allowed_domains:", scol.length === 1 ? "OK" : "누락!");
// 5) 인덱스
const idx = await sql`SELECT indexname FROM pg_indexes WHERE indexname IN ('teachers_school_vstatus_idx','school_admins_email_idx','school_admins_school_email_unique_idx','email_verification_tokens_token_idx','school_login_tokens_token_idx') ORDER BY indexname`;
console.log("인덱스:", idx.map(r => r.indexname).join(", "), `(${idx.length}/5)`);
console.log("\n적용 완료.");
