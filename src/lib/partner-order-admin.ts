export type PartnerOrderRow = {
  id: number;
  schoolName: string;
  schoolNameEn: string | null;
  emails: string;
  teacherName: string | null;
  subject: string | null;
  updatedAt: Date | string;
  status: string;
  processingEmailSendStartedAt: Date | string | null;
  processingEmailSentAt: Date | string | null;
  invoiceEmailSendStartedAt: Date | string | null;
  invoiceEmailSentAt: Date | string | null;
  confirmedAt: Date | string | null;
  invoiceNumber: string | null;
  paymentDate: string | null;
};

// Browser and server compare the complete application, even when the list is filtered.
export function partnerOrderVersion(rows: PartnerOrderRow[]) {
  return JSON.stringify([...rows].sort((a, b) => a.id - b.id).map((row) => [
    row.id, new Date(row.updatedAt).toISOString(), row.schoolName, row.schoolNameEn,
    row.emails, row.teacherName, row.subject,
  ]));
}

export function partnerOrderLocked(rows: PartnerOrderRow[]) {
  return rows.some((row) => row.status !== "draft" || row.processingEmailSendStartedAt
    || row.processingEmailSentAt || row.invoiceEmailSendStartedAt || row.invoiceEmailSentAt
    || row.confirmedAt || row.invoiceNumber || row.paymentDate);
}

export function parsePartnerOrderEdit(input: unknown, ids: number[]) {
  if (!input || typeof input !== "object") return null;
  const body = input as Record<string, unknown>;
  const schoolName = typeof body.schoolName === "string" ? body.schoolName.trim() : "";
  const schoolNameEn = typeof body.schoolNameEn === "string" ? body.schoolNameEn.trim() : "";
  if (!schoolName || schoolName.length > 200 || !schoolNameEn || schoolNameEn.length > 200
    || /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(schoolNameEn) || !Array.isArray(body.items)
    || body.items.length !== ids.length) return null;
  const seen = new Set<number>();
  const emails = new Set<string>();
  const items: { id: number; teacherName: string; subject: string; emails: string }[] = [];
  for (const item of body.items) {
    if (!item || typeof item !== "object") return null;
    const id = item.id;
    const teacherName = typeof item.teacherName === "string" ? item.teacherName.trim() : "";
    const subject = typeof item.subject === "string" ? item.subject.trim() : "";
    const email = typeof item.emails === "string" ? item.emails.trim().toLowerCase() : "";
    if (!ids.includes(id) || seen.has(id) || !teacherName || teacherName.length > 100
      || !subject || subject.length > 100 || email.length > 254
      || !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email) || emails.has(email)) return null;
    seen.add(id);
    emails.add(email);
    items.push({ id, teacherName, subject, emails: email });
  }
  return { schoolName, schoolNameEn, items };
}
