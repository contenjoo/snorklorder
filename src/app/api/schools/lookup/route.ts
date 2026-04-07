export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { schools } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code")?.toUpperCase();

  if (!code) {
    return NextResponse.json({ error: "Code required" }, { status: 400 });
  }

  const [school] = await db
    .select({ id: schools.id, name: schools.name })
    .from(schools)
    .where(eq(schools.code, code));

  if (!school) {
    return NextResponse.json({ error: "School not found" }, { status: 404 });
  }

  return NextResponse.json(school);
}
