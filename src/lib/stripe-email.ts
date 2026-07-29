// Stripe 인보이스/영수증 Gmail 자동 감지 — snorkl-manager(lib/gmail.ts + lib/gmail-sync.ts) 이식.
// Google Sheets 의존은 전부 제거하고, DB 반영은 라우트(sync-stripe)에서 수행.
// 이 파일은 ① Gmail 조회/본문 파싱 ② 파싱 결과 ↔ account_requests 매칭 판단(순수 함수)만 담당.
import { google } from "googleapis";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StripeInvoiceData {
  invoiceNumber: string; // "#3D3776B4-0120" (못 찾으면 "")
  amount: string; // "$240.00" (못 찾으면 "")
  dueDate: string; // "April 22, 2026" (영문 원본 — toIsoDate 로 변환)
  paymentLink: string; // "https://invoice.stripe.com/..." (필수)
}

export interface StripeReceiptData {
  invoiceNumber: string; // 영수증 본문에 인보이스 번호가 있으면 추출 (없으면 "")
  amount: string; // "$240.00" (필수)
  paymentMethod: string; // "MasterCard ••6135" (못 찾으면 "")
  paymentDate: string; // "March 23, 2026" (못 찾으면 "")
}

export type StripeEmailType = "invoice" | "receipt" | "unknown";

export type ParsedStripeEmail =
  | { type: "invoice"; messageId: string; threadId: string; internalDate: string | null; invoice: StripeInvoiceData }
  | { type: "receipt"; messageId: string; threadId: string; internalDate: string | null; receipt: StripeReceiptData };

// ─── Gmail OAuth env ─────────────────────────────────────────────────────────

// snorkl-manager 와 동일한 키 이름 사용 (Gmail OAuth2 readonly)
const REQUIRED_GMAIL_ENV = ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"] as const;

export function missingGmailEnv(): string[] {
  return REQUIRED_GMAIL_ENV.filter((key) => !process.env[key]?.trim());
}

// ─── HTML Utility ────────────────────────────────────────────────────────────

/** HTML 태그 제거 + 흔한 엔티티 디코드 + 공백 정규화 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Classification ──────────────────────────────────────────────────────────

/**
 * Stripe 이메일을 invoice / receipt / unknown 으로 분류.
 * "Snorkl" 키워드로 다른 서비스(Paldet 등) 메일은 걸러냄.
 */
function classifyStripeEmail(body: string): StripeEmailType {
  if (!/snorkl/i.test(body)) return "unknown";
  if (body.includes("Pay this invoice")) return "invoice";
  if (body.includes("View purchase")) return "receipt";
  return "unknown";
}

// ─── 공통 파싱 조각 ──────────────────────────────────────────────────────────

const MONTHS =
  "January|February|March|April|May|June|July|August|September|October|November|December";

const MONTH_INDEX: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** "April 22, 2026" → "2026-04-22". 변환 불가 시 null. */
export function toIsoDate(englishDate: string): string | null {
  const m = englishDate.match(new RegExp(`(${MONTHS})\\s+(\\d{1,2}),?\\s*(\\d{4})`, "i"));
  if (!m) return null;
  const month = MONTH_INDEX[m[1].toLowerCase()];
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (!month || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 금액 문자열 비교용 정규화: "$1,240.00" → "1240.00" */
function normalizeAmount(amount: string | null | undefined): string {
  return (amount || "").replace(/[$,\s]/g, "");
}

/** 인보이스 번호 비교용 정규화: "#3d3776b4-0120" → "3D3776B4-0120" */
function normalizeInvoiceNumber(num: string | null | undefined): string {
  return (num || "").replace(/^#/, "").trim().toUpperCase();
}

function extractInvoiceNumber(stripped: string, body: string): string {
  const invPatterns = [
    /Invoice\s*#([A-Z0-9]+-[A-Z0-9]+)/i,
    /#([A-Z0-9]{6,}-[A-Z0-9]{4})/i,
    /Invoice\s+number\s*[:\s]*#?([A-Z0-9]+-[A-Z0-9]+)/i,
    /invoice[^A-Z0-9]*([A-Z0-9]{6,}-[A-Z0-9]{2,})/i,
  ];
  for (const pattern of invPatterns) {
    const m = stripped.match(pattern) || body.match(pattern);
    if (m) return `#${m[1]}`;
  }
  return "";
}

// ─── Invoice Parsing ─────────────────────────────────────────────────────────

/**
 * Stripe 인보이스 이메일 본문(HTML/텍스트)을 구조화 데이터로 파싱.
 * 핵심 필드인 paymentLink 를 못 찾으면 null.
 */
function parseInvoiceEmail(body: string): StripeInvoiceData | null {
  const stripped = stripHtml(body);

  // --- 결제 링크 (필수) ---
  // Stripe 는 URL 을 트래킹 리다이렉트로 감싸는 경우가 있음:
  //   https://58.email.stripe.com/CL0/https:%2F%2Fpay.stripe.com%2Finvoice%2F...
  let paymentLink = "";

  // 1. pay.stripe.com / invoice.stripe.com 직접 URL
  const directMatch =
    body.match(/https?:\/\/(?:pay|invoice)\.stripe\.com\/[^\s"'<>]+/) ||
    stripped.match(/https?:\/\/(?:pay|invoice)\.stripe\.com\/[^\s"'<>]+/);
  if (directMatch) paymentLink = directMatch[0];

  // 2. 트래킹 래퍼 내부에서 추출
  if (!paymentLink) {
    const wrappedMatch = body.match(
      /https?:\/\/\d+\.email\.stripe\.com\/[^\s"'<>]*(?:pay|invoice)\.stripe\.com[^\s"'<>]*/
    );
    if (wrappedMatch) {
      const decoded = decodeURIComponent(wrappedMatch[0]);
      const innerMatch = decoded.match(/https?:\/\/(?:pay|invoice)\.stripe\.com\/[^\s"'<>]+/);
      // 내부 URL 을 못 풀면 트래킹 URL 자체를 사용 (실제 링크로 리다이렉트됨)
      paymentLink = innerMatch ? innerMatch[0] : wrappedMatch[0];
    }
  }

  // 3. href 속성에서 추출
  if (!paymentLink) {
    const hrefMatch = body.match(/href="([^"]*(?:pay|invoice)\.stripe\.com[^"]*)"/i);
    if (hrefMatch) paymentLink = hrefMatch[1];
  }

  if (!paymentLink) return null;

  // --- 인보이스 번호 ---
  const invoiceNumber = extractInvoiceNumber(stripped, body);

  // --- 금액 ---
  let amount = "";
  const amountPatterns = [
    /(?:Total\s+due|Amount\s+due)[^$]*(\$[\d,]+\.\d{2})/i,
    /(\$[\d,]+\.\d{2})\s*(?:due|total)/i,
    /(\$[\d,]+\.\d{2})/,
  ];
  for (const pattern of amountPatterns) {
    const m = stripped.match(pattern) || body.match(pattern);
    if (m) {
      amount = m[1];
      break;
    }
  }

  // --- 결제 기한 ---
  let dueDate = "";
  const dueDatePatterns = [
    new RegExp(`Due\\s+(${MONTHS})\\s+(\\d{1,2}),?\\s*(\\d{4})`, "i"),
    new RegExp(`Due\\s+date[:\\s]*(${MONTHS})\\s+(\\d{1,2}),?\\s*(\\d{4})`, "i"),
    new RegExp(`Due\\s+(\\d{1,2})\\s+(${MONTHS}),?\\s*(\\d{4})`, "i"),
  ];
  for (let i = 0; i < dueDatePatterns.length; i++) {
    const m = stripped.match(dueDatePatterns[i]) || body.match(dueDatePatterns[i]);
    if (m) {
      // 세 번째 패턴만 "Day Month Year" 순서
      dueDate = i === 2 ? `${m[2]} ${m[1]}, ${m[3]}` : `${m[1]} ${m[2]}, ${m[3]}`;
      break;
    }
  }

  return { invoiceNumber, amount, dueDate, paymentLink };
}

// ─── Receipt Parsing ─────────────────────────────────────────────────────────

/**
 * Stripe 영수증(결제 확인) 이메일 본문을 구조화 데이터로 파싱.
 * 금액을 못 찾으면 null.
 */
function parseReceiptEmail(body: string): StripeReceiptData | null {
  const stripped = stripHtml(body);

  // --- 금액 (필수) — "Snorkl" 주변 500자 창에서 우선 탐색 ---
  let amount = "";
  const snorklIdx = stripped.toLowerCase().indexOf("snorkl");
  if (snorklIdx !== -1) {
    const windowStart = Math.max(0, snorklIdx - 500);
    const windowEnd = Math.min(stripped.length, snorklIdx + 500);
    const nearbyAmount = stripped.substring(windowStart, windowEnd).match(/\$[\d,]+\.\d{2}/);
    if (nearbyAmount) amount = nearbyAmount[0];
  }
  if (!amount) {
    const fallbackAmount = stripped.match(/\$[\d,]+\.\d{2}/);
    if (fallbackAmount) amount = fallbackAmount[0];
  }
  if (!amount) return null;

  // --- 인보이스 번호 (영수증에 있으면 매칭 정확도 향상용으로 추출) ---
  const invoiceNumber = extractInvoiceNumber(stripped, body);

  // --- 결제 수단 ---
  let paymentMethod = "";
  const pmPatterns = [
    /(Visa|MasterCard|Amex|American Express|Discover)\s*[•·.\-–]+\s*(\d{4})/i,
    /(Visa|MasterCard|Amex|American Express|Discover)\s*(?:ending\s+in\s*)?(\d{4})/i,
    /(Visa|MasterCard|Amex|American Express|Discover)[^0-9]*(\d{4})/i,
  ];
  for (const pattern of pmPatterns) {
    const m = stripped.match(pattern) || body.match(pattern);
    if (m) {
      paymentMethod = `${m[1]} ••${m[2]}`;
      break;
    }
  }

  // --- 결제일 ---
  let paymentDate = "";
  const datePatterns = [
    new RegExp(`Date[:\\s]+(${MONTHS})\\s+(\\d{1,2}),?\\s*(\\d{4})`, "i"),
    new RegExp(`(?:Payment|Paid|Charged)\\s+(?:on\\s+)?(${MONTHS})\\s+(\\d{1,2}),?\\s*(\\d{4})`, "i"),
    new RegExp(`(${MONTHS})\\s+(\\d{1,2}),?\\s*(\\d{4})`, "i"),
  ];
  for (const pattern of datePatterns) {
    const m = stripped.match(pattern) || body.match(pattern);
    if (m) {
      paymentDate = `${m[1]} ${m[2]}, ${m[3]}`;
      break;
    }
  }

  return { invoiceNumber, amount, paymentMethod, paymentDate };
}

// ─── Gmail 조회 ──────────────────────────────────────────────────────────────

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

interface GmailPayloadPart {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: GmailPayloadPart[] | null;
}

function getEmailBody(payload: GmailPayloadPart): string {
  if (payload.body?.data) return decodeBase64Url(payload.body.data);

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) return decodeBase64Url(part.body.data);
    }
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) return decodeBase64Url(part.body.data);
    }
    for (const part of payload.parts) {
      if (part.parts) {
        const nested = getEmailBody(part);
        if (nested) return nested;
      }
    }
  }

  return "";
}

function getGmailClient() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Gmail OAuth credentials are not configured");
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

/**
 * Gmail 에서 Stripe/Snorkl 메일을 검색해 인보이스/영수증으로 파싱.
 * internalDate(수신 시각, epoch ms 문자열) 오름차순으로 반환 — 같은 실행 안에서
 * 인보이스 → 영수증 순서로 상태가 자연스럽게 이어지도록.
 */
export async function fetchStripeEmails(options: { newerThanDays?: number; maxResults?: number } = {}): Promise<ParsedStripeEmail[]> {
  const newerThanDays = options.newerThanDays ?? 7;
  const maxResults = options.maxResults ?? 20;
  const gmail = getGmailClient();

  const searchRes = await gmail.users.messages.list({
    userId: "me",
    q: `from:stripe.com "Snorkl" newer_than:${newerThanDays}d`,
    maxResults,
  });

  const messages = searchRes.data.messages || [];
  const parsed: ParsedStripeEmail[] = [];

  for (const msg of messages) {
    if (!msg.id) continue;

    const fullMsg = await gmail.users.messages.get({ userId: "me", id: msg.id, format: "full" });
    const payload = fullMsg.data.payload;
    if (!payload) continue;

    const rawBody = getEmailBody(payload as GmailPayloadPart);
    if (!rawBody) continue;

    const base = {
      messageId: msg.id,
      threadId: fullMsg.data.threadId || "",
      internalDate: fullMsg.data.internalDate || null,
    };

    const emailType = classifyStripeEmail(rawBody);
    if (emailType === "invoice") {
      const invoice = parseInvoiceEmail(rawBody);
      if (invoice) parsed.push({ type: "invoice", ...base, invoice });
    } else if (emailType === "receipt") {
      const receipt = parseReceiptEmail(rawBody);
      if (receipt) parsed.push({ type: "receipt", ...base, receipt });
    }
  }

  parsed.sort((a, b) => Number(a.internalDate || 0) - Number(b.internalDate || 0));
  return parsed;
}

// ─── account_requests 매칭 (순수 함수) ───────────────────────────────────────
// 구 앱(matchEmailToRequest)은 금액 비교 없이 최신 요청에 무조건 붙이는 결함이 있었음.
// 새 로직: ① invoice_number 가 이미 기록된 요청 우선 ② 아니면 금액 일치 + 단일 후보일 때만.
// 후보 0개/2개 이상/금액 불일치는 매칭하지 않고 unmatched 로 보고.

export interface MatchableRequest {
  id: number;
  status: string;
  invoiceNumber: string | null;
  invoiceAmount: string | null;
  paymentDate: string | null;
}

export type MatchResult =
  | { kind: "matched"; requestId: number; via: "invoice_number" | "amount" }
  | { kind: "already_synced"; requestId: number }
  | { kind: "unmatched"; reason: string };

/** 인보이스 메일 → status='processed' 요청 매칭 */
export function matchInvoice(invoice: StripeInvoiceData, requests: MatchableRequest[]): MatchResult {
  const invNum = normalizeInvoiceNumber(invoice.invoiceNumber);

  // ① 동일 invoice_number 가 이미 기록된 요청 우선
  if (invNum) {
    const byNumber = requests.find((r) => normalizeInvoiceNumber(r.invoiceNumber) === invNum);
    if (byNumber) {
      // processed 상태면 (수동 선기입 등) 이 요청으로 확정, 이미 invoiced/paid 면 재실행 중복 — 스킵
      return byNumber.status === "processed"
        ? { kind: "matched", requestId: byNumber.id, via: "invoice_number" }
        : { kind: "already_synced", requestId: byNumber.id };
    }
  }

  // ② 금액 일치 + 단일 후보
  const amount = normalizeAmount(invoice.amount);
  if (!amount) {
    return { kind: "unmatched", reason: "인보이스 금액 파싱 실패 — 수동 확인 필요" };
  }
  const candidates = requests.filter(
    (r) => r.status === "processed" && normalizeAmount(r.invoiceAmount) === amount
  );
  // invoice_amount 는 인보이스 수신 전엔 비어있는 게 정상 → 미기입 processed 요청도 후보에 포함하되,
  // 금액이 기입돼 있으면 반드시 일치해야 함.
  const blankCandidates = requests.filter((r) => r.status === "processed" && !r.invoiceAmount?.trim());
  const pool = candidates.length > 0 ? candidates : blankCandidates;

  if (pool.length === 1) {
    return { kind: "matched", requestId: pool[0].id, via: "amount" };
  }
  if (pool.length === 0) {
    return { kind: "unmatched", reason: "금액 일치하는 processed 요청 없음" };
  }
  return { kind: "unmatched", reason: `후보 ${pool.length}개 — 단일 확정 불가` };
}

/** 결제 영수증 메일 → status='invoiced' 요청 매칭 */
export function matchReceipt(receipt: StripeReceiptData, requests: MatchableRequest[]): MatchResult {
  const invNum = normalizeInvoiceNumber(receipt.invoiceNumber);

  // ① 영수증에 인보이스 번호가 있으면 그 번호가 기록된 요청 우선
  if (invNum) {
    const byNumber = requests.find((r) => normalizeInvoiceNumber(r.invoiceNumber) === invNum);
    if (byNumber) {
      if (byNumber.status === "invoiced") {
        return { kind: "matched", requestId: byNumber.id, via: "invoice_number" };
      }
      if (byNumber.status === "paid") {
        return { kind: "already_synced", requestId: byNumber.id };
      }
      return {
        kind: "unmatched",
        reason: `인보이스 번호 일치하지만 상태가 ${byNumber.status} — 수동 확인 필요`,
      };
    }
  }

  // ② 금액 일치 + 단일 후보
  const amount = normalizeAmount(receipt.amount);
  const candidates = requests.filter(
    (r) => r.status === "invoiced" && normalizeAmount(r.invoiceAmount) === amount
  );
  if (candidates.length === 1) {
    return { kind: "matched", requestId: candidates[0].id, via: "amount" };
  }
  if (candidates.length === 0) {
    // 재실행 중복 가능성: 같은 금액이 이미 paid 로 넘어가 있으면 스킵으로 처리
    const alreadyPaid = requests.find(
      (r) => r.status === "paid" && r.paymentDate && normalizeAmount(r.invoiceAmount) === amount
    );
    if (alreadyPaid) return { kind: "already_synced", requestId: alreadyPaid.id };
    return { kind: "unmatched", reason: "금액 일치하는 invoiced 요청 없음" };
  }
  return { kind: "unmatched", reason: `후보 ${candidates.length}개 — 단일 확정 불가` };
}
