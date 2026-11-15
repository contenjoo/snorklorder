import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { drizzle } from 'drizzle-orm/pg-proxy';

function harness(rows = [], authorized = true) {
  const queries = [];
  const datasets = [rows, [], []];
  const db = drizzle(async (query, params) => {
    queries.push({ query, params });
    return { rows: datasets.shift() };
  });
  const mocks = {
    '@/db': { db },
    '@/lib/auth': { checkAuth: async () => authorized },
    'next/server': { NextResponse: Response },
  };
  const nativeRequire = createRequire(import.meta.url);
  const root = path.resolve(import.meta.dirname, '..');
  const cache = new Map();
  function load(spec) {
    if (mocks[spec]) return mocks[spec];
    if (!spec.startsWith('@/')) return nativeRequire(spec);
    if (cache.has(spec)) return cache.get(spec).exports;
    const file = path.join(root, 'src', spec.slice(2) + '.ts');
    const mod = { exports: {} };
    cache.set(spec, mod);
    const code = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(load, mod, mod.exports);
    return mod.exports;
  }
  return { queries, get: () => load('@/app/api/admin/insights/route').GET() };
}

test('학교·월별 교사 집계는 취소 학교와 미완료·미승인 교사를 제외하는 SQL을 사용한다', async () => {
  const h = harness();
  await h.get();
  assert.equal(h.queries.length, 3);
  for (const { query, params } of h.queries.slice(0, 2)) {
    assert.match(query, /"schools"\."team" is distinct from '취소'/);
    assert.ok(params.includes('upgraded'));
    assert.ok(params.includes('approved'));
  }
  const request = h.queries[2];
  assert.match(request.query, /"archived_at" is null/);
  assert.match(request.query, /"market_void_state" not in/);
  assert.match(request.query, /"partner_lifecycle_state" =/);
  assert.deepEqual(request.params, ['prepared', 'voided', 'active']);
  for (const { query } of h.queries.slice(1)) {
    assert.match(query, /AT TIME ZONE 'UTC' AT TIME ZONE 'Asia\/Seoul'/);
  }
});

test('교사 없는 학교는 분포에서 제외하고 짝수 학교 수 중앙값은 가운데 두 수의 평균이다', async () => {
  const row = (schoolId, teacherId) => [schoolId, '테스트초등학교', null, null, '수학', teacherId];
  const h = harness([row(1, 1), row(1, 2), row(1, 3), row(2, 4), row(3, null)]);
  const response = await h.get();
  const data = await response.json();
  assert.equal(data.totals.teachers, 4);
  assert.equal(data.totals.schools, 2);
  assert.equal(data.totals.schoolsRegistered, 3);
  assert.equal(data.totals.medianPerSchool, 2);
  assert.equal(data.levels[0].schools, 2);
  assert.equal(data.subjectCoverage.total, 4);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

test('빈 데이터와 인증 실패를 안전하게 처리한다', async () => {
  const empty = await (await harness().get()).json();
  assert.equal(empty.totals.medianPerSchool, 0);
  assert.equal(empty.totals.top10Share, 0);
  const h = harness([], false);
  assert.equal((await h.get()).status, 401);
  assert.equal(h.queries.length, 0);
});
