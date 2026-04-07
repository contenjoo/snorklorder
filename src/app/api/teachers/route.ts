export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { teachers, schools } from "@/db/schema";
import { eq, desc, inArray } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const schoolId = req.nextUrl.searchParams.get("schoolId");
  const status = req.nextUrl.searchParams.get("status");

  let query = db
    .select({
      id: teachers.id,
      name: teachers.name,
      email: teachers.email,
      subject: teachers.subject,
      status: teachers.status,
      notifiedAt: teachers.notifiedAt,
      createdAt: teachers.createdAt,
      schoolId: teachers.schoolId,
      schoolName: schools.name,
      schoolCode: schools.code,
    })
    .from(teachers)
    .innerJoin(schools, eq(teachers.schoolId, schools.id))
    .orderBy(desc(teachers.createdAt))
    .$dynamic();

  if (schoolId) {
    query = query.where(eq(teachers.schoolId, parseInt(schoolId)));
  }
  if (status) {
    query = query.where(eq(teachers.status, status));
  }

  const result = await query;
  return NextResponse.json(result);
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { ids, status } = body;

  if (!ids?.length || !status) {
    return NextResponse.json({ error: "IDs and status required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = { status };
  if (status === "sent") {
    updates.notifiedAt = new Date();
  }

  await db
    .update(teachers)
    .set(updates)
    .where(inArray(teachers.id, ids));

  return NextResponse.json({ success: true, updated: ids.length });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "ID required" }, { status: 400 });
  }

  await db.delete(teachers).where(eq(teachers.id, parseInt(id)));
  return NextResponse.json({ success: true });
}
