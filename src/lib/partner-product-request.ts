import { createHash } from 'node:crypto';

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type PartnerTeacherRow = {
  itemId: string;
  teacherName: string;
  accountEmail: string;
  subject: string;
};

export type PartnerBatch =
  | { ok: true; value: {
      requestKind: 'partner_product';
      channel: 'partner';
      operationId: string;
      revision: number;
      mode: 'upsert' | 'cancel';
      schoolName: string;
      schoolNameEn: string;
      items: PartnerTeacherRow[];
      payloadHash: string;
    } }
  | { ok: false; error: string };

export function hashPartnerBatchPayload(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function parsePartnerBatch(input: unknown): PartnerBatch {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Invalid partner request contract' };
  const body = input as Record<string, unknown>;
  const operationId = typeof body.operationId === 'string' ? body.operationId.trim() : '';
  const revision = Number(body.revision);
  const mode = body.mode;
  const schoolName = typeof body.schoolName === 'string' ? body.schoolName.trim() : '';
  const schoolNameEn = typeof body.schoolNameEn === 'string' ? body.schoolNameEn.trim() : '';
  if (body.requestKind !== 'partner_product' || body.channel !== 'partner'
    || !REFERENCE.test(operationId) || !Number.isInteger(revision) || revision < 1
    || (mode !== 'upsert' && mode !== 'cancel') || !schoolName || schoolName.length > 200
    || !schoolNameEn || schoolNameEn.length > 200 || /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(schoolNameEn)) {
    return { ok: false, error: 'Invalid partner request contract' };
  }
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if ((mode === 'upsert' && (rawItems.length < 1 || rawItems.length > 100))
    || (mode === 'cancel' && rawItems.length !== 0)) {
    return { ok: false, error: 'Invalid partner request items' };
  }
  const seenIds = new Set<string>();
  const seenEmails = new Set<string>();
  const items: PartnerTeacherRow[] = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'Invalid teacher rows' };
    const row = raw as Record<string, unknown>;
    const itemId = typeof row.itemId === 'string' ? row.itemId.trim() : '';
    const teacherName = typeof row.teacherName === 'string' ? row.teacherName.trim() : '';
    const accountEmail = typeof row.accountEmail === 'string' ? row.accountEmail.trim().toLowerCase() : '';
    const subject = typeof row.subject === 'string' ? row.subject.trim() : '';
    if (!REFERENCE.test(itemId) || !teacherName || teacherName.length > 100
      || !subject || subject.length > 100 || accountEmail.length > 254
      || !EMAIL.test(accountEmail) || seenIds.has(itemId) || seenEmails.has(accountEmail)) {
      return { ok: false, error: 'Invalid teacher rows' };
    }
    seenIds.add(itemId);
    seenEmails.add(accountEmail);
    items.push({ itemId, teacherName, accountEmail, subject });
  }
  const payloadHash = hashPartnerBatchPayload({
    requestKind: 'partner_product',
    channel: 'partner',
    revision,
    mode,
    schoolName,
    schoolNameEn,
    items,
  });
  return {
    ok: true,
    value: {
      requestKind: 'partner_product',
      channel: 'partner',
      operationId,
      revision,
      mode,
      schoolName,
      schoolNameEn,
      items,
      payloadHash,
    },
  };
}
