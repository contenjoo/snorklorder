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

  const literal = q.replace(/[\\%_]/g, "\\$&");
  const results = await db
    .select({ id: schools.id, name: schools.name, nameEn: schools.nameEn, team: schools.team })
    .from(schools)
    .where(
      sql`${schools.name} ILIKE ${"%" + literal + "%"} OR ${schools.nameEn} ILIKE ${"%" + literal + "%"}`
    )
    .limit(10);

  return NextResponse.json(results, {
    headers: { "Cache-Control": "no-store" },
  });
}
