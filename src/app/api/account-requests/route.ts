export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accountRequests } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  const result = await db
    .select()
    .from(accountRequests)
    .orderBy(desc(accountRequests.createdAt));
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, id, ...data } = body;

  if (action === "create") {
    const [item] = await db
      .insert(accountRequests)
      .values({
        type: data.type || "upgrade",
        schoolName: data.schoolName,
        emails: data.emails,
        accountType: data.accountType || "teacher",
        quantity: data.quantity || 1,
        oldEmail: data.oldEmail || null,
        fromType: data.fromType || null,
        extensionDate: data.extensionDate || null,
        notes: data.notes || null,
        status: data.status || "draft",
      })
      .returning();
    return NextResponse.json({ request: item });
  }

  if (action === "update" && id) {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    const fields = ["type", "schoolName", "emails", "accountType", "quantity", "oldEmail",
      "fromType", "extensionDate", "notes", "status", "invoiceNumber", "invoiceAmount",
      "invoiceDueDate", "paymentLink", "paymentDate", "paymentMethod"];
    for (const f of fields) {
      if (data[f] !== undefined) updates[f] = data[f];
    }
    const [item] = await db
      .update(accountRequests)
      .set(updates)
      .where(eq(accountRequests.id, id))
      .returning();
    return NextResponse.json({ request: item });
  }

  if (action === "delete" && id) {
    await db.delete(accountRequests).where(eq(accountRequests.id, id));
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
