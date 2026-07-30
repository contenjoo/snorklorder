// 본사(HQ) 발송 메일의 수신자 규칙 + 본문 생성 SSOT.
//
// 이 파일은 순수 함수/상수만 담는다 (nodemailer·db import 금지) — "use client" 컴포넌트에서도
// 그대로 import 할 수 있어야 미리보기와 실제 발송 본문이 갈라지지 않는다.
//
// 수신자 규칙 (2026-07-30, Jon 요청):
//   - 업그레이드 처리는 Jon 이 계속 담당 → Jon 은 항상 To
//   - 정산/인보이스 담당 Cailie 는 "인보이스가 필요한 건"에만 CC
export const HQ_TO = "jon@snorkl.app";
export const HQ_INVOICE_CC = "cailie@snorkl.app";

// 요청 유형별 인보이스 필요 여부 기본값.
// 돈이 드는 유형(upgrade/extension)은 true, 단순 계정 정보 변경(email_change/type_change)은 false.
export function defaultNeedsInvoice(type: string): boolean {
  return type !== "email_change" && type !== "type_change";
}

// 인사말은 실제 수신자와 일치해야 한다. Cailie 가 CC 면 둘 다 부른다.
export function hqGreeting(needsInvoice: boolean): string {
  return needsInvoice ? "Hi Jon and Cailie," : "Hi Jon,";
}

// 본문 첫 줄이 "알려진" 본사 인사말일 때만 매칭한다. (임의의 "Hi ..." 를 잘못 건드리지 않도록 화이트리스트)
const HQ_GREETING_RE = /^[ \t]*Hi (?:Cailie|Jon)(?: and (?:Cailie|Jon))?,[ \t]*\r?\n/;

/**
 * 이미 만들어진 본문의 인사말을 실제 수신자에 맞게 치환한다.
 * 알려진 인사말로 시작하지 않으면 본문을 건드리지 않는다(안전 우선).
 */
export function withHqGreeting(body: string, needsInvoice: boolean): string {
  if (!HQ_GREETING_RE.test(body)) return body;
  return body.replace(HQ_GREETING_RE, `${hqGreeting(needsInvoice)}\n`);
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
  /** 블록 끝에 붙일 한 줄 (발송 시엔 confirm 링크, 미리보기에선 안내 문구). 없으면 생략. */
  confirmLine?: string | null;
}

/**
 * 묶음 메일의 제목/본문/CC 여부를 한 곳에서 만든다 (미리보기 = 실제 발송).
 *
 * - 인보이스가 필요한 건이 하나라도 있으면 Cailie 를 CC → 인사말도 "Hi Jon and Cailie,"
 * - 두 종류가 섞여 있을 때만 ①/② 섹션으로 나누고, Cailie 가 볼 범위를 한 줄로 알린다.
 *   한쪽뿐이면 번호 없이 평면 나열.
 * - 블록 번호는 전체 기준으로 이어서 매긴다(제목의 건수와 일치).
 */
export function buildBatchEmail(
  items: BatchEmailItem[],
  totalEmails: number,
): { subject: string; body: string; needsInvoiceCc: boolean } {
  const count = items.length;
  const invoiceItems = items.filter((it) => it.needsInvoice);
  const plainItems = items.filter((it) => !it.needsInvoice);
  const needsInvoiceCc = invoiceItems.length > 0;
  const grouped = needsInvoiceCc && plainItems.length > 0;

  const lines: string[] = [];
  lines.push(hqGreeting(needsInvoiceCc));
  lines.push("");
  lines.push(
    `Below ${count === 1 ? "is 1 account request" : `are ${count} account requests`}` +
      (totalEmails > count ? ` (${totalEmails} emails total):` : ":"),
  );
  lines.push("");
  if (grouped) {
    lines.push("Cailie — only section ① concerns you.");
    lines.push("");
  }

  let n = 0;
  const pushGroup = (group: BatchEmailItem[], heading?: string) => {
    if (group.length === 0) return;
    if (heading) {
      lines.push("───────────────────────────────────────────");
      lines.push(heading);
      lines.push("───────────────────────────────────────────");
      lines.push("");
    }
    for (const it of group) {
      n++;
      lines.push("═══════════════════════════════════════════");
      lines.push(`[${n}/${count}] ${it.subject}`);
      lines.push("");
      // 인사말은 메일 맨 위에 한 번만 — 블록 안의 개별 인사말은 제거한다.
      lines.push(stripHqGreeting(it.body));
      if (it.confirmLine) {
        lines.push("");
        lines.push(it.confirmLine);
      }
      lines.push("");
    }
  };

  pushGroup(invoiceItems, grouped ? `① Invoice needed (${invoiceItems.length})` : undefined);
  pushGroup(
    plainItems,
    grouped ? `② No invoice — teachers added to an existing account (${plainItems.length})` : undefined,
  );

  lines.push("Thank you,");
  lines.push("Banghyun");

  return {
    subject: `[Snorkl] Batch Request — ${count} request${count !== 1 ? "s" : ""}, ${totalEmails} email${totalEmails !== 1 ? "s" : ""}`,
    body: lines.join("\n"),
    needsInvoiceCc,
  };
}

export interface AccountEmailInput {
  type: string;
  applicantType?: string;
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
  const needsInvoice = typeof r.needsInvoice === "boolean" ? r.needsInvoice : defaultNeedsInvoice(r.type);
  const hi = hqGreeting(needsInvoice);
  let subject = "";
  let body = "";

  if (r.type === "upgrade") {
    const isSchool = r.accountType === "school";
    subject = isSchool
      ? `School Upgrade Request – ${school}`
      : `Teacher Upgrade Request – ${school} (${r.quantity || 1} ${accLabel})`;
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
    // 인보이스가 필요 없는 연장(이미 결제된 계정 기간만 맞추는 경우)에는 인보이스 요청 문장을 넣지 않는다.
    const invoiceLine = needsInvoice ? "\n\nPlease send me an invoice for that too." : "";
    body = `${hi}\n\nCould you extend the ${emailStr || ""} account through ${r.extensionDate || "[DATE]"}?${invoiceLine}${r.notes ? `\n\nNote: ${r.notes}` : ""}\n\nThanks,\n\nBanghyun`;
  } else {
    subject = `Snorkl Request – ${school}`;
    body = `${hi}\n\n${r.notes || ""}\n\nBanghyun`;
  }
  return { subject, body };
}
