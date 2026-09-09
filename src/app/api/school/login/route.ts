import { randomBytes, createHash } from "node:crypto";
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { schoolAdmins, schools } from "@/db/schema";
import { eq } from "drizzle-orm";
import { checkRateLimit, createRateLimitResponse, isValidEmail, normalizeText, checkEmailSendLimit } from "@/lib/security";
import { createSchoolLoginToken } from "@/lib/school-auth";
import { sendSchoolLoginEmail } from "@/lib/verification-email";

// POST: 학교 관리자 매직 링크 요청 (public, no account enumeration)
export async function POST(req: NextRequest) {
  const rateLimit = await checkRateLimit({
    request: req,
    key: "school-login",
    limit: 6,
    windowMs: 10 * 60 * 1000,
  });

  if (!rateLimit.ok) {
    return createRateLimitResponse("Too many login requests. Please try again later.", rateLimit.retryAfter);
  }

  const body = await req.json().catch(()=>null);
  if (typeof body?.email !== "string") return NextResponse.json({error:"Invalid email"},{status:400});
  const { email } = body;
  const normalizedEmail = normalizeText(email ?? "", 254).toLowerCase();

  if (!isValidEmail(normalizedEmail)) {
    // Do not reveal whether the email is valid / registered.
    return NextResponse.json({ ok: true });
  }

  const limited = await checkEmailSendLimit(req, normalizedEmail); if (limited) return limited;
  const intent = randomBytes(32).toString("hex");
  const browserHash = createHash("sha256").update(intent).digest("hex");
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
    const token = await createSchoolLoginToken(normalizedEmail, row.schoolId, browserHash);
    links.push({ schoolName: row.schoolName, schoolNameEn: row.schoolNameEn, token });
  }

  if (links.length > 0) {
    await sendSchoolLoginEmail({ email: normalizedEmail, links });
  }

  const response=NextResponse.json({ok:true});
  response.cookies.set("snorkl-login-intent",intent,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict",maxAge:1800,path:"/"});
  return response;
}
