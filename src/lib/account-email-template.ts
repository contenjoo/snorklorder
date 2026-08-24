// 본사(HQ) 발송 메일의 수신자 규칙 + 본문 생성 SSOT.
//
// 이 파일은 순수 함수/상수만 담는다 (nodemailer·db import 금지) — "use client" 컴포넌트에서도
// 그대로 import 할 수 있어야 미리보기와 실제 발송 본문이 갈라지지 않는다.
//
// 수신자 규칙 (2026-08 개정):
//   - 업그레이드 처리 메일 → To: Jon. Cailie 는 받지 않는다 (교사 이메일 목록·처리 지시는 그의 업무가 아님).
//   - 인보이스 요청 메일 → To: Cailie, CC: Jon. 청구에 필요한 요약만 담고 교사 이메일 목록은 넣지 않는다.
//   두 메일은 요청번호(#id)로 대조한다.
//   (이전 규칙: 한 통을 Jon To + Cailie CC 로 보내고 본문을 ①/② 섹션으로 나눔 — 2026-07-30)
export const HQ_TO = "jon@snorkl.app";
export const HQ_INVOICE_TO = "cailie@snorkl.app";

// 요청 유형별 인보이스 필요 여부 기본값.
// 돈이 드는 유형(upgrade/extension)은 true, 단순 계정 정보 변경(email_change/type_change)은 false.
export function defaultNeedsInvoice(type: string): boolean {
  return type !== "email_change" && type !== "type_change";
}

// 처리 메일 수신자는 Jon 단독.
export function hqGreeting(): string {
  return "Hi Jon,";
}

// 인보이스 메일 수신자는 Cailie (Jon 은 CC).
export function invoiceGreeting(): string {
  return "Hi Cailie,";
}

// 본문 첫 줄이 "알려진" 본사 인사말일 때만 매칭한다. (임의의 "Hi ..." 를 잘못 건드리지 않도록 화이트리스트)
const HQ_GREETING_RE = /^[ \t]*Hi (?:Cailie|Jon)(?: and (?:Cailie|Jon))?,[ \t]*\r?\n/;

/**
 * 이미 만들어진 본문의 인사말을 실제 수신자(Jon 단독)에 맞게 치환한다.
 * 알려진 인사말로 시작하지 않으면 본문을 건드리지 않는다(안전 우선).
 */
export function withHqGreeting(body: string): string {
  if (!HQ_GREETING_RE.test(body)) return body;
  return body.replace(HQ_GREETING_RE, `${hqGreeting()}\n`);
}

/**
 * 묶음 메일처럼 상단에 인사말이 한 번만 있으면 되는 경우, 각 요청 블록의 인사말을 제거한다.
 */
export function stripHqGreeting(body: string): string {
  if (!HQ_GREETING_RE.test(body)) return body;
  return body.replace(HQ_GREETING_RE, "").replace(/^\r?\n+/, "");
}

export interface BatchEmailItem {
  subject: string;
  body: string;
  needsInvoice: boolean;
  /** 요청번호 — Cailie 인보이스 메일의 [#id] 와 대조하기 위해 블록 머리에 표기한다. */
  requestId?: number | null;
  /** 블록 끝에 붙일 한 줄 (발송 시엔 confirm 링크, 미리보기에선 안내 문구). 없으면 생략. */
  confirmLine?: string | null;
}

/**
 * Jon 에게 보내는 묶음 처리 메일의 제목/본문을 한 곳에서 만든다 (미리보기 = 실제 발송).
 * 인보이스 청구는 별도 메일(buildInvoiceEmail)로 Cailie 에게 가므로 여기서는 섹션을 나누지 않는다.
 */
export function buildBatchEmail(
  items: BatchEmailItem[],
  totalEmails: number,
): { subject: string; body: string } {
  const count = items.length;

  const lines: string[] = [];
  lines.push(hqGreeting());
  lines.push("");
  lines.push(
    `Below ${count === 1 ? "is 1 account request" : `are ${count} account requests`}` +
      (totalEmails > count ? ` (${totalEmails} emails total):` : ":"),
  );
  lines.push("");

  items.forEach((it, i) => {
    lines.push("═══════════════════════════════════════════");
    lines.push(`[${i + 1}/${count}]${it.requestId ? ` [#${it.requestId}]` : ""} ${it.subject}`);
    lines.push("");
    // 인사말은 메일 맨 위에 한 번만 — 블록 안의 개별 인사말은 제거한다.
    lines.push(stripHqGreeting(it.body));
    if (it.confirmLine) {
      lines.push("");
      lines.push(it.confirmLine);
    }
    lines.push("");
  });

  lines.push("Thank you,");
  lines.push("Banghyun");

  return {
    subject: `[Snorkl] Batch Request — ${count} request${count !== 1 ? "s" : ""}, ${totalEmails} email${totalEmails !== 1 ? "s" : ""}`,
    body: lines.join("\n"),
  };
}

// ── 인보이스 메일 (To: Cailie, CC: Jon) ────────────────────────────────────

export interface InvoiceEmailItem {
  requestId: number;
  schoolName: string;
  schoolNameEn?: string | null;
  type: string;
  accountType?: string | null;
  quantity?: number | null;
  extensionDate?: string | null;
}

/** 인보이스 한 건을 사람이 읽는 한 줄로. 교사 이메일 목록은 청구에 불필요하므로 넣지 않는다. */
export function invoiceLine(it: InvoiceEmailItem): string {
  const school = it.schoolNameEn || it.schoolName;
  const qty = it.quantity && it.quantity > 0 ? it.quantity : 1;
  const acc = it.accountType === "school" ? "school account" : it.accountType === "student" ? "student account" : "teacher account";
  const plural = qty > 1 ? `${qty} ${acc}s` : `1 ${acc}`;

  let what: string;
  if (it.type === "extension") {
    what = `Extension through ${it.extensionDate || "[DATE]"}, ${plural}`;
  } else if (it.type === "upgrade" && it.accountType === "school") {
    what = "School-wide upgrade";
  } else {
    what = `Upgrade, ${plural}`;
  }
  return `[#${it.requestId}] ${school} — ${what}`;
}

/**
 * Cailie 에게 보내는 인보이스 요청 메일. 인보이스가 필요한 건만 넘긴다.
 * 같은 요청의 처리 메일은 Jon 에게 따로 가며, 요청번호(#id)로 대조한다.
 */
export function buildInvoiceEmail(items: InvoiceEmailItem[]): { subject: string; body: string } {
  const count = items.length;
  const accounts = items.reduce((s, it) => s + (it.quantity && it.quantity > 0 ? it.quantity : 1), 0);

  const lines: string[] = [];
  lines.push(invoiceGreeting());
  lines.push("");
  lines.push(
    count === 1
      ? "Could you please issue an invoice for the following?"
      : `Could you please issue invoices for the following ${count} requests?`,
  );
  lines.push("");
  for (const it of items) lines.push(invoiceLine(it));
  lines.push("");
  lines.push("Jon is handling the account processing separately (cc'd).");
  lines.push("");
  lines.push("Thank you,");
  lines.push("Banghyun");

  return {
    subject: `[Snorkl] Invoice Request — ${count} request${count !== 1 ? "s" : ""}, ${accounts} account${accounts !== 1 ? "s" : ""}`,
    body: lines.join("\n"),
  };
}

export interface AccountEmailInput {
  type: string;
  applicantType?: string | null;
  schoolName: string;
  schoolNameEn?: string | null;
  emails: string[] | string;
  accountType?: string | null;
  quantity?: number | null;
  oldEmail?: string | null;
  fromType?: string | null;
  extensionDate?: string | null;
  notes?: string | null;
  /** 미지정 시 유형별 기본값(defaultNeedsInvoice)을 사용. 인사말/CC 를 결정한다. */
  needsInvoice?: boolean | null;
}

export function generateAccountEmail(r: AccountEmailInput): { subject: string; body: string } {
  const accLabel = r.accountType === "teacher" ? "teacher" : r.accountType === "student" ? "student" : "school";
  const school = r.schoolNameEn || r.schoolName;
  const emailStr = Array.isArray(r.emails) ? r.emails.join(", ") : r.emails;
  const hi = hqGreeting();
  let subject = "";
  let body = "";

  if (r.type === "upgrade") {
    const isSchool = r.accountType === "school";
    subject = isSchool
      ? `School Upgrade Request – ${school}`
      : `Teacher Upgrade Request – ${school} (${r.quantity || 1} ${accLabel}${(r.quantity || 1) > 1 ? "s" : ""})`;
    const emailList = emailStr.split(/[,;\n]+/).map((e) => e.trim()).filter(Boolean).map((e) => `- Email: ${e}`).join("\n");
    body = isSchool
      ? `${hi}\n\nI'd like to request a school-wide upgrade for ${school}.\n\n${emailList}${r.notes ? `\n\nNote: ${r.notes}` : ""}\n\nPlease let me know once it's done. Thank you.\n\nBanghyun`
      : `${hi}\n\nI'd like to request an upgrade for ${r.quantity || 1} ${accLabel} account${(r.quantity || 1) > 1 ? "s" : ""} for ${school}.\n\n${emailList}${r.notes ? `\n\nNote: ${r.notes}` : ""}\n\nPlease let me know once it's done. Thank you.\n\nBanghyun`;
  } else if (r.type === "email_change") {
    subject = `Account Email Change Request – ${school}`;
    body = `${hi}\n\nCould you please update the email for the account at ${school}?\n\n- Old email: ${r.oldEmail || ""}\n- New email: ${emailStr || ""}${r.notes ? `\n\nNote: ${r.notes}` : ""}\n\nThank you.\n\nBanghyun`;
  } else if (r.type === "type_change") {
    subject = `Account Type Change Request - ${emailStr}`;
    body = `${hi}\n\nThe account ${emailStr || ""} was registered as a ${r.fromType === "teacher" ? "teacher" : "student"}, but this user is a ${r.fromType === "teacher" ? "student" : "teacher"}. Could you please change the account type?${r.notes ? `\n\nNote: ${r.notes}` : ""}\n\nThank you.\n\nBanghyun`;
  } else if (r.type === "extension") {
    subject = `Account Extension Request – ${school}`;
    // 인보이스 요청은 Cailie 에게 별도 메일로 나가므로 Jon 본문에는 넣지 않는다.
    body = `${hi}\n\nCould you extend the ${emailStr || ""} account through ${r.extensionDate || "[DATE]"}?${r.notes ? `\n\nNote: ${r.notes}` : ""}\n\nThanks,\n\nBanghyun`;
  } else {
    subject = `Snorkl Request – ${school}`;
    body = `${hi}\n\n${r.notes || ""}\n\nBanghyun`;
  }
  return { subject, body };
}
