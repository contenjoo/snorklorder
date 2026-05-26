export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { domainRequests } from "@/db/schema";
import { eq } from "drizzle-orm";
import { sendDomainConfirmedNotification } from "@/lib/email";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const [r] = await db
    .select()
    .from(domainRequests)
    .where(eq(domainRequests.confirmToken, token));
  if (!r) return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });
  return NextResponse.json({ request: r });
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const [r] = await db
    .select()
    .from(domainRequests)
    .where(eq(domainRequests.confirmToken, token));
  if (!r) return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });

  const confirmedAt = new Date();
  await db
    .update(domainRequests)
    .set({ status: "done", confirmedAt })
    .where(eq(domainRequests.id, r.id));

  void (async () => {
    try {
      await sendDomainConfirmedNotification({
        schoolName: r.schoolName,
        schoolNameEn: r.schoolNameEn,
        domain: r.domain,
        team: r.team,
        confirmedAt,
      });
    } catch (err) {
      console.warn("[domain-confirm] admin notification failed:", err);
    }
  })();

  return NextResponse.json({ success: true });
}
