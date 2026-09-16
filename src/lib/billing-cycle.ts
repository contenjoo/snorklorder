import { invoiceWhat } from "./account-email-template.ts";

export const BILLING_CYCLE_STATUSES = [
  "collecting", "ready", "sending", "sent", "send_unknown",
  "invoice_mismatch", "invoiced", "payment_mismatch", "paid", "empty",
] as const;

export type BillingCycleStatus = (typeof BILLING_CYCLE_STATUSES)[number];

export interface BillingWindow {
  code: string;
  start: Date;
  end: Date;
}

export interface BillingCycleEmailItem {
  requestId: number;
  schoolNameEn: string;
  requestType: string;
  accountType: string | null;
  quantity: number;
  extensionDate: string | null;
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstBoundaryUtc(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day, 9, 0, 0) - KST_OFFSET_MS);
}

function cycleCode(year: number, monthIndex: number, half: "A" | "B") {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${half}`;
}

/** The operational boundary is 09:00 Asia/Seoul on the 1st and 16th. */
export function billingWindowAt(instant: Date): BillingWindow {
  const kst = new Date(instant.getTime() + KST_OFFSET_MS);
  const year = kst.getUTCFullYear();
  const month = kst.getUTCMonth();
  const day = kst.getUTCDate();
  const hour = kst.getUTCHours();

  if (day > 16 || (day === 16 && hour >= 9)) {
    return {
      code: cycleCode(year, month, "B"),
      start: kstBoundaryUtc(year, month, 16),
      end: kstBoundaryUtc(year, month + 1, 1),
    };
  }
  if (day > 1 || (day === 1 && hour >= 9)) {
    return {
      code: cycleCode(year, month, "A"),
      start: kstBoundaryUtc(year, month, 1),
      end: kstBoundaryUtc(year, month, 16),
    };
  }
  return {
    code: cycleCode(year, month - 1, "B"),
    start: kstBoundaryUtc(year, month - 1, 16),
    end: kstBoundaryUtc(year, month, 1),
  };
}

export function closingBillingWindowAt(instant: Date): BillingWindow {
  return billingWindowAt(new Date(instant.getTime() - 1));
}

export function billingCycleItemLine(item: BillingCycleEmailItem): string {
  return `[#${item.requestId}] ${item.schoolNameEn} — ${invoiceWhat({
    requestId: item.requestId,
    schoolName: item.schoolNameEn,
    schoolNameEn: item.schoolNameEn,
    type: item.requestType,
    accountType: item.accountType,
    quantity: item.quantity,
    extensionDate: item.extensionDate,
  })}`;
}

export function buildBillingCycleEmail(
  code: string,
  items: BillingCycleEmailItem[],
  viewUrl: string | null,
) {
  const lines = [
    "Hi Cailie,", "",
    `Could you please issue one consolidated invoice for billing cycle ${code}?`, "",
    `Billing cycle: ${code}`,
    `Requests: ${items.length}`,
    "",
    ...items.map(billingCycleItemLine),
    "",
    "Please keep the billing cycle code and each [#request] reference in the invoice note.",
    "Jon is handling the account processing separately (cc'd).",
  ];
  if (viewUrl) lines.push("", "You can check the same read-only ledger here:", viewUrl);
  lines.push("", "Thank you,", "Banghyun");
  return {
    subject: `[Snorkl] Invoice Batch ${code} — ${items.length} requests`,
    body: lines.join("\n"),
  };
}

export interface FrozenBillingItem {
  requestId: number;
  quantity: number;
}

export function compareFrozenBillingItems(
  expected: FrozenBillingItem[],
  actual: FrozenBillingItem[],
): { ok: true } | { ok: false; reason: string } {
  const duplicateIds = actual.filter((item, index) => actual.findIndex((other) => other.requestId === item.requestId) !== index)
    .map((item) => item.requestId);
  if (duplicateIds.length) return { ok: false, reason: `중복 요청 #${[...new Set(duplicateIds)].join(", #")}` };
  const expectedById = new Map(expected.map((item) => [item.requestId, item.quantity]));
  const actualById = new Map(actual.map((item) => [item.requestId, item.quantity]));
  const missing = expected.filter((item) => !actualById.has(item.requestId)).map((item) => item.requestId);
  const extra = actual.filter((item) => !expectedById.has(item.requestId)).map((item) => item.requestId);
  const quantityMismatch = expected.filter((item) => {
    const quantity = actualById.get(item.requestId);
    return quantity !== undefined && quantity !== item.quantity;
  });
  const reasons = [
    missing.length ? `누락 #${missing.join(", #")}` : "",
    extra.length ? `예상 외 #${extra.join(", #")}` : "",
    quantityMismatch.length
      ? `수량 불일치 ${quantityMismatch.map((item) => `#${item.requestId} 예상 ${item.quantity}/실제 ${actualById.get(item.requestId)}`).join(", ")}`
      : "",
  ].filter(Boolean);
  return reasons.length ? { ok: false, reason: reasons.join("; ") } : { ok: true };
}
