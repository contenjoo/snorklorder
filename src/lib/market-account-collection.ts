import { createHash } from 'node:crypto';

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const HASH = /^[a-f0-9]{64}$/;
export const COLLECTION_BODY_LIMIT = 128 * 1024;

/** Bound the actual stream as well as Content-Length before parsing customer account data. */
export async function readCollectionBody(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('INVALID_BODY');
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > COLLECTION_BODY_LIMIT)) throw new Error('BODY_TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('INVALID_BODY');
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > COLLECTION_BODY_LIMIT) { await reader.cancel(); throw new Error('BODY_TOO_LARGE'); }
      parts.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}

export type CollectionSource = { kind: 'order'; marketOrderId: string; orderNumber: string } | { kind: 'external' };
export type CollectionSyncItem = {
  itemKey: string; marketRequestId: string; idempotencyKey: string;
  accountType: 'teacher' | 'admin'; quantity: number; emails: string[]; planName: string;
};
export type CollectionSyncBatch = {
  collectionId: string; submissionHash: string; schoolName: string; draftOnly: true;
  source: CollectionSource; items: CollectionSyncItem[]; payloadHash: string;
};
export type CollectionRequestIdentity = { itemKey: string; marketRequestId: string; requestId: number };

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, names: string[]) {
  return Object.keys(value).length === names.length && Object.keys(value).every(key => names.includes(key));
}
function reference(value: unknown): value is string { return typeof value === 'string' && REFERENCE.test(value); }
function text(value: unknown, maximum: number): string | null {
  return typeof value === 'string' && value.trim() && value.trim().length <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : null;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (record(value)) return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export function collectionPayloadHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export function collectionIdempotencyKey(collectionId: string, submissionHash: string) {
  return `market:snorkl:collection:${collectionId}:${submissionHash}`;
}

/** A collection is a single immutable submission; this is deliberately not a revision/upsert API. */
export function parseCollectionSync(input: unknown, collectionId: string):
  { ok: true; value: CollectionSyncBatch } | { ok: false; error: string } {
  const fail = () => ({ ok: false as const, error: 'INVALID_COLLECTION_CONTRACT' });
  if (!reference(collectionId) || !record(input)
    || !exactKeys(input, ['collectionId', 'submissionHash', 'schoolName', 'draftOnly', 'source', 'items'])
    || input.collectionId !== collectionId || typeof input.submissionHash !== 'string' || !HASH.test(input.submissionHash)
    || input.draftOnly !== true || !record(input.source)) return fail();
  const schoolName = text(input.schoolName, 200);
  if (!schoolName) return fail();
  let source: CollectionSource;
  if (input.source.kind === 'order' && exactKeys(input.source, ['kind', 'marketOrderId', 'orderNumber'])
    && reference(input.source.marketOrderId) && reference(input.source.orderNumber)) {
    // The company-order path must not bypass the existing S2B exclusion using a collection.
    if (input.source.orderNumber.toLowerCase().startsWith('s2b-')) return { ok: false, error: 'SCHOOL_STORE_ORDER_REQUIRES_EXTERNAL_COLLECTION' };
    source = { kind: 'order', marketOrderId: input.source.marketOrderId, orderNumber: input.source.orderNumber };
  } else if (input.source.kind === 'external' && exactKeys(input.source, ['kind'])) source = { kind: 'external' };
  else return fail();
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 30) return fail();
  const seenKeys = new Set<string>(), seenIds = new Set<string>(), seenIdempotency = new Set<string>(), seenEmails = new Set<string>();
  const items: CollectionSyncItem[] = [];
  const prefix = source.kind === 'order'
    ? `market:snorkl:draft:${source.marketOrderId}:` : `market:snorkl:collection:${collectionId}:`;
  for (const raw of input.items) {
    if (!record(raw) || !exactKeys(raw, ['itemKey', 'marketRequestId', 'idempotencyKey', 'accountType', 'quantity', 'emails', 'planName'])
      || !reference(raw.itemKey) || !reference(raw.marketRequestId) || typeof raw.idempotencyKey !== 'string'
      || !raw.idempotencyKey.startsWith(prefix) || !/^(0|[1-9]\d*)$/.test(raw.idempotencyKey.slice(prefix.length))
      || Number(raw.idempotencyKey.slice(prefix.length)) > 29 || !text(raw.planName, 200)
      || (raw.accountType !== 'teacher' && raw.accountType !== 'admin')
      || !Number.isInteger(raw.quantity) || Number(raw.quantity) < 1 || Number(raw.quantity) > 200
      || !Array.isArray(raw.emails) || raw.emails.length !== raw.quantity
      || (raw.accountType === 'admin' && raw.quantity !== 1)
      || seenKeys.has(raw.itemKey) || seenIds.has(raw.marketRequestId) || seenIdempotency.has(raw.idempotencyKey)) return fail();
    const emails: string[] = [];
    for (const value of raw.emails) {
      if (typeof value !== 'string') return fail();
      const email = value.trim().toLowerCase();
      if (email.length > 254 || !EMAIL.test(email) || seenEmails.has(email)) return fail();
      seenEmails.add(email); emails.push(email);
    }
    if (seenEmails.size > 200) return fail();
    seenKeys.add(raw.itemKey); seenIds.add(raw.marketRequestId); seenIdempotency.add(raw.idempotencyKey);
    items.push({ itemKey: raw.itemKey, marketRequestId: raw.marketRequestId, idempotencyKey: raw.idempotencyKey,
      accountType: raw.accountType, quantity: Number(raw.quantity), emails: emails.sort(), planName: text(raw.planName, 200)! });
  }
  items.sort((a, b) => a.itemKey.localeCompare(b.itemKey));
  const normalized = { collectionId, submissionHash: input.submissionHash, schoolName, draftOnly: true as const, source, items };
  return { ok: true, value: { ...normalized, payloadHash: collectionPayloadHash(normalized) } };
}

/** Global account locks serialize different collections before the duplicate-account lookup. */
export function collectionLockKeys(batch: CollectionSyncBatch): string[] {
  const school = batch.schoolName.trim().toLowerCase();
  const keys = [`collection:${batch.collectionId}`, ...batch.items.flatMap(item => item.emails.map(email => `account:${school}:${email}`))];
  if (batch.source.kind === 'order') keys.push(`order:${batch.source.marketOrderId}`);
  // UTF-8 byte order matches the database trigger's COLLATE "C" ordering.
  return [...new Set(keys)].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}

export function collectionOriginAllowed(requestUrl: string, origin: string | null): boolean {
  if (origin === null) return true; // Authenticated machine callers have no browser Origin.
  return [new URL(requestUrl).origin, 'https://edtech.ai.kr', 'https://xn--2e0bz2l3qez0ob2mnib.com'].includes(origin);
}

/** Only fixed trigger codes are exposed; SQL text and account parameters never leave this classifier. */
export function collectionWriteErrorCode(error: unknown): 'DUPLICATE_ACCOUNT_REQUEST' | 'COLLECTION_IDENTITY_CONFLICT' | null {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    const value = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (value.code === '23505' && (value.message === 'DUPLICATE_ACCOUNT_REQUEST' || value.message === 'COLLECTION_IDENTITY_CONFLICT')) return value.message;
    current = value.cause;
  }
  return null;
}
