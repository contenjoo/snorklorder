export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { schools, teachers } from "@/db/schema";
import { eq, sql, desc } from "drizzle-orm";

// Simple in-memory cache (survives across requests in same serverless instance)
let cache: { data: unknown; timestamp: number; key: string } | null = null;
const CACHE_TTL = 30_000; // 30 seconds

function getCacheHeaders() {
  return {
    "Cache-Control": "s-maxage=15, stale-while-revalidate=30",
  };
}

export async function GET(req: NextRequest) {
  const include = req.nextUrl.searchParams.get("include");
  const cacheKey = `schools-${include || "basic"}`;

  // Return cache if fresh
  if (cache && cache.key === cacheKey && Date.now() - cache.timestamp < CACHE_TTL) {
    return NextResponse.json(cache.data, { headers: getCacheHeaders() });
  }

  // Single optimized query with LEFT JOIN instead of subquery + separate query
  if (include === "teachers") {
    const [schoolRows, teacherRows] = await Promise.all([
      db
        .select({
          id: schools.id,
          name: schools.name,
          nameEn: schools.nameEn,
          code: schools.code,
          domain: schools.domain,
          region: schools.region,
          team: schools.team,
          createdAt: schools.createdAt,
        })
        .from(schools)
        .orderBy(schools.team, schools.name),
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

    const result = schoolRows.map((s) => ({
      ...s,
      teacherCount: teachersBySchool.get(s.id)?.length || 0,
      teachers: teachersBySchool.get(s.id) || [],
    }));

    cache = { data: result, timestamp: Date.now(), key: cacheKey };
    return NextResponse.json(result, { headers: getCacheHeaders() });
  }

  // Basic query (no teachers)
  const result = await db
    .select({
      id: schools.id,
      name: schools.name,
      nameEn: schools.nameEn,
      code: schools.code,
      domain: schools.domain,
      region: schools.region,
      team: schools.team,
      createdAt: schools.createdAt,
      teacherCount: sql<number>`(SELECT COUNT(*) FROM teachers WHERE teachers.school_id = ${schools.id})`,
    })
    .from(schools)
    .orderBy(schools.team, schools.name);

  cache = { data: result, timestamp: Date.now(), key: cacheKey };
  return NextResponse.json(result, { headers: getCacheHeaders() });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, nameEn, code, domain, region, team } = body;

  if (!name || !code) {
    return NextResponse.json({ error: "Name and code required" }, { status: 400 });
  }

  const existing = await db
    .select()
    .from(schools)
    .where(eq(schools.code, code.toUpperCase()));

  if (existing.length > 0) {
    return NextResponse.json({ error: "School code already exists" }, { status: 409 });
  }

  const [school] = await db
    .insert(schools)
    .values({ name, nameEn: nameEn || null, code: code.toUpperCase(), domain: domain || null, region: region || null, team: team || null })
    .returning();

  cache = null; // Invalidate cache
  return NextResponse.json(school);
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "ID required" }, { status: 400 });
  }

  await db.delete(teachers).where(eq(teachers.schoolId, parseInt(id)));
  await db.delete(schools).where(eq(schools.id, parseInt(id)));

  cache = null; // Invalidate cache
  return NextResponse.json({ success: true });
}
