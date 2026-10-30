import assert from 'node:assert/strict';
import test from 'node:test';
import { moduleLoader } from './processing-mail-loader.mjs';
test('billing includes automatically translated drafts while preserving registered names and excluding unresolved names', async () => {
  const inserted = [];
  const tables = { accountRequests: { kind: 'requests' }, billingCycleItems: { kind: 'items' }, billingCycles: { kind: 'cycles' }, schools: { kind: 'schools' } };
  const cycle = { id: 9, code: '2026-10-B', status: 'collecting' };
  const candidates = [
    { requestId: 303, schoolName: '용인신촌중학교', schoolNameEn: null, quantity: 1 },
    { requestId: 304, schoolName: '남목중학교', schoolNameEn: null, quantity: 1 },
    { requestId: 305, schoolName: '공식중학교', schoolNameEn: 'Official Middle School', quantity: 1 },
    { requestId: 306, schoolName: 'ㄱ학교', schoolNameEn: null, quantity: 1 },
  ];
  const db = {
    select() {
      let table;
      const result = () => table?.kind === 'cycles' ? [cycle] : table?.kind === 'requests' ? candidates : table?.kind === 'schools' ? [] : inserted.map(x => ({ requestId: x.accountRequestId }));
      const query = { from: (t) => { table = t; return query; }, where: () => query, orderBy: async () => result(), then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject) };
      return query;
    },
    insert() { return { values(values) { if (Array.isArray(values)) inserted.push(...values); return { onConflictDoNothing() { return { then: (resolve) => Promise.resolve([]).then(resolve), returning: async () => inserted.map(x => ({ requestId: x.accountRequestId })) }; } }; } }; },
  };
  const load = moduleLoader({ '@/db': { db }, '@/db/schema': tables, '@/lib/market-legacy-audit-db': { nonLegacyMarketAuditCondition: () => undefined } });
  const result = await load('@/lib/billing-cycle-db').assignRequestsToCurrentBillingCycle([303,304,305,306]);
  assert.equal(inserted.length, 3);
  assert.equal(inserted[0].schoolNameEn, 'Yonginsinchon Middle School');
  assert.equal(inserted[1].schoolNameEn, 'Nammok Middle School');
  assert.equal(inserted[2].schoolNameEn, 'Official Middle School');
  assert.deepEqual(Array.from(result.queuedIds), [303,304,305]);
});
