import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { randomUUID } from 'node:crypto';
import { parsePartnerOrderEdit, partnerOrderVersion, partnerOrderLocked } from '../src/lib/partner-order-admin.ts';
import { hashPartnerBatchPayload } from '../src/lib/partner-product-request.ts';

const row = (id, extra = {}) => ({ id, partnerRequestId: 'partner-test-1234', partnerRevision: 1,
  externalSource: 'market_partner', partnerLifecycleState: 'active', status: 'draft',
  schoolName: '테스트학교', schoolNameEn: 'Test School', emails: `t${id}@school.test`,
  teacherName: `교사${id}`, subject: '과학', updatedAt: new Date('2026-10-19T00:00:00Z'),
  processingEmailSendStartedAt: null, processingEmailSentAt: null,
  invoiceEmailSendStartedAt: null, invoiceEmailSentAt: null, confirmedAt: null,
  invoiceNumber: null, paymentDate: null, ...extra });
const edit = (rows) => ({ version: partnerOrderVersion(rows), schoolName: '변경학교', schoolNameEn: 'Changed School',
  items: rows.map((r) => ({ id: r.id, teacherName: r.teacherName, subject: '수학', emails: r.emails })) });

function harness(initial, { auth = true, billing = [] } = {}) {
  const data = { accountRequests: structuredClone(initial), partnerRequestOperations: [], billingCycleItems: billing };
  let locks = 0, closed = false;
  const tables = Object.fromEntries(Object.keys(data).map((name) => [name, new Proxy({ name }, { get: (t, k) => k in t ? t[k] : { key: k } })]));
  const orm = { eq: (a, b) => (r) => r[a.key] === b, and: (...p) => (r) => p.every((fn) => fn(r)),
    inArray: (a, b) => (r) => b.includes(r[a.key]), desc: (a) => a, sql: () => ({}) };
  const tx = {
    execute: async () => { locks++; },
    select() {
      let name, filter = () => true;
      const q = { from(t) { name = t.name; return q; }, where(fn) { filter = fn; return q; },
        orderBy() { return q; }, limit(n) { return Promise.resolve(data[name].filter(filter).slice(0, n)); },
        then(resolve, reject) { return Promise.resolve(data[name].filter(filter)).then(resolve, reject); } };
      return q;
    },
    update(t) { return { set(values) { return { where(filter) { data[t.name].filter(filter).forEach((r) => Object.assign(r, values)); return Promise.resolve(); } }; } }; },
    insert(t) { return { values(value) { data[t.name].push(value); return Promise.resolve(); } }; },
  };
  const db = { transaction: async (fn) => {
    const snapshot = structuredClone(data);
    try { return await fn(tx); } catch (e) { Object.assign(data, snapshot); throw e; }
  }, $client: { end: async () => { closed = true; } } };
  const mocks = { 'next/server': { NextResponse: Response }, 'node:crypto': { randomUUID }, 'drizzle-orm': orm,
    '@/lib/auth': { checkAuth: async () => auth }, '@/db/transaction': { createPartnerTransactionDb: () => db }, '@/db/schema': tables,
    '@/lib/partner-product-request': { hashPartnerBatchPayload }, '@/lib/partner-order-admin': { parsePartnerOrderEdit, partnerOrderLocked, partnerOrderVersion } };
  const source = readFileSync(new URL('../src/app/api/admin/partner-orders/[partnerRequestId]/route.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`)((key) => { assert.ok(mocks[key], key); return mocks[key]; }, mod, mod.exports);
  return { data, get locks() { return locks; }, get closed() { return closed; },
    call(method, body = edit(initial)) { return mod.exports[method](new Request('https://example.test/api', { method, body: JSON.stringify(body) }), { params: Promise.resolve({ partnerRequestId: 'partner-test-1234' }) }); } };
}

test('수정은 신청 전체의 학교와 교사 정보를 원자적으로 변경하고 연동 ID를 보존한다', async () => {
  const h = harness([row(1), row(2)]);
  assert.equal((await h.call('PATCH')).status, 200);
  assert.ok(h.data.accountRequests.every((r) => r.schoolName === '변경학교' && r.subject === '수학' && r.partnerRevision === 1));
  assert.equal(h.locks, 2); assert.equal(h.closed, true);
});
test('삭제는 물리 삭제 대신 전체 취소와 재유입 방지 원장을 남긴다', async () => {
  const h = harness([row(1), row(2)]);
  h.data.partnerRequestOperations.push({ partnerRequestId: 'partner-test-1234', revision: 5 });
  assert.equal((await h.call('DELETE')).status, 200);
  assert.equal(h.data.accountRequests.length, 2);
  assert.ok(h.data.accountRequests.every((r) => r.partnerLifecycleState === 'cancelled' && r.partnerRevision === 6));
  assert.equal(h.data.partnerRequestOperations.at(-1).mode, 'cancel');
  assert.equal((await h.call('DELETE')).status, 200);
  assert.equal(h.data.partnerRequestOperations.length, 2);
});
test('인증 실패, 오래된 화면, 필터로 누락된 교사, 다른 출처의 주문 변경을 거절한다', async () => {
  assert.equal((await harness([row(1)], { auth: false }).call('DELETE')).status, 401);
  const h = harness([row(1), row(2)]);
  assert.equal((await h.call('DELETE', edit([row(1)]))).status, 409);
  h.data.accountRequests[0].updatedAt = new Date();
  assert.equal((await h.call('PATCH')).status, 409);
  assert.equal((await harness([row(1, { externalSource: 'market' })]).call('DELETE')).status, 404);
});
test('본사 발송 중, 처리 완료, 청구 및 결제 기록이 있으면 수정과 삭제를 거절한다', async () => {
  for (const extra of [{ status: 'sent' }, { processingEmailSendStartedAt: new Date() }, { confirmedAt: new Date() }, { invoiceNumber: 'INV-1' }, { paymentDate: '2026-10-19' }]) {
    for (const method of ['PATCH', 'DELETE']) assert.equal((await harness([row(1, extra)]).call(method)).status, 409);
  }
  assert.equal((await harness([row(1)], { billing: [{ id: 1, accountRequestId: 1 }] }).call('DELETE')).status, 409);
});
test('중복 이메일, 타 신청의 항목, 빈 교사명, 잘못된 영문 학교명을 거절한다', async () => {
  const initial = [row(1), row(2)];
  for (const change of [
    (body) => { body.items[1].emails = body.items[0].emails; },
    (body) => { body.items[1].id = 99; },
    (body) => { body.items[0].teacherName = ''; },
    (body) => { body.schoolNameEn = '학교'; },
  ]) {
    const h = harness(initial), body = edit(initial); change(body);
    assert.equal((await h.call('PATCH', body)).status, 400);
    assert.equal(h.data.accountRequests[0].schoolName, '테스트학교');
  }
});
