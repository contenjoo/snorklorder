// TODO(security): code field is enumeration-sensitive. Consider returning only {id, name, nameEn} and require auth or a per-session token for the code lookup. See QC report L2.
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { schools } from "@/db/schema";
import { sql } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json([]);
  }

  const results = await db
    .select({ id: schools.id, name: schools.name, nameEn: schools.nameEn, code: schools.code })
    .from(schools)
    .where(
      sql`${schools.name} ILIKE ${"%" + q + "%"} OR ${schools.nameEn} ILIKE ${"%" + q + "%"} OR ${schools.code} ILIKE ${"%" + q + "%"}`
    )
    .limit(10);

  return NextResponse.json(results, {
    headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=120" },
  });
}
