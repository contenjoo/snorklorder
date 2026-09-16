export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth";
import { buildBillingCycleEmail } from "@/lib/billing-cycle";
import { countUnassignedBillingRequests, listBillingCycleViews } from "@/lib/billing-cycle-db";
import { invoiceViewUrl } from "@/lib/invoice-ledger";

export async function GET() {
  if (!(await checkAuth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const [cycles, unassignedCount] = await Promise.all([
      listBillingCycleViews(),
      countUnassignedBillingRequests(),
    ]);
    return NextResponse.json({
      cycles: cycles.map((cycle) => ({
        ...cycle,
        preview: cycle.status === "ready"
          ? buildBillingCycleEmail(cycle.code, cycle.items, invoiceViewUrl())
          : null,
      })),
      unassignedCount,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("[billing-cycles] failed to load admin ledger");
    return NextResponse.json({ error: "통합 청구 원장을 불러오지 못했습니다." }, { status: 500 });
  }
}
