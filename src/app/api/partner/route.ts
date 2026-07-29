export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { schools, teachers, accountRequests, domainRequests } from "@/db/schema";
import { desc, inArray } from "drizzle-orm";

// GET: partner dashboard data
export async function GET() {
  const [schoolRows, teacherRows, acctRows, domRows] = await Promise.all([
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
    db
      .select({
        id: accountRequests.id,
        schoolName: accountRequests.schoolName,
        schoolNameEn: accountRequests.schoolNameEn,
        type: accountRequests.type,
        emails: accountRequests.emails,
        status: accountRequests.status,
        invoiceNumber: accountRequests.invoiceNumber,
        invoiceAmount: accountRequests.invoiceAmount,
        createdAt: accountRequests.createdAt,
        updatedAt: accountRequests.updatedAt,
      })
      .from(accountRequests)
      .where(inArray(accountRequests.status, ["sent", "processed", "invoiced"]))
      .orderBy(desc(accountRequests.updatedAt)),
    db
      .select({
        id: domainRequests.id,
        schoolName: domainRequests.schoolName,
        schoolNameEn: domainRequests.schoolNameEn,
        domain: domainRequests.domain,
        team: domainRequests.team,
        status: domainRequests.status,
        invoiceNumber: domainRequests.invoiceNumber,
        invoiceAmount: domainRequests.invoiceAmount,
        createdAt: domainRequests.createdAt,
        updatedAt: domainRequests.updatedAt,
      })
      .from(domainRequests)
      .where(inArray(domainRequests.status, ["pending", "done", "invoiced"]))
      .orderBy(desc(domainRequests.updatedAt)),
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

  return NextResponse.json({ schools: result, accountRequests: acctRows, domainRequests: domRows });
}

// PATCH: Jon/Cailie marks teachers as upgraded
export async function PATCH(req: NextRequest) {
  // Check role — only Jon or Cailie can upgrade
  const cookie = req.cookies.get("snorkl-partner-auth");
  if (cookie?.value !== "jon" && cookie?.value !== "cailie") {
    return NextResponse.json({ error: "Only Jon or Cailie can mark upgrades" }, { status: 403 });
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
