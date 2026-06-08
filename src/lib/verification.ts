import { randomBytes, randomInt } from "crypto";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { teachers, schools, schoolAdmins, emailVerificationTokens } from "@/db/schema";

// 큐 운영 상수
export const REMINDER_DAYS = 2; // 대기 N일 후 리마인더
export const ESCALATE_DAYS = 4; // 대기 X일 후 본사 이관
export const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 매직링크/OTP 7일

export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function generateToken(): string {
  return randomBytes(24).toString("hex");
}

/** 교사용 검증 토큰(OTP+매직링크) 생성. 기존 미사용 토큰은 무효화하지 않고 새로 발급. */
export async function createTeacherVerification(
  teacherId: number
): Promise<{ code: string; token: string }> {
  const code = generateOtp();
  const token = generateToken();
  await db.insert(emailVerificationTokens).values({
    teacherId,
    code,
    token,
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
  });
  return { code, token };
}

/** 이메일 도메인이 학교 도메인(domain + allowed_domains)과 일치하는지 */
export function emailDomainMatches(
  email: string,
  school: { domain: string | null; allowedDomains: string | null }
): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain) return false;
  const allowed = [school.domain, ...(school.allowedDomains?.split(",") ?? [])]
    .map((d) => d?.trim().toLowerCase())
    .filter((d): d is string => !!d);
  return allowed.includes(domain);
}

/**
 * 이메일 소유가 증명된 뒤 승인 상태를 결정한다.
 * - 도메인 일치 → 즉시 approved (approvedBy='domain')
 * - 도메인 불일치 → email_verified (승인 큐). 학교에 관리자가 없으면 즉시 본사 큐로(escalatedAt=now).
 * 반환: 최종 verification_status
 */
export async function resolveApproval(
  teacherId: number,
  schoolId: number
): Promise<"approved" | "email_verified"> {
  const now = new Date();
  const [school] = await db
    .select({ domain: schools.domain, allowedDomains: schools.allowedDomains })
    .from(schools)
    .where(eq(schools.id, schoolId));
  const [teacher] = await db
    .select({ email: teachers.email })
    .from(teachers)
    .where(eq(teachers.id, teacherId));

  if (school && teacher && emailDomainMatches(teacher.email, school)) {
    await db
      .update(teachers)
      .set({ verificationStatus: "approved", approvedAt: now, approvedBy: "domain" })
      .where(eq(teachers.id, teacherId));
    return "approved";
  }

  // 도메인 불일치 → 승인 큐. 관리자 없는 학교는 처음부터 본사 큐.
  const admins = await db
    .select({ id: schoolAdmins.id })
    .from(schoolAdmins)
    .where(eq(schoolAdmins.schoolId, schoolId));
  await db
    .update(teachers)
    .set({ verificationStatus: "email_verified", escalatedAt: admins.length === 0 ? now : null })
    .where(eq(teachers.id, teacherId));
  return "email_verified";
}

/** 공통: 토큰 행을 사용처리하고 교사의 email_verified_at 세팅 후 승인판정 */
async function finalizeEmailVerified(teacherId: number, schoolId: number) {
  await db
    .update(teachers)
    .set({ emailVerifiedAt: new Date() })
    .where(eq(teachers.id, teacherId));
  return resolveApproval(teacherId, schoolId);
}

/** 매직링크(token)로 검증 */
export async function verifyTeacherByToken(
  token: string
): Promise<{ ok: boolean; teacherId?: number; status?: string; error?: string }> {
  const [row] = await db
    .select()
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.token, token));
  if (!row) return { ok: false, error: "invalid" };
  if (row.usedAt) return { ok: false, error: "used" };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, error: "expired" };

  const [teacher] = await db
    .select({ id: teachers.id, schoolId: teachers.schoolId, verificationStatus: teachers.verificationStatus })
    .from(teachers)
    .where(eq(teachers.id, row.teacherId));
  if (!teacher) return { ok: false, error: "invalid" };

  await db
    .update(emailVerificationTokens)
    .set({ usedAt: new Date() })
    .where(eq(emailVerificationTokens.id, row.id));

  // 이미 처리된 교사면 현 상태 반환 (멱등)
  if (teacher.verificationStatus !== "unverified") {
    return { ok: true, teacherId: teacher.id, status: teacher.verificationStatus };
  }
  const status = await finalizeEmailVerified(teacher.id, teacher.schoolId);
  return { ok: true, teacherId: teacher.id, status };
}

/** OTP 코드 + teacherId 로 검증 */
export async function verifyTeacherByCode(
  teacherId: number,
  code: string
): Promise<{ ok: boolean; status?: string; error?: string }> {
  const normalized = code.trim();
  const [row] = await db
    .select()
    .from(emailVerificationTokens)
    .where(and(eq(emailVerificationTokens.teacherId, teacherId), eq(emailVerificationTokens.code, normalized)));
  if (!row) return { ok: false, error: "invalid" };
  if (row.usedAt) return { ok: false, error: "used" };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, error: "expired" };

  const [teacher] = await db
    .select({ id: teachers.id, schoolId: teachers.schoolId, verificationStatus: teachers.verificationStatus })
    .from(teachers)
    .where(eq(teachers.id, teacherId));
  if (!teacher) return { ok: false, error: "invalid" };

  await db
    .update(emailVerificationTokens)
    .set({ usedAt: new Date() })
    .where(eq(emailVerificationTokens.id, row.id));

  if (teacher.verificationStatus !== "unverified") {
    return { ok: true, status: teacher.verificationStatus };
  }
  const status = await finalizeEmailVerified(teacher.id, teacher.schoolId);
  return { ok: true, status };
}
