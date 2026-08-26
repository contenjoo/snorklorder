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

/** 파트너에게 보이는 학교 이름은 영문 우선 — 메일과 화면이 같은 이름을 써야 대조가 된다. */
export function invoiceSchool(it: InvoiceEmailItem): string {
  return it.schoolNameEn || it.schoolName;
}

/** 청구 내용 한 조각. 메일 본문과 확인 페이지가 이 한 함수를 공유한다. */
export function invoiceWhat(it: InvoiceEmailItem): string {
  const qty = it.quantity && it.quantity > 0 ? it.quantity : 1;
  const acc = it.accountType === "school" ? "school account" : it.accountType === "student" ? "student account" : "teacher account";
  const plural = qty > 1 ? `${qty} ${acc}s` : `1 ${acc}`;

  if (it.type === "extension") {
    return `Extension through ${it.extensionDate || "[DATE]"}, ${plural}`;
  }
  if (it.type === "upgrade" && it.accountType === "school") {
    return "School-wide upgrade";
  }
  return `Upgrade, ${plural}`;
}

/** 인보이스 한 건을 사람이 읽는 한 줄로. 교사 이메일 목록은 청구에 불필요하므로 넣지 않는다. */
export function invoiceLine(it: InvoiceEmailItem): string {
  return `[#${it.requestId}] ${invoiceSchool(it)} — ${invoiceWhat(it)}`;
}

// ── 인보이스 대기 판정 (순수) ──────────────────────────────────────────────
//
// 이 규칙 하나가 인보이스 메일 본문·확인 페이지·파트너 포털·관리자 미리보기를 모두 지배한다.
// 서버는 여기 상수로 drizzle 조건을 만들고(@/lib/invoice-ledger), 클라이언트는 아래 술어를 쓴다.
// 둘 중 하나만 고치면 화면마다 다른 말을 하게 되므로 반드시 여기서 같이 고칠 것.

/** 아직 청구가 안 끝난 업무 상태. invoiced/paid 로 넘어가면 목록에서 빠진다. */
export const OPEN_INVOICE_STATUSES = ["sent", "processed"] as const;
/** 청구가 끝난 상태. 확인 페이지의 "Recently invoiced" 가 이걸 본다. */
export const DONE_INVOICE_STATUSES = ["invoiced", "paid"] as const;
/** 취소 saga 진행/완료 건은 어느 목록에도 뜨면 안 된다. */
export const VOID_EXCLUDED_STATES = ["prepared", "voided"] as const;

export interface OpenInvoiceCandidate {
  needsInvoice?: boolean | null;
  invoiceNumber?: string | null;
  status: string;
  marketVoidState?: string | null;
}

/**
 * 지금 청구를 기다리는 건인가.
 *
 * invoiceNumber 검사는 status 검사와 겹쳐 보이지만 아니다. Stripe 자동 감지가 꺼져 있는 동안
 * 번호만 수동으로 먼저 채워두는 경우가 있고, 그때도 목록에서 빠져야 한다.
 */
export function isOpenInvoiceRequest(r: OpenInvoiceCandidate): boolean {
  if (!r.needsInvoice) return false;
  if (r.invoiceNumber) return false;
  if (!(OPEN_INVOICE_STATUSES as readonly string[]).includes(r.status)) return false;
  if (r.marketVoidState && (VOID_EXCLUDED_STATES as readonly string[]).includes(r.marketVoidState)) return false;
  return true;
}

/**
 * 이번에 새로 보내는 건 + 이미 열려 있던 건을 합쳐 메일에 실을 전체 목록을 만든다.
 *
 * 발송 경로마다 status 갱신 시점이 달라서 조회 결과에 이번 건이 들어있을 수도, 아닐 수도 있다.
 * 합집합으로 만들면 그 순서에 의존하지 않는다.
 */
export function mergeOpenInvoiceItems(
  newItems: InvoiceEmailItem[],
  openItems: InvoiceEmailItem[],
): { items: InvoiceEmailItem[]; newIds: Set<number> } {
  const newIds = new Set(newItems.map((it) => it.requestId));
  const byId = new Map<number, InvoiceEmailItem>();
  for (const it of openItems) byId.set(it.requestId, it);
  for (const it of newItems) byId.set(it.requestId, it);

  const items = [...byId.values()].sort((a, b) => {
    // 새 건을 위로, 나머지는 오래된 것부터 — 오래 열려 있을수록 급하다.
    const aNew = newIds.has(a.requestId) ? 0 : 1;
    const bNew = newIds.has(b.requestId) ? 0 : 1;
    return aNew - bNew || a.requestId - b.requestId;
  });

  return { items, newIds };
}

/**
 * 인보이스 번호를 새로 기록하면 업무 상태도 invoiced 로 넘겨야 하는가.
 *
 * 번호만 채우고 status 를 두면 "청구 대기"(번호 없음 조건)에서도
 * "최근 청구"(status 조건)에서도 빠져 어느 화면에도 안 뜬다.
 * 이미 번호가 있던 건을 고치는 경우와, 호출자가 status 를 명시한 경우는 건드리지 않는다.
 */
export function shouldMarkInvoicedOnNumberEntry(args: {
  prevStatus: string;
  prevInvoiceNumber: string | null;
  nextInvoiceNumber: string | null | undefined;
  explicitStatus: unknown;
}): boolean {
  if (args.explicitStatus !== undefined) return false;
  if (!args.nextInvoiceNumber?.trim()) return false;
  if (args.prevInvoiceNumber?.trim()) return false;
  return (OPEN_INVOICE_STATUSES as readonly string[]).includes(args.prevStatus);
}

export interface InvoiceEmailOptions {
  /** 이번 메일에서 새로 추가된 요청번호. 생략하면 items 전체를 새 건으로 본다. */
  newIds?: Iterable<number>;
  /** 확인 페이지 링크. 없으면 안내 줄을 통째로 뺀다. */
  viewUrl?: string | null;
}

/**
 * Cailie 에게 보내는 인보이스 요청 메일.
 *
 * items 는 "이번에 새로 생긴 건"이 아니라 **아직 청구가 안 끝난 전체**다. 메일이 여러 통
 * 쌓여도 맨 마지막 것만 열면 현황을 다 알 수 있게 하려는 것 — 이전 메일을 뒤져 대조하는
 * 일이 없어야 한다. 그래서 본문이 "여기 없으면 끝난 것"이라고 명시한다.
 *
 * 같은 요청의 처리 메일은 Jon 에게 따로 가며, 요청번호(#id)로 대조한다.
 */
export function buildInvoiceEmail(
  items: InvoiceEmailItem[],
  options: InvoiceEmailOptions = {},
): { subject: string; body: string } {
  const count = items.length;
  const newIds = options.newIds ? new Set(options.newIds) : new Set(items.map((it) => it.requestId));
  const freshCount = items.filter((it) => newIds.has(it.requestId)).length;

  const lines: string[] = [];
  lines.push(invoiceGreeting());
  lines.push("");

  if (count === 0) {
    lines.push("Nothing is waiting for an invoice right now — you're all caught up.");
    lines.push("");
  } else {
    lines.push("Everything still waiting for an invoice is below.");
    lines.push("This list replaces my earlier emails — anything not listed is already done.");
    lines.push("");
    // 새 건에만 표시를 달고 나머지는 같은 폭으로 들여써서 목록이 한 덩어리로 읽히게 한다.
    for (const it of items) {
      lines.push(`${newIds.has(it.requestId) ? "NEW  " : "     "}${invoiceLine(it)}`);
    }
    lines.push("");
  }

  lines.push("Jon is handling the account processing separately (cc'd).");

  if (options.viewUrl) {
    lines.push("");
    lines.push("See the live list and mark anything you've already invoiced:");
    lines.push(options.viewUrl);
    // Stripe 자동 감지가 최대 하루 늦으므로 사람이 읽고 넘길 여지를 남긴다.
    lines.push("");
    lines.push("If you've already issued one of these, please ignore that line.");
  }

  lines.push("");
  lines.push("Thank you,");
  lines.push("Banghyun");

  return {
    subject:
      `[Snorkl] Invoice Request — ${count} open` +
      (freshCount > 0 && freshCount < count ? ` (${freshCount} new)` : ""),
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
