import { eq } from "drizzle-orm";
import { db } from "@/db";
import { teachers, schools, schoolAdmins } from "@/db/schema";

// 큐 운영 상수
export const REMINDER_DAYS = 2; // 대기 N일 후 리마인더
export const ESCALATE_DAYS = 4; // 대기 X일 후 본사 이관

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
