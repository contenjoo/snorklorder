export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth";
import { buildBillingCycleEmail } from "@/lib/billing-cycle";
import {
  loadBillingCycleForSend,
  markBillingCycleSent,
  markBillingCycleSendUnknown,
} from "@/lib/billing-cycle-db";
import { getTransporter, HQ_EMAIL, HQ_INVOICE_TO, logEmail } from "@/lib/email";
import { invoiceViewUrl } from "@/lib/invoice-ledger";

const UNKNOWN_ERROR = "Cailie billing cycle delivery outcome unknown; check Gmail Sent";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await checkAuth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (req.headers.get("origin") !== req.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid billing cycle id" }, { status: 400 });
  }
  const transporter = getTransporter();
  if (!transporter) return NextResponse.json({ error: "Gmail is not configured" }, { status: 500 });

  const claimed = await loadBillingCycleForSend(id);
  if (!claimed) {
    return NextResponse.json({ error: "Only a ready billing cycle can be sent once." }, { status: 409 });
  }
  if (!claimed.items.length || !claimed.cycle.sendStartedAt) {
    await markBillingCycleSendUnknown(id, "Frozen billing cycle has no items");
    return NextResponse.json({ error: "Frozen billing cycle has no items" }, { status: 409 });
  }

  const email = buildBillingCycleEmail(claimed.cycle.code, claimed.items, invoiceViewUrl());
  let gmailMessageId: string | null = null;
  try {
    const result = await transporter.sendMail({
      from: process.env.GMAIL_USER || "",
      to: HQ_INVOICE_TO,
      cc: HQ_EMAIL,
      subject: email.subject,
      text: email.body,
      headers: { "X-Snorkl-Billing-Cycle": claimed.cycle.code },
    });
    gmailMessageId = result.messageId || null;
  } catch {
    await markBillingCycleSendUnknown(id, UNKNOWN_ERROR);
    await logEmail({
      to: `${HQ_INVOICE_TO} (cc: ${HQ_EMAIL})`,
      subject: email.subject,
      kind: "billing_cycle",
      status: "failed",
      error: UNKNOWN_ERROR,
      relatedType: "billing_cycle",
      relatedId: id,
    });
    return NextResponse.json({
      error: UNKNOWN_ERROR,
      deliveryUnknown: true,
      automaticRetryBlocked: true,
    }, { status: 502 });
  }

  const finalized = await markBillingCycleSent(id, claimed.cycle.sendStartedAt, gmailMessageId);
  if (!finalized) {
    await markBillingCycleSendUnknown(id, UNKNOWN_ERROR);
    return NextResponse.json({ error: UNKNOWN_ERROR, deliveryUnknown: true }, { status: 500 });
  }
  await logEmail({
    to: `${HQ_INVOICE_TO} (cc: ${HQ_EMAIL})`,
    subject: email.subject,
    kind: "billing_cycle",
    status: "success",
    relatedType: "billing_cycle",
    relatedId: id,
  });
  return NextResponse.json({ success: true, code: finalized.code, sentAt: finalized.sentAt });
}
