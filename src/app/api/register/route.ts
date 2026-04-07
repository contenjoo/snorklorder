export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { teachers, schools } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { sendTeacherNotification } from "@/lib/email";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { schoolCode, name, email, subject } = body;

  if (!schoolCode || !name || !email) {
    return NextResponse.json(
      { error: "School code, name, and email are required" },
      { status: 400 }
    );
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
        eq(teachers.email, email.toLowerCase().trim())
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
      name: name.trim(),
      email: email.toLowerCase().trim(),
      subject: subject?.trim() || null,
      status: "pending",
    })
    .returning();

  // Send notification email to Jon/Jeff (non-blocking)
  sendTeacherNotification(school.name, {
    name: teacher.name,
    email: teacher.email,
    subject: teacher.subject,
  }).catch((err) => console.error("[Email] Notification failed:", err));

  return NextResponse.json({
    success: true,
    schoolName: school.name,
    teacher,
  });
}
