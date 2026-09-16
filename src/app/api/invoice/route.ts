export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { listBillingCycleViews, type BillingCycleView } from "@/lib/billing-cycle-db";
import { checkInvoiceViewToken } from "@/lib/invoice-ledger";

const NO_STORE = { "Cache-Control": "no-store" };

function tokenGate(req: NextRequest): NextResponse | null {
  switch (checkInvoiceViewToken(req.nextUrl.searchParams.get("k"))) {
    case "ok": return null;
    case "not_configured":
      return NextResponse.json({ error: "Invoice view is not configured." }, { status: 503, headers: NO_STORE });
    default:
      return NextResponse.json({ error: "Invalid or expired link." }, { status: 401, headers: NO_STORE });
  }
}

function publicCycle(cycle: BillingCycleView) {
  return {
    id: cycle.id,
    code: cycle.code,
    kind: cycle.kind,
    status: cycle.status,
    periodStart: cycle.periodStart,
    periodEnd: cycle.periodEnd,
    sentAt: cycle.sentAt,
    invoiceNumber: cycle.invoiceNumber,
    paidAt: cycle.paidAt,
    items: cycle.items.map(({ requestId, schoolNameEn, requestType, accountType, quantity, extensionDate }) => ({
      requestId, schoolNameEn, requestType, accountType, quantity, extensionDate,
    })),
  };
}

export async function GET(req: NextRequest) {
  const denied = tokenGate(req);
  if (denied) return denied;
  try {
    const cycles = await listBillingCycleViews();
    return NextResponse.json({
      collecting: cycles.filter((cycle) => cycle.status === "collecting").map(publicCycle),
      awaiting: cycles.filter((cycle) => ["ready", "sending", "sent"].includes(cycle.status)).map(publicCycle),
      issues: cycles.filter((cycle) => ["send_unknown", "invoice_mismatch", "payment_mismatch"].includes(cycle.status)).map(publicCycle),
      recent: cycles.filter((cycle) => ["invoiced", "paid", "empty"].includes(cycle.status)).slice(0, 12).map(publicCycle),
    }, { headers: NO_STORE });
  } catch {
    console.error("[invoice] failed to load billing cycles");
    return NextResponse.json({ error: "Could not load the list. Please refresh." }, { status: 500, headers: NO_STORE });
  }
}
