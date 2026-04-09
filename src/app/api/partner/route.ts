export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { schools, teachers } from "@/db/schema";
import { desc, inArray } from "drizzle-orm";

// GET: partner dashboard data
export async function GET() {
  const [schoolRows, teacherRows] = await Promise.all([
    db
      .select({
        id: schools.id,
        name: schools.name,
        nameEn: schools.nameEn,
        code: schools.code,
        region: schools.region,
        team: schools.team,
      })
      .from(schools)
      .orderBy(schools.name),
    db
      .select({
        id: teachers.id,
        schoolId: teachers.schoolId,
        name: teachers.name,
        email: teachers.email,
        subject: teachers.subject,
        status: teachers.status,
        createdAt: teachers.createdAt,
      })
      .from(teachers)
      .orderBy(desc(teachers.createdAt)),
  ]);

  const teachersBySchool = new Map<number, typeof teacherRows>();
  for (const t of teacherRows) {
    if (!teachersBySchool.has(t.schoolId)) teachersBySchool.set(t.schoolId, []);
    teachersBySchool.get(t.schoolId)!.push(t);
  }

  const result = schoolRows.map((s) => {
    const tcs = teachersBySchool.get(s.id) || [];
    return {
      ...s,
      teachers: tcs,
      counts: {
        total: tcs.length,
        pending: tcs.filter((t) => t.status === "pending").length,
        sent: tcs.filter((t) => t.status === "sent").length,
        upgraded: tcs.filter((t) => t.status === "upgraded").length,
      },
    };
  });

  return NextResponse.json(result);
}

// PATCH: Jon marks teachers as upgraded
export async function PATCH(req: NextRequest) {
  // Check role — only Jon can upgrade
  const cookie = req.cookies.get("snorkl-partner-auth");
  if (cookie?.value !== "jon") {
    return NextResponse.json({ error: "Only Jon can mark upgrades" }, { status: 403 });
  }

  const body = await req.json();
  const { ids } = body;

  if (!ids?.length) {
    return NextResponse.json({ error: "Teacher IDs required" }, { status: 400 });
  }

  await db
    .update(teachers)
    .set({ status: "upgraded" })
    .where(inArray(teachers.id, ids));

  return NextResponse.json({ success: true, upgraded: ids.length });
}
