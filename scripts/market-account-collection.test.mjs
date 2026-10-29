import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  COLLECTION_BODY_LIMIT, collectionIdempotencyKey, collectionLockKeys, collectionOriginAllowed,
  collectionPayloadHash, collectionWriteErrorCode, parseCollectionSync, readCollectionBody,
} from '../src/lib/market-account-collection.ts';
import { syncAccountCollection } from '../src/lib/market-account-collection-service.ts';
import { classifyMarketReplay, hashMarketPayload } from '../src/lib/market-account-request.ts';
import { authorizeMarketStatusRequest } from '../src/lib/market-status.ts';

const body = (overrides = {}) => ({
  collectionId: 'collection-123', submissionHash: 'a'.repeat(64), schoolName: '테스트중학교', draftOnly: true,
  source: { kind: 'order', marketOrderId: 'order-123', orderNumber: 'ORD-123' },
  items: [{ itemKey: 'item-1', marketRequestId: 'request-123', idempotencyKey: 'market:snorkl:draft:order-123:0',
    accountType: 'teacher', quantity: 2, emails: ['b@school.kr', 'a@school.kr'], planName: 'Teacher Team' }],
  ...overrides,
});
const externalBody = (id = 'external-123', emails = ['a@school.kr']) => body({ collectionId: id, source: { kind: 'external' },
  items: [{ itemKey: 'standalone', marketRequestId: `local-${id}`, idempotencyKey: `market:snorkl:collection:${id}:0`,
    accountType: 'teacher', quantity: emails.length, emails, planName: 'Teacher Team' }] });
const batch = value => {
  const parsed = parseCollectionSync(value, value.collectionId);
  assert.equal(parsed.ok, true, parsed.error);
  return parsed.value;
};
const row = (overrides = {}) => ({
  id: 1, schoolName: '테스트중학교', type: 'upgrade', externalSource: 'market', marketRequestId: 'request-123',
  idempotencyKey: 'market:snorkl:draft:order-123:0', marketOrderId: 'order-123', orderNumber: 'ORD-123',
  marketCollectionId: null,
  draftOnly: true, status: 'draft', channel: 'company', emails: 'contact@school.kr', quantity: 1, accountType: 'teacher',
  externalPayloadHash: hashMarketPayload({ emails: ['contact@school.kr'] }),
  archivedAt: null, confirmedAt: null, confirmToken: null, processingEmailSendStartedAt: null,
  processingEmailSentAt: null, invoiceEmailSendStartedAt: null, invoiceEmailSentAt: null,
  invoiceGmailMessageId: null, receiptGmailMessageId: null, invoiceNumber: null, invoiceAmount: null,
  invoiceDueDate: null, paymentLink: null, paymentDate: null, paymentMethod: null, ...overrides,
});

/** Atomic serial store models the transaction boundary; production PostgreSQL locks are tested separately. */
class MemoryStore {
  constructor(requests = [row()]) {
    this.state = { rows: requests, ledgers: [], fences: [{ id: 'order-123', state: 'active', orderNumber: 'ORD-123' }], nextId: 100 };
    this.tail = Promise.resolve(); this.writes = 0; this.locks = []; this.failId = null;
  }
  async transaction(action) {
    const prior = this.tail;
    let release;
    this.tail = new Promise(resolve => { release = resolve; });
    await prior;
    const data = structuredClone(this.state);
    let writes = 0;
    const tx = {
      lockResources: async keys => { this.locks.push(keys); },
      readLedger: async id => data.ledgers.find(value => value.collectionId === id),
      ensureOrderFence: async (id, orderNumber) => {
        if (!data.fences.some(value => value.id === id)) data.fences.push({ id, orderNumber, state: 'active' });
        return data.fences.find(value => value.id === id);
      },
      findIdentities: async items => data.rows.filter(value => items.some(item => item.marketRequestId === value.marketRequestId || item.idempotencyKey === value.idempotencyKey)),
      readRequests: async ids => data.rows.filter(value => ids.includes(value.id)),
      hasPreviousSubmission: async ids => data.ledgers.some(ledger => ledger.requestIds.some(value => ids.includes(value.requestId))),
      hasOpenDuplicate: async (schoolName, emails, excludingIds) => data.rows.some(value => !excludingIds.includes(value.id)
        && value.schoolName.trim().toLowerCase() === schoolName.toLowerCase() && value.type === 'upgrade'
        && ['draft', 'sent', 'invoiced', 'paid'].includes(value.status) && !value.archivedAt && !value.confirmedAt
        && value.emails.toLowerCase().split(/[,;\s]+/).some(email => emails.includes(email))),
      updateRequest: async (id, values) => {
        if (this.failId === id) throw new Error('simulated connection failure');
        Object.assign(data.rows.find(value => value.id === id), values); writes++;
      },
      createRequest: async (value, item, values) => {
        const id = data.nextId++;
        data.rows.push(row({ id, ...values, schoolName: value.schoolName, marketRequestId: item.marketRequestId,
          idempotencyKey: item.idempotencyKey, externalSource: value.source.kind === 'order' ? 'market' : 'market_collection',
          channel: value.source.kind === 'order' ? 'company' : 'school_store',
          marketOrderId: value.source.kind === 'order' ? value.source.marketOrderId : null,
          orderNumber: value.source.kind === 'order' ? value.source.orderNumber : null }));
        writes++; return id;
      },
      insertLedger: async ledger => { data.ledgers.push(ledger); writes++; },
    };
    try {
      const result = await action(tx);
      this.state = data; this.writes += writes;
      return result;
    } finally { release(); }
  }
}
const conflict = code => error => error.code === code;

test('collection contract normalizes account emails and preserves a stable payload hash', () => {
  const first = batch(body());
  const normalized = body(); normalized.items[0].emails = [' A@SCHOOL.KR ', 'b@school.kr'];
  assert.equal(batch(normalized).payloadHash, first.payloadHash);
  assert.deepEqual(first.items[0].emails, ['a@school.kr', 'b@school.kr']);
  assert.equal(collectionIdempotencyKey(first.collectionId, first.submissionHash), `market:snorkl:collection:collection-123:${'a'.repeat(64)}`);
  assert.equal(parseCollectionSync(body(), 'different-collection').ok, false);
});

test('collection rejects invalid quantity, School account count, batch duplicates, source and identity', () => {
  for (const mutate of [
    value => { value.draftOnly = false; }, value => { value.submissionHash = 'bad'; },
    value => { value.source.marketOrderId = ''; }, value => { value.source.orderNumber = 's2b-123'; },
    value => { value.items[0].quantity = 1; }, value => { value.items[0].accountType = 'admin'; },
    value => { value.items[0].emails = ['bad', 'a@school.kr']; },
    value => { value.items[0].emails = ['a@school.kr', 'A@school.kr']; },
    value => { value.items[0].idempotencyKey = 'unrelated-key'; },
    value => { value.items[0].idempotencyKey = 'market:snorkl:draft:order-123:30'; },
    value => { value.items[0].marketRequestId = 'not allowed'; },
    value => { value.extra = 'ignored'; }, value => { value.source.kind = 'partner'; },
  ]) {
    const value = body(); mutate(value); assert.equal(parseCollectionSync(value, value.collectionId).ok, false);
  }
  const value = body();
  value.items.push({ ...value.items[0], itemKey: 'item-2', marketRequestId: 'request-456', idempotencyKey: 'market:snorkl:draft:order-123:1' });
  assert.equal(parseCollectionSync(value, value.collectionId).ok, false);
  const tooMany = externalBody('large', Array.from({ length: 201 }, (_, i) => `a${i}@school.kr`));
  assert.equal(parseCollectionSync(tooMany, tooMany.collectionId).ok, false);
  assert.equal(parseCollectionSync({ ...body(), items: Array(31).fill(body().items[0]) }, 'collection-123').ok, false);
});

test('body reader bounds Content-Length and the actual chunked stream; Origin and machine auth fail closed', async () => {
  const request = new Request('https://receiver.invalid', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body()) });
  assert.equal((await readCollectionBody(request)).collectionId, 'collection-123');
  await assert.rejects(readCollectionBody(new Request('https://receiver.invalid', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Content-Length': String(COLLECTION_BODY_LIMIT + 1) }, body: '{}' })), /BODY_TOO_LARGE/);
  await assert.rejects(readCollectionBody(new Request('https://receiver.invalid', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: ' '.repeat(COLLECTION_BODY_LIMIT + 1) })), /BODY_TOO_LARGE/);
  await assert.rejects(readCollectionBody(new Request('https://receiver.invalid', { method: 'PUT', body: '{}' })), /INVALID_BODY/);
  assert.equal(collectionOriginAllowed('https://receiver.invalid/path', null), true);
  assert.equal(collectionOriginAllowed('https://receiver.invalid/path', 'https://edtech.ai.kr'), true);
  assert.equal(collectionOriginAllowed('https://receiver.invalid/path', 'https://evil.invalid'), false);
  assert.equal(authorizeMarketStatusRequest(null, 'test-key').ok, false);
  assert.equal(authorizeMarketStatusRequest('wrong-key', 'test-key').ok, false);
  assert.equal(authorizeMarketStatusRequest('test-key', undefined).ok, false);
  assert.equal(collectionWriteErrorCode({ cause: { code: '23505', message: 'DUPLICATE_ACCOUNT_REQUEST' } }), 'DUPLICATE_ACCOUNT_REQUEST');
  assert.equal(collectionWriteErrorCode({ code: '23505', message: 'unrelated SQL with account parameters' }), null);
});

test('existing order draft receives real accounts without creating another request or changing identity', async () => {
  const store = new MemoryStore();
  const original = structuredClone(store.state.rows[0]);
  const result = await syncAccountCollection(batch(body()), store);
  assert.deepEqual(result, { requests: [{ itemKey: 'item-1', marketRequestId: 'request-123', requestId: 1 }], duplicate: false });
  assert.equal(store.state.rows.length, 1);
  assert.equal(store.state.rows[0].emails, 'a@school.kr, b@school.kr');
  assert.equal(store.state.rows[0].quantity, 2);
  for (const field of ['externalSource', 'marketRequestId', 'idempotencyKey', 'marketOrderId', 'orderNumber', 'status']) assert.equal(store.state.rows[0][field], original[field]);
  assert.equal(classifyMarketReplay(store.state.rows[0].externalPayloadHash, original.externalPayloadHash), 'conflict', 'late old-contact create must conflict');
});

test('same submission replays the original IDs after processing/payment without writing; mutated identity is rejected', async () => {
  const store = new MemoryStore();
  const input = batch(body());
  const first = await syncAccountCollection(input, store);
  store.state.rows[0].status = 'paid'; store.state.rows[0].confirmedAt = new Date(); store.state.fences[0].state = 'non_voidable';
  const writes = store.writes;
  assert.deepEqual(await syncAccountCollection(input, store), { ...first, duplicate: true });
  assert.equal(store.writes, writes);
  store.state.rows[0].marketRequestId = 'different-original';
  await assert.rejects(syncAccountCollection(input, store), conflict('COLLECTION_IDENTITY_CONFLICT'));
});

test('same collection cannot change submission content, hash or source', async () => {
  const store = new MemoryStore(); await syncAccountCollection(batch(body()), store);
  for (const change of [
    value => { value.submissionHash = 'b'.repeat(64); }, value => { value.items[0].emails[0] = 'new@school.kr'; },
    value => { value.schoolName = '다른학교'; },
  ]) {
    const value = body(); change(value);
    await assert.rejects(syncAccountCollection(batch(value), store), conflict('COLLECTION_PAYLOAD_CONFLICT'));
  }
});

test('every processed, archived, sending, invoice and payment evidence freezes a target draft', async () => {
  const guards = [
    ['status', 'sent'], ['status', 'processed'], ['status', 'paid'], ['status', 'invoiced'],
    ...['archivedAt', 'confirmedAt', 'confirmToken', 'processingEmailSendStartedAt', 'processingEmailSentAt',
      'invoiceEmailSendStartedAt', 'invoiceEmailSentAt', 'invoiceGmailMessageId', 'receiptGmailMessageId',
      'invoiceNumber', 'invoiceAmount', 'invoiceDueDate', 'paymentLink', 'paymentDate', 'paymentMethod'].map(field => [field, 'evidence']),
  ];
  for (const [field, value] of guards) {
    const store = new MemoryStore([row({ [field]: value })]);
    await assert.rejects(syncAccountCollection(batch(body()), store), conflict('HQ_DELIVERY_STARTED'), field);
    assert.equal(store.writes, 0); assert.equal(store.state.ledgers.length, 0);
  }
});

test('void/non-voidable fences and split or wrong source identities are not adopted', async () => {
  for (const [state, code] of [['prepared', 'MARKET_REQUEST_VOID_PREPARED'], ['voided', 'MARKET_REQUEST_VOIDED'], ['non_voidable', 'HQ_DELIVERY_STARTED']]) {
    const store = new MemoryStore(); store.state.fences[0].state = state;
    await assert.rejects(syncAccountCollection(batch(body()), store), error => error.code === code && error.retryable === (state === 'prepared'));
  }
  for (const requests of [[row({ externalSource: null })], [row({ orderNumber: 'different' })],
    [row(), row({ id: 2, marketRequestId: 'other' })]]) {
    const store = new MemoryStore(requests);
    await assert.rejects(syncAccountCollection(batch(body()), store), conflict('COLLECTION_IDENTITY_CONFLICT'));
    assert.equal(store.writes, 0);
  }
});

test('new order creates its active fence and real-account draft atomically with stable IDs', async () => {
  const store = new MemoryStore([]); store.state.fences = [];
  const first = await syncAccountCollection(batch(body()), store);
  assert.equal(first.duplicate, false); assert.equal(store.state.rows.length, 1);
  assert.deepEqual(store.state.fences, [{ id: 'order-123', orderNumber: 'ORD-123', state: 'active' }]);
  assert.equal(store.state.rows[0].externalSource, 'market'); assert.equal(store.state.rows[0].marketOrderId, 'order-123');
  assert.equal(store.state.rows[0].emails, 'a@school.kr, b@school.kr');
  assert.deepEqual(await syncAccountCollection(batch(body()), store), { ...first, duplicate: true });
  assert.equal(store.state.rows.length, 1);
  const wrongFence = new MemoryStore([]); wrongFence.state.fences[0].orderNumber = 'OTHER-ORDER';
  await assert.rejects(syncAccountCollection(batch(body()), wrongFence), conflict('ORDER_IDENTITY_CONFLICT'));
  assert.equal(wrongFence.state.rows.length, 0);
});

test('cross-source unprocessed upgrades block duplicates but completed accounts and renewals do not', async () => {
  for (const externalSource of [null, 'market_partner', 'market_collection', 'market']) {
    const store = new MemoryStore([row(), row({ id: 2, externalSource, marketRequestId: 'other', idempotencyKey: 'other', emails: ' A@SCHOOL.KR ', status: 'sent' })]);
    await assert.rejects(syncAccountCollection(batch(body()), store), conflict('DUPLICATE_ACCOUNT_REQUEST'));
  }
  for (const status of ['invoiced', 'paid']) {
    const store = new MemoryStore([row(), row({ id: 2, externalSource: null, marketRequestId: 'other', idempotencyKey: 'other', emails: 'a@school.kr', status })]);
    await assert.rejects(syncAccountCollection(batch(body()), store), conflict('DUPLICATE_ACCOUNT_REQUEST'));
  }
  for (const overrides of [{ status: 'processed' }, { status: 'paid', confirmedAt: new Date() }, { confirmedAt: new Date() }, { archivedAt: new Date() }, { type: 'extension' }]) {
    const store = new MemoryStore([row(), row({ id: 2, marketRequestId: 'other', idempotencyKey: 'other', emails: 'a@school.kr', ...overrides })]);
    assert.equal((await syncAccountCollection(batch(body()), store)).duplicate, false);
  }
});

test('external collection creates school_store drafts with no fabricated Order identifiers', async () => {
  const store = new MemoryStore([]);
  const first = await syncAccountCollection(batch(externalBody()), store);
  assert.equal(first.requests.length, 1);
  const created = store.state.rows[0];
  assert.equal(created.externalSource, 'market_collection'); assert.equal(created.channel, 'school_store');
  assert.equal(created.marketOrderId, null); assert.equal(created.orderNumber, null); assert.equal(created.status, 'draft');
  assert.equal(created.draftOnly, true); assert.equal(store.state.ledgers[0].sourceKind, 'external');
  assert.deepEqual(await syncAccountCollection(batch(externalBody()), store), { ...first, duplicate: true });
});

test('mixed Teacher/School batches commit together and roll back every write if a later item fails', async () => {
  const value = body();
  value.items.push({ itemKey: 'item-2', marketRequestId: 'request-456', idempotencyKey: 'market:snorkl:draft:order-123:1',
    accountType: 'admin', quantity: 1, emails: ['admin@school.kr'], planName: 'School' });
  const second = row({ id: 2, marketRequestId: 'request-456', idempotencyKey: 'market:snorkl:draft:order-123:1' });
  const store = new MemoryStore([row(), second]);
  assert.equal((await syncAccountCollection(batch(value), store)).requests.length, 2);
  assert.equal(store.state.rows[1].accountType, 'admin'); assert.equal(store.state.rows[1].quantity, 1);
  const broken = new MemoryStore([row(), second]); broken.failId = 2;
  const original = structuredClone(broken.state);
  await assert.rejects(syncAccountCollection(batch(value), broken), /simulated connection failure/);
  assert.deepEqual(broken.state, original); assert.equal(broken.writes, 0);
});

test('concurrent identical submissions return one original receipt; competing collections share account locks and cannot duplicate', async () => {
  const identical = new MemoryStore([]);
  const input = batch(externalBody());
  const results = await Promise.all([syncAccountCollection(input, identical), syncAccountCollection(input, identical)]);
  assert.deepEqual(results.map(value => value.duplicate), [false, true]);
  assert.deepEqual(results[0].requests, results[1].requests); assert.equal(identical.state.rows.length, 1);
  const first = batch(externalBody('external-a'));
  const second = batch(externalBody('external-b'));
  assert.ok(collectionLockKeys(first).includes('account:테스트중학교:a@school.kr'));
  assert.ok(collectionLockKeys(second).includes('account:테스트중학교:a@school.kr'));
  const competing = new MemoryStore([]);
  const outcomes = await Promise.allSettled([syncAccountCollection(first, competing), syncAccountCollection(second, competing)]);
  assert.equal(outcomes.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(value => value.status === 'rejected').reason.code, 'DUPLICATE_ACCOUNT_REQUEST');
  assert.equal(competing.state.rows.length, 1); assert.equal(competing.state.ledgers.length, 1);
});

test('a second collection cannot overwrite an already submitted target', async () => {
  const store = new MemoryStore(); await syncAccountCollection(batch(body()), store);
  await assert.rejects(syncAccountCollection(batch(body({ collectionId: 'collection-456' })), store), conflict('COLLECTION_IDENTITY_CONFLICT'));
});

test('receiver uses bounded machine auth, atomic locks/ledger and closes its connection without any mail path', async () => {
  const route = await readFile(new URL('../src/app/api/account-requests/market-collections/[collectionId]/route.ts', import.meta.url), 'utf8');
  const adapter = await readFile(new URL('../src/lib/market-account-collection-db.ts', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../drizzle/0028_market_account_collection_sync.sql', import.meta.url), 'utf8');
  const proxy = await readFile(new URL('../src/proxy.ts', import.meta.url), 'utf8');
  assert.match(route, /authorizeMarketStatusRequest/); assert.match(route, /collectionOriginAllowed/);
  assert.match(route, /readCollectionBody/); assert.match(route, /idempotency-key/); assert.match(route, /db\.\$client\.end/);
  assert.doesNotMatch(route + adapter, /from ['"].*(?:email|account-email|notifications)['"]/);
  assert.match(adapter, /db\.transaction/); assert.match(adapter, /pg_advisory_xact_lock/); assert.match(adapter, /\.for\('update'\)/);
  assert.match(adapter, /marketAccountCollectionSync/); assert.match(adapter, /regexp_split_to_table/);
  assert.match(migration, /BEFORE UPDATE OR DELETE/); assert.match(migration, /RECEIPT_IMMUTABLE/);
  assert.match(proxy, /market-collections\\\/\[\^\/\]\+\$\/\.test\(pathname\)\s*&& request\.method === "PUT"/);
  assert.doesNotMatch(proxy, /startsWith\("\/api\/account-requests/);
});
