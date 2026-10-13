import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { schools, teachers } from "@/db/schema";
import { sendConfirmNotification, sendTeacherUpgradedEmail } from "@/lib/email";

/**
 * 교사 업그레이드 확정 후 알림 — ① 관리자 알림 ② 교사 본인 완료 메일.
 * Jon 확인 링크(/confirm/[token])와 Jon 화면(/partner) 의 Mark as Upgraded 가 같이 쓴다.
 * 응답 뒤 after() 안에서 부른다.
 */
export async function notifyTeacherUpgrades(normalizedConfirmedIds: number[], confirmedAt: Date) {
  if (normalizedConfirmedIds.length === 0) return;
  try {
    const confirmedRows = await db
      .select({
        name: teachers.name,
        email: teachers.email,
        schoolName: schools.name,
        schoolNameEn: schools.nameEn,
        schoolTeam: schools.team,
      })
      .from(teachers)
      .innerJoin(schools, eq(teachers.schoolId, schools.id))
      .where(inArray(teachers.id, normalizedConfirmedIds));

    const bySchool = new Map<string, { name: string; nameEn: string | null; team: string | null; emails: string[] }>();
    for (const row of confirmedRows) {
      if (!bySchool.has(row.schoolName)) bySchool.set(row.schoolName, { name: row.schoolName, nameEn: row.schoolNameEn, team: row.schoolTeam, emails: [] });
      bySchool.get(row.schoolName)!.emails.push(row.email);
    }

    // Jon 확인 완료 시점: ① 관리자(나) 알림 ② 업그레이드된 교사 본인에게 완료 메일
    // 교사 메일은 한꺼번에 보내면 Gmail 421(레이트리밋)이 나므로 간격을 두고 순차 발송
    const [, failed] = await Promise.all([
      sendConfirmNotification({
        confirmedCount: normalizedConfirmedIds.length,
        schools: Array.from(bySchool.values()),
        confirmedAt,
      }),
      (async () => {
        let failedCount = 0;
        for (let i = 0; i < confirmedRows.length; i++) {
          const row = confirmedRows[i];
          try {
            const res = await sendTeacherUpgradedEmail({
              name: row.name,
              email: row.email,
              schoolName: row.schoolName,
              schoolNameEn: row.schoolNameEn,
            });
            if (!res.success && !res.skipped) failedCount++;
          } catch {
            failedCount++;
          }
          if (i < confirmedRows.length - 1) {
            await new Promise((r) => setTimeout(r, 400)); // 폭주 방지 간격
          }
        }
        return failedCount;
      })(),
    ]);
    if (failed > 0) console.warn(`[confirm] ${failed}/${confirmedRows.length} teacher emails failed`);
  } catch (err) {
    console.warn("[confirm] notification email failed:", err);
  }
}
