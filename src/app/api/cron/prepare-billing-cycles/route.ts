export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron-auth";
import { prepareDueBillingCycles } from "@/lib/billing-cycle-db";

async function run(req: Request) {
  if (!authorizeCron(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await prepareDueBillingCycles()) });
  } catch {
    console.error("[prepare-billing-cycles] failed");
    return NextResponse.json({ ok: false, error: "Billing cycle preparation failed" }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
