export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { teachers, schools } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { checkRateLimit, createRateLimitResponse, isValidEmail, normalizeText } from "@/lib/security";

export async function POST(req: NextRequest) {
  const rateLimit = checkRateLimit({
    request: req,
    key: "public-register",
    limit: 12,
    windowMs: 10 * 60 * 1000,
  });

  if (!rateLimit.ok) {
    return createRateLimitResponse("Too many registration attempts. Please try again later.", rateLimit.retryAfter);
  }

  const body = await req.json();
  const { schoolCode, name, email, subject } = body;

  if (!schoolCode || !name || !email) {
    return NextResponse.json(
      { error: "School code, name, and email are required" },
      { status: 400 }
    );
  }

  const normalizedName = normalizeText(name, 80);
  const normalizedEmail = normalizeText(email, 254).toLowerCase();
  const normalizedSubject = typeof subject === "string" ? normalizeText(subject, 80) : null;

  if (!normalizedName || !isValidEmail(normalizedEmail)) {
    return NextResponse.json({ error: "Invalid name or email" }, { status: 400 });
  }

  const [school] = await db
    .select()
    .from(schools)
    .where(eq(schools.code, schoolCode.toUpperCase()));

  if (!school) {
    return NextResponse.json({ error: "Invalid school code" }, { status: 404 });
  }

  // Check duplicate
  const existing = await db
    .select()
    .from(teachers)
    .where(
      and(
        eq(teachers.schoolId, school.id),
        eq(teachers.email, normalizedEmail)
      )
    );

  if (existing.length > 0) {
    return NextResponse.json(
      { error: "This email is already registered for this school" },
      { status: 409 }
    );
  }

  const [teacher] = await db
    .insert(teachers)
    .values({
      schoolId: school.id,
      name: normalizedName,
      email: normalizedEmail,
      subject: normalizedSubject,
      status: "pending",
    })
    .returning();

  return NextResponse.json({
    success: true,
    schoolName: school.name,
  });
}
