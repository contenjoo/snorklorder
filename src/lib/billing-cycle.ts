import { invoiceWhat, normalizeTermYears } from "./account-email-template.ts";

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
  termYears: number;
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
    termYears: item.termYears,
  })}`;
}

// 청구 예상 금액 — Cailie 가 인보이스 금액을 맞춰 볼 수 있게 메일 끝에 붙인다.
// 정가는 계정·학교 1년 기준, 협력사 할인은 정가에 일괄 적용한다.
export const LIST_PRICE_USD = { teacher: 100, school: 1000 } as const;
export const PARTNER_DISCOUNT_PERCENT = 20;

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
const discounted = (list: number) => (list * (100 - PARTNER_DISCOUNT_PERCENT)) / 100;

function itemQuantity(item: BillingCycleEmailItem) {
  return item.quantity > 0 ? item.quantity : 1;
}

/** [#1, #2] / [#3–#7] — 3건 이상 연속 번호만 범위로 줄인다. */
export function formatRequestIds(ids: number[]): string {
  const sorted = [...ids].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    if (j - i >= 2) parts.push(`#${sorted[i]}–#${sorted[j]}`);
    else for (let k = i; k <= j; k++) parts.push(`#${sorted[k]}`);
    i = j + 1;
  }
  return `[${parts.join(", ")}]`;
}

type Section = { key: string; title: string; unit: string };
const SECTIONS: Section[] = [
  { key: "upgrade:teacher", title: "Teacher upgrades", unit: "account" },
  { key: "extension:teacher", title: "Teacher extensions", unit: "account" },
  { key: "upgrade:school", title: "School-wide upgrades", unit: "school" },
  { key: "upgrade:student", title: "Student upgrades", unit: "account" },
  { key: "extension:student", title: "Student extensions", unit: "account" },
  { key: "extension:school", title: "School-wide extensions", unit: "school" },
];

function sectionKey(item: BillingCycleEmailItem) {
  const type = item.requestType === "extension" ? "extension" : "upgrade";
  const account = item.accountType === "school" || item.accountType === "student" ? item.accountType : "teacher";
  return `${type}:${account}`;
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/**
 * 요청을 종류별로 묶고, 같은 학교·기간·연장일은 한 줄로 합친다.
 * 첫 줄에 주기 코드를 넣는다 — Cailie 가 이 요약만 인보이스 메모에 옮겨도 자동 대조가 주기를 찾는다.
 */
export function billingCycleSummaryLines(items: BillingCycleEmailItem[], code: string): string[] {
  const allOneYear = items.every((item) => normalizeTermYears(item.termYears) === 1);
  const lines: string[] = [];
  const counts: string[] = [];
  for (const section of SECTIONS) {
    const sectionItems = items.filter((item) => sectionKey(item) === section.key);
    if (!sectionItems.length) continue;
    const groups = new Map<string, { school: string; qty: number; term: number; ext: string | null; ids: number[] }>();
    for (const item of sectionItems) {
      const term = normalizeTermYears(item.termYears);
      const key = [item.schoolNameEn, term, item.extensionDate ?? ""].join("\u0000");
      const group = groups.get(key) ?? { school: item.schoolNameEn, qty: 0, term, ext: item.extensionDate, ids: [] };
      group.qty += itemQuantity(item);
      group.ids.push(item.requestId);
      groups.set(key, group);
    }
    const total = sectionItems.reduce((sum, item) => sum + itemQuantity(item), 0);
    counts.push(`${section.title}: ${plural(total, section.unit)}`);
    lines.push(`${section.title} — ${plural(total, section.unit)}`);
    for (const g of [...groups.values()].sort((a, b) => Math.min(...a.ids) - Math.min(...b.ids))) {
      const detail = [
        section.unit === "school" && g.qty === 1 ? null : String(g.qty),
        g.ext ? `through ${g.ext}` : null,
        allOneYear ? null : `${g.term}-year`,
      ].filter(Boolean).join(", ");
      lines.push(`- ${g.school}${detail ? ` — ${detail}` : ""} ${formatRequestIds(g.ids)}`);
    }
    lines.push("");
  }
  const header = [
    `Summary — Billing cycle ${code}, ${items.length} requests, ${allOneYear ? "all 1-year licenses" : "1- and 2-year licenses"}`,
    ...counts.map((c) => `- ${c}`),
    "",
  ];
  return [...header, ...lines];
}

/** 정가·할인가·수량·소계. 단가가 정해지지 않은 항목(학생 계정 등)이 있으면 null. */
export function billingCycleExpectedAmount(items: BillingCycleEmailItem[]) {
  const rows = new Map<string, { label: string; list: number; qty: number }>();
  for (const item of items) {
    if (item.accountType === "student") return null;
    const kind = item.accountType === "school" ? "school" : "teacher";
    const term = normalizeTermYears(item.termYears);
    const key = `${kind}:${term}`;
    const row = rows.get(key) ?? {
      label: `${kind === "school" ? "School-wide" : "Teacher account"} (${term}-year)`,
      list: LIST_PRICE_USD[kind] * term,
      qty: 0,
    };
    row.qty += itemQuantity(item);
    rows.set(key, row);
  }
  // teacher:1, teacher:2, school:1, school:2 순서
  const rank = (key: string) => (key.startsWith("teacher") ? 0 : 10) + Number(key.split(":")[1]);
  const ordered = [...rows.entries()].sort(([a], [b]) => rank(a) - rank(b))
    .map(([, row]) => ({ ...row, net: discounted(row.list), subtotal: discounted(row.list) * row.qty }));
  const listTotal = ordered.reduce((sum, row) => sum + row.list * row.qty, 0);
  const total = ordered.reduce((sum, row) => sum + row.subtotal, 0);
  return { rows: ordered, listTotal, discount: listTotal - total, total };
}

function expectedAmountLines(items: BillingCycleEmailItem[]): string[] {
  const amount = billingCycleExpectedAmount(items);
  if (!amount) {
    return ["Expected amount — not included (this batch has items without a standard price)."];
  }
  return [
    "Expected amount — please check against the invoice",
    ...amount.rows.map((row) =>
      `- ${row.label}: ${usd(row.list)} → ${usd(row.net)} after ${PARTNER_DISCOUNT_PERCENT}% off × ${row.qty} = ${usd(row.subtotal)}`),
    `- Total: ${usd(amount.total)} (list ${usd(amount.listTotal)} − ${PARTNER_DISCOUNT_PERCENT}% ${usd(amount.discount)})`,
  ];
}

export function buildBillingCycleEmail(
  code: string,
  items: BillingCycleEmailItem[],
  viewUrl: string | null,
) {
  const lines = [
    "Hi Cailie,", "",
    `Could you please issue one consolidated invoice for billing cycle ${code}?`, "",
    ...billingCycleSummaryLines(items, code),
    ...expectedAmountLines(items),
    "",
    "Please copy the summary above, including the billing cycle code and each [#request] reference, into the invoice note.",
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
