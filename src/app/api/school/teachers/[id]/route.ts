export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { teachers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSchoolSession } from "@/lib/school-auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const schoolId = await getSchoolSession();
  if (schoolId == null) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const teacherId = Number(id);
  if (!Number.isFinite(teacherId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const [teacher] = await db
    .select()
    .from(teachers)
    .where(eq(teachers.id, teacherId))
    .limit(1);

  if (!teacher) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (teacher.schoolId !== schoolId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { action?: string; reason?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const { action, reason } = body;

  if (teacher.verificationStatus !== "email_verified") {
    return NextResponse.json(
      { error: "Not in approval queue" },
      { status: 409 }
    );
  }

  if (action === "approve") {
    await db
      .update(teachers)
      .set({
        verificationStatus: "approved",
        approvedAt: new Date(),
        approvedBy: "school_admin",
      })
      .where(eq(teachers.id, teacherId));
  } else if (action === "reject") {
    await db
      .update(teachers)
      .set({
        verificationStatus: "rejected",
        rejectedReason: reason ? String(reason).slice(0, 500) : null,
      })
      .where(eq(teachers.id, teacherId));
  } else {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const schoolId = await getSchoolSession();
  if (schoolId == null) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const teacherId = Number(id);
  if (!Number.isFinite(teacherId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const [teacher] = await db
    .select()
    .from(teachers)
    .where(eq(teachers.id, teacherId))
    .limit(1);

  if (!teacher) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (teacher.schoolId !== schoolId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await db.delete(teachers).where(eq(teachers.id, teacherId));

  return NextResponse.json({ ok: true });
}
