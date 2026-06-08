-- 0011: 학교 관리자 + 교사 검증 파이프라인 (추가 전용, 무중단)
-- 목표1: 학교 관리자 현황 대시보드 / 목표2: 거짓 등록 3계층 방지

-- M5: schools 다중 도메인
ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "allowed_domains" text;

-- M2: teachers 검증 컬럼
ALTER TABLE "teachers" ADD COLUMN IF NOT EXISTS "verification_status" text DEFAULT 'unverified' NOT NULL;
ALTER TABLE "teachers" ADD COLUMN IF NOT EXISTS "email_verified_at" timestamp;
ALTER TABLE "teachers" ADD COLUMN IF NOT EXISTS "approved_at" timestamp;
ALTER TABLE "teachers" ADD COLUMN IF NOT EXISTS "approved_by" text;
ALTER TABLE "teachers" ADD COLUMN IF NOT EXISTS "rejected_reason" text;
ALTER TABLE "teachers" ADD COLUMN IF NOT EXISTS "escalated_at" timestamp;

-- 백필: 기존 교사는 모두 승인 상태로 (새 게이트가 기존 교사를 막지 않도록)
UPDATE "teachers"
SET "verification_status" = 'approved',
    "email_verified_at" = "created_at",
    "approved_at" = "created_at",
    "approved_by" = 'legacy'
WHERE "verification_status" = 'unverified';

CREATE INDEX IF NOT EXISTS "teachers_school_vstatus_idx" ON "teachers" ("school_id","verification_status");

-- M1: 학교 관리자
CREATE TABLE IF NOT EXISTS "school_admins" (
  "id" serial PRIMARY KEY NOT NULL,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "email" text NOT NULL,
  "role" text DEFAULT 'admin' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "school_admins_email_idx" ON "school_admins" ("email");
CREATE UNIQUE INDEX IF NOT EXISTS "school_admins_school_email_unique_idx" ON "school_admins" ("school_id","email");

-- M3: 교사 이메일 검증 토큰
CREATE TABLE IF NOT EXISTS "email_verification_tokens" (
  "id" serial PRIMARY KEY NOT NULL,
  "teacher_id" integer NOT NULL REFERENCES "teachers"("id"),
  "code" text NOT NULL,
  "token" text NOT NULL UNIQUE,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "email_verification_tokens_teacher_idx" ON "email_verification_tokens" ("teacher_id");
CREATE INDEX IF NOT EXISTS "email_verification_tokens_token_idx" ON "email_verification_tokens" ("token");

-- M4: 학교 관리자 로그인 토큰
CREATE TABLE IF NOT EXISTS "school_login_tokens" (
  "id" serial PRIMARY KEY NOT NULL,
  "email" text NOT NULL,
  "school_id" integer NOT NULL REFERENCES "schools"("id"),
  "token" text NOT NULL UNIQUE,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "school_login_tokens_token_idx" ON "school_login_tokens" ("token");
