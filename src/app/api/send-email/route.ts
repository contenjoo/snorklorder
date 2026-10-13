import { checkAuth } from "@/lib/auth";
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { teachers, schools, upgradeBatches } from "@/db/schema";
import { eq, inArray, and } from "drizzle-orm";
import { randomBytes } from "crypto";

export async function POST(req: NextRequest) {
  if (!(await checkAuth())) return NextResponse.json({error:"Unauthorized"},{status:401});
  try {
  const body = await req.json().catch(()=>null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({error:"Invalid JSON"},{status:400});
  const { teacherIds } = body;

  if (!teacherIds?.length) {
    return NextResponse.json({ error: "No teachers selected" }, { status: 400 });
  }

  // Fetch selected teachers with school info
  const selected = await db
    .select({
      id: teachers.id,
      name: teachers.name,
      email: teachers.email,
      subject: teachers.subject,
      schoolId: teachers.schoolId,
      schoolName: schools.name,
      schoolNameEn: schools.nameEn,
      schoolTeam: schools.team,
    })
    .from(teachers)
    .innerJoin(schools, eq(teachers.schoolId, schools.id))
    // 방어: 검증·승인 완료(approved)된 교사만 Jon에게 발송
    .where(and(inArray(teachers.id, teacherIds), eq(teachers.verificationStatus, "approved")));

  if (selected.length === 0) {
    return NextResponse.json({ success: false, error: "No approved teachers in selection" }, { status: 400 });
  }
  // 실제 발송 대상 = 승인된 교사만 (미승인 id는 무시)
  const approvedIds = selected.map((t) => t.id);

  // 배치 기록 (관리자 대시보드 이력용, 승인된 교사만 대상)
  const token = randomBytes(16).toString("hex");
  await db.insert(upgradeBatches).values({
    token,
    teacherIds: JSON.stringify(approvedIds),
  });

  // Jon 에게 메일을 보내지 않는다 — sent 로 바꾸면 본사 화면(/partner Action Needed)에 올라가고,
  // 하루 1통 알림(cron/hq-daily-nudge)으로 새 건을 알린다.
  await db
    .update(teachers)
    .set({ status: "sent", notifiedAt: new Date() })
    .where(and(inArray(teachers.id, approvedIds), eq(teachers.status, "pending")));

  return NextResponse.json({ success: true, posted: approvedIds.length, token });
  } catch (err) {
    console.error("[/api/send-email] failed:", err);
    return NextResponse.json({ success: false, error: "Request failed" }, { status: 500 });
  }
}
