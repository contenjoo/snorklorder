export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { schoolAdmins, schools } from "@/db/schema";
import { eq } from "drizzle-orm";
import { checkRateLimit, createRateLimitResponse, isValidEmail, normalizeText } from "@/lib/security";
import { createSchoolLoginToken } from "@/lib/school-auth";
import { sendSchoolLoginEmail } from "@/lib/verification-email";

// POST: 학교 관리자 매직 링크 요청 (public, no account enumeration)
export async function POST(req: NextRequest) {
  const rateLimit = checkRateLimit({
    request: req,
    key: "school-login",
    limit: 6,
    windowMs: 10 * 60 * 1000,
  });

  if (!rateLimit.ok) {
    return createRateLimitResponse("Too many login requests. Please try again later.", rateLimit.retryAfter);
  }

  const { email } = await req.json();
  const normalizedEmail = normalizeText(email ?? "", 254).toLowerCase();

  if (!isValidEmail(normalizedEmail)) {
    // Do not reveal whether the email is valid / registered.
    return NextResponse.json({ ok: true });
  }

  const rows = await db
    .select({
      schoolId: schoolAdmins.schoolId,
      schoolName: schools.name,
      schoolNameEn: schools.nameEn,
    })
    .from(schoolAdmins)
    .innerJoin(schools, eq(schoolAdmins.schoolId, schools.id))
    .where(eq(schoolAdmins.email, normalizedEmail));

  const links: { schoolName: string; schoolNameEn?: string | null; token: string }[] = [];
  for (const row of rows) {
    const token = await createSchoolLoginToken(normalizedEmail, row.schoolId);
    links.push({ schoolName: row.schoolName, schoolNameEn: row.schoolNameEn, token });
  }

  if (links.length > 0) {
    await sendSchoolLoginEmail({ email: normalizedEmail, links });
  }

  return NextResponse.json({ ok: true });
}
