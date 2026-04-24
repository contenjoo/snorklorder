export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { teachers, schools, upgradeBatches } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { sendBatchNotification } from "@/lib/email";
import { randomBytes } from "crypto";

export async function POST(req: NextRequest) {
  const body = await req.json();
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
    .where(inArray(teachers.id, teacherIds));

  // Group by school
  const grouped = new Map<number, { schoolName: string; schoolNameEn?: string; team?: string; teachers: typeof selected }>();
  for (const t of selected) {
    if (!grouped.has(t.schoolId)) {
      grouped.set(t.schoolId, { schoolName: t.schoolName, schoolNameEn: t.schoolNameEn || undefined, team: t.schoolTeam || undefined, teachers: [] });
    }
    grouped.get(t.schoolId)!.teachers.push(t);
  }

  const groups = Array.from(grouped.values());

  // Fetch all schools in the same teams (for team summary in email)
  const teamNames = [...new Set(groups.map(g => g.team).filter(Boolean))] as string[];
  let teamSchoolsMap: Record<string, string[]> = {};
  if (teamNames.length > 0) {
    const allTeamSchools = await db
      .select({ name: schools.name, nameEn: schools.nameEn, team: schools.team })
      .from(schools)
      .where(inArray(schools.team, teamNames));
    for (const s of allTeamSchools) {
      if (!s.team) continue;
      if (!teamSchoolsMap[s.team]) teamSchoolsMap[s.team] = [];
      teamSchoolsMap[s.team].push(s.nameEn || s.name);
    }
  }

  // 배치 토큰 생성
  const token = randomBytes(16).toString("hex");
  await db.insert(upgradeBatches).values({
    token,
    teacherIds: JSON.stringify(teacherIds),
  });

  // Send batch email to Jon (with confirm link + team school map)
  const result = await sendBatchNotification(groups, token, teamSchoolsMap);

  if (result.success) {
    // Update status to 'sent'
    await db
      .update(teachers)
      .set({ status: "sent", notifiedAt: new Date() })
      .where(inArray(teachers.id, teacherIds));
  }

  return NextResponse.json({ ...result, token });
}
