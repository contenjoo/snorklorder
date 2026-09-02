// Gmail IMAP 으로 본사 청구 메일을 읽는다 — OAuth 없이 SMTP 발송에 이미 쓰는 앱 비밀번호 재사용.
//
// Gmail OAuth 클라이언트는 시크릿 슬롯이 만석이라(edumarket 이 점유) 새 refresh token 을 만들 수 없다.
// 앱 비밀번호는 IMAP 에도 그대로 통하므로 그 경로로 간다. 읽기만 하고 메일함은 절대 바꾸지 않는다.
import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { extractText, getDocumentProxy } from "unpdf";
import {
  parseInvoicePdfText,
  parseQuickBooksPaymentText,
  type ParsedInvoicePdf,
  type ParsedQuickBooksPayment,
} from "./billing-mail";

export const INVOICE_SENDER_DOMAIN = "snorkl.app";
export const QUICKBOOKS_SENDER = "quickbooks@notification.intuit.com";

const REQUIRED_ENV = ["GMAIL_USER", "GMAIL_APP_PASSWORD"] as const;

export function missingBillingMailEnv(): string[] {
  return REQUIRED_ENV.filter((key) => !process.env[key]?.trim());
}

export type BillingMail =
  | { kind: "invoice"; messageId: string; receivedAt: string; filename: string; invoice: ParsedInvoicePdf }
  | { kind: "payment"; messageId: string; receivedAt: string; subject: string; payment: ParsedQuickBooksPayment };

export interface FetchBillingMailsOptions {
  newerThanDays?: number;
  maxPerKind?: number;
}

function messageIdOf(mail: ParsedMail, uid: number): string {
  return mail.messageId?.trim() || `imap-uid:${uid}`;
}

function receivedAtOf(mail: ParsedMail): string {
  return (mail.date ?? new Date(0)).toISOString();
}

async function pdfText(buffer: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

/**
 * 최근 N일의 ① Cailie 인보이스 PDF 답장 ② QuickBooks 결제 확인을 읽어 파싱한다.
 * 수신 시각 오름차순, 같은 실행 안에서 인보이스가 결제보다 먼저 처리되도록 인보이스를 앞에 둔다.
 * 파싱 실패는 예외가 아니라 warnings 로 돌려준다 — 메일 한 통 때문에 전체가 멈추면 안 된다.
 */
export async function fetchBillingMails(options: FetchBillingMailsOptions = {}): Promise<{ mails: BillingMail[]; warnings: string[] }> {
  const newerThanDays = Math.max(1, options.newerThanDays ?? 14);
  const maxPerKind = Math.min(100, Math.max(1, options.maxPerKind ?? 40));
  const user = process.env.GMAIL_USER?.trim();
  const pass = process.env.GMAIL_APP_PASSWORD?.trim();
  if (!user || !pass) throw new Error("GMAIL_USER/GMAIL_APP_PASSWORD are not configured");

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  const mails: BillingMail[] = [];
  const warnings: string[] = [];
  const since = new Date(Date.now() - newerThanDays * 86_400_000);

  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    const invoiceUids = (await client.search({ since, from: INVOICE_SENDER_DOMAIN }, { uid: true })) || [];
    const paymentUids = (await client.search({ since, from: QUICKBOOKS_SENDER }, { uid: true })) || [];

    for (const uid of invoiceUids.slice(-maxPerKind)) {
      const fetched = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!fetched || !fetched.source) continue;
      const mail = await simpleParser(fetched.source);
      for (const att of mail.attachments || []) {
        const filename = att.filename || "";
        if (att.contentType !== "application/pdf" || !/invoice/i.test(filename)) continue;
        try {
          const invoice = parseInvoicePdfText(await pdfText(att.content));
          if (!invoice) {
            warnings.push(`인보이스 번호를 못 읽음: ${filename}`);
            continue;
          }
          mails.push({ kind: "invoice", messageId: messageIdOf(mail, uid), receivedAt: receivedAtOf(mail), filename, invoice });
        } catch (error) {
          warnings.push(`PDF 파싱 실패: ${filename} — ${error instanceof Error ? error.message : "unknown"}`);
        }
      }
    }

    for (const uid of paymentUids.slice(-maxPerKind)) {
      const fetched = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!fetched || !fetched.source) continue;
      const mail = await simpleParser(fetched.source);
      const subject = mail.subject || "";
      const body = mail.text || (typeof mail.html === "string" ? mail.html : "");
      const payment = parseQuickBooksPaymentText(body, subject);
      if (!payment) {
        // Snorkl 이 아닌 거래처의 QuickBooks 메일은 조용히 지나간다. Snorkl 인데 못 읽은 것만 경고.
        if (/snorkl/i.test(subject)) warnings.push(`결제 확인 메일 파싱 실패: ${subject}`);
        continue;
      }
      mails.push({ kind: "payment", messageId: messageIdOf(mail, uid), receivedAt: receivedAtOf(mail), subject, payment });
    }
  } finally {
    lock.release();
    await client.logout().catch(() => undefined);
  }

  mails.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "invoice" ? -1 : 1;
    return a.receivedAt.localeCompare(b.receivedAt);
  });
  return { mails, warnings };
}
