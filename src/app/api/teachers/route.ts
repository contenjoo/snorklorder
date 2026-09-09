import { checkAuth } from "@/lib/auth";
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { teachers, schools } from "@/db/schema";
import { eq, desc, inArray, and, sql } from "drizzle-orm";

export async function GET(req: NextRequest) {
  if (!(await checkAuth())) return NextResponse.json({error:"Unauthorized"},{status:401});
  const schoolId = req.nextUrl.searchParams.get("schoolId");
  const status = req.nextUrl.searchParams.get("status");
  // `search` powers the admin command palette (name/email partial match, top results only).
  const search = req.nextUrl.searchParams.get("search")?.trim();

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

  const conditions = [];
  if (schoolId) conditions.push(eq(teachers.schoolId, parseInt(schoolId)));
  if (status) conditions.push(eq(teachers.status, status));
  if (search) {
    conditions.push(sql`(${teachers.name} ILIKE ${"%" + search + "%"} OR ${teachers.email} ILIKE ${"%" + search + "%"})`);
  }
  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }
  if (search) {
    query = query.limit(5);
  }

  const result = await query;
  return NextResponse.json(result);
}

export async function PATCH(req: NextRequest) {
  if (!(await checkAuth())) return NextResponse.json({error:"Unauthorized"},{status:401});
  const body = await req.json().catch(()=>null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({error:"Invalid JSON"},{status:400});
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
  if (!(await checkAuth())) return NextResponse.json({error:"Unauthorized"},{status:401});
  const id = req.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "ID required" }, { status: 400 });
  }

  await db.delete(teachers).where(eq(teachers.id, parseInt(id)));
  return NextResponse.json({ success: true });
}
