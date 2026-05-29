export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { domainRequests } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { checkAuth } from "@/lib/auth";

export async function GET() {
  if (!(await checkAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await db.select().from(domainRequests).orderBy(desc(domainRequests.createdAt));
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  if (!(await checkAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json();
  const { action, id, ...data } = body;

  if (action === "update" && id) {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    const fields = ["status", "schoolName", "schoolNameEn", "domain", "team", "note",
      "invoiceNumber", "invoiceAmount", "invoiceDueDate", "paymentLink", "paymentDate", "paymentMethod"];
    for (const f of fields) {
      if (data[f] !== undefined) updates[f] = data[f];
    }
    // status=done 으로 바뀌고 confirmedAt 없으면 채움
    if (data.status === "done") updates.confirmedAt = new Date();
    const [item] = await db.update(domainRequests).set(updates).where(eq(domainRequests.id, id)).returning();
    return NextResponse.json({ request: item });
  }

  if (action === "delete" && id) {
    await db.delete(domainRequests).where(eq(domainRequests.id, id));
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
