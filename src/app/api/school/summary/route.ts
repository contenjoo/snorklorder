export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { db } from "@/db";
import { teachers, schools, accountRequests } from "@/db/schema";
import { and, desc, eq, notInArray, or } from "drizzle-orm";
import { getSchoolSession } from "@/lib/school-auth";

export async function GET() {
  const schoolId = await getSchoolSession();
  if (schoolId == null) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [school] = await db
    .select()
    .from(schools)
    .where(eq(schools.id, schoolId))
    .limit(1);

  if (!school) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const teacherRows = await db
    .select({
      id: teachers.id,
      schoolId: teachers.schoolId,
      name: teachers.name,
      email: teachers.email,
      subject: teachers.subject,
      status: teachers.status,
      verificationStatus: teachers.verificationStatus,
      emailVerifiedAt: teachers.emailVerifiedAt,
      approvedAt: teachers.approvedAt,
      approvedBy: teachers.approvedBy,
      rejectedReason: teachers.rejectedReason,
      escalatedAt: teachers.escalatedAt,
      createdAt: teachers.createdAt,
    })
    .from(teachers)
    .where(eq(teachers.schoolId, schoolId))
    .orderBy(desc(teachers.createdAt));

  const counts = {
    total: teacherRows.length,
    unverified: 0,
    emailVerified: 0,
    approved: 0,
    rejected: 0,
    pending: 0,
    sent: 0,
    upgraded: 0,
  };

  for (const t of teacherRows) {
    switch (t.verificationStatus) {
      case "unverified":
        counts.unverified++;
        break;
      case "email_verified":
        counts.emailVerified++;
        break;
      case "approved":
        counts.approved++;
        break;
      case "rejected":
        counts.rejected++;
        break;
    }
    switch (t.status) {
      case "pending":
        counts.pending++;
        break;
      case "sent":
        counts.sent++;
        break;
      case "upgraded":
        counts.upgraded++;
        break;
    }
  }

  const queue = teacherRows.filter(
    (t) => t.verificationStatus === "email_verified"
  );

  const schoolNameConds = [
    eq(accountRequests.schoolName, school.name),
    school.nameEn
      ? eq(accountRequests.schoolNameEn, school.nameEn)
      : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const accountRequestRows = await db
    .select({
      id: accountRequests.id,
      schoolName: accountRequests.schoolName,
      schoolNameEn: accountRequests.schoolNameEn,
      emails: accountRequests.emails,
      status: accountRequests.status,
      quantity: accountRequests.quantity,
      type: accountRequests.type,
      createdAt: accountRequests.createdAt,
    })
    .from(accountRequests)
    .where(and(
      notInArray(accountRequests.marketVoidState, ["prepared", "voided"]),
      schoolNameConds.length > 1 ? or(...schoolNameConds) : schoolNameConds[0],
    ))
    .orderBy(desc(accountRequests.createdAt));

  return NextResponse.json({
    school: {
      id: school.id,
      name: school.name,
      nameEn: school.nameEn,
      code: school.code,
      team: school.team,
      domain: school.domain,
      allowedDomains: school.allowedDomains,
    },
    teachers: teacherRows,
    counts,
    queue,
    accountRequests: accountRequestRows,
  });
}
