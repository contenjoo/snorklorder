import { confirmationExpired } from "@/lib/confirmation-token";
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { domainRequests } from "@/db/schema";
import { eq, and, isNull, gt } from "drizzle-orm";
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
  if (!r || confirmationExpired(r)) return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });
  return NextResponse.json({ request: { id:r.id, schoolName:r.schoolName, schoolNameEn:r.schoolNameEn, domain:r.domain, team:r.team, status:r.status, confirmedAt:r.confirmedAt } });
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
  if (!r || confirmationExpired(r)) return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });

  const confirmedAt = new Date();
  const changed = await db
    .update(domainRequests)
    .set({ status: "done", confirmedAt })
    .where(and(eq(domainRequests.id, r.id), eq(domainRequests.confirmToken, token), gt(domainRequests.tokenExpiresAt,new Date()), isNull(domainRequests.confirmedAt)))
    .returning({id:domainRequests.id});
  if (!changed.length) return NextResponse.json({success:true});

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
