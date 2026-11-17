import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { createSchoolStoreLink, readSchoolStoreLink } from '../src/lib/school-store-link.ts';
import { moduleLoader } from './processing-mail-loader.mjs';

const { NextRequest } = createRequire(import.meta.url)('next/server');
const secret = 'test-only-school-store-short-secret';
const config = { schoolName: '테스트중학교', quantity: 2, accountType: 'teacher', type: 'upgrade', termYears: 1, extensionDate: null };
const hash = (code) => createHash('sha256').update(code).digest('hex');
const post = (body) => new NextRequest('https://example.test/api', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

function harness({ authenticated = true, rateOk = true } = {}) {
  const links = new Map(), orders = new Map(), queries = [], inserts = [], rateCalls = [];
  const fail = { lookup: false, linkInsert: false, orderInsert: false };
  const schoolStoreInputLinks = { name: 'links', codeHash: 'codeHash', signedToken: 'signedToken', expiresAt: 'expiresAt' };
  const accountRequests = { name: 'orders', id: 'id', idempotencyKey: 'idempotencyKey' };
  const load = moduleLoader({
    'next/server': { NextResponse: Response },
    'drizzle-orm': { eq: (column, value) => ({ column, value }) },
    '@/lib/auth': { checkAuth: async () => authenticated },
    '@/lib/security': {
      checkRateLimit: async (options) => { rateCalls.push(options); return { ok: rateOk, retryAfter: 60 }; },
      createRateLimitResponse: () => Response.json({}, { status: 429 }),
    },
    '@/db/schema': { schoolStoreInputLinks, accountRequests },
    '@/db': { db: {
      insert(table) { return { values(row) { return { onConflictDoNothing({ target }) {
        const commit = async () => {
          inserts.push({ table: table.name, target, row });
          if (table === schoolStoreInputLinks) {
            if (fail.linkInsert) throw new Error('isolated link insert failure');
            if (!links.has(row.codeHash)) links.set(row.codeHash, row);
            return [];
          }
          if (fail.orderInsert) throw new Error('isolated order insert failure');
          if (orders.has(row.idempotencyKey)) return [];
          orders.set(row.idempotencyKey, row);
          return [{ id: orders.size }];
        };
        return { then: (resolve, reject) => commit().then(resolve, reject), returning: commit };
      } }; } }; },
      select() {
        let selected;
        return { from(table) { selected = table; return this; }, where(condition) {
          return { limit: async (count) => {
            queries.push({ table: selected.name, ...condition, count });
            if (fail.lookup) throw new Error('isolated link lookup failure');
            assert.equal(selected, schoolStoreInputLinks);
            assert.equal(condition.column, schoolStoreInputLinks.codeHash);
            return links.has(condition.value) ? [links.get(condition.value)] : [];
          } };
        } };
      },
    } },
  });
  const helper = load('@/lib/school-store-short-link');
  return { load, helper, links, orders, queries, inserts, rateCalls, fail,
    submit(token, emails) {
      return load('@/app/api/school-store-links/[token]/route').POST(post({ emails }), { params: Promise.resolve({ token }) });
    },
  };
}

test('short code keeps the signed purchase identity and original expiry; only its SHA256 is indexed', async () => {
  const now = 10_000;
  const h = harness();
  const { token, expiresAt } = createSchoolStoreLink(config, secret, now);
  const short = await h.helper.shortenSchoolStoreLink(token, secret, now);
  assert.match(short.code, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(short.code, createHmac('sha256', secret).update(`school-store-short:${token}`).digest('base64url').slice(0, 22));
  assert.equal(short.expiresAt, expiresAt);
  assert.equal(h.links.size, 1);
  assert.ok(h.links.has(hash(short.code)));
  const row = h.links.get(hash(short.code));
  assert.equal(row.signedToken, token);
  assert.equal(row.expiresAt.getTime(), expiresAt);
  assert.ok(!Object.hasOwn(row, 'code'));
  const resolved = await h.helper.resolveSchoolStoreInputLink(short.code, secret, now + 1);
  assert.deepEqual(JSON.parse(JSON.stringify(resolved)), readSchoolStoreLink(token, secret, now + 1));
  assert.ok(h.queries.every((query) => query.value === hash(short.code) && query.value !== short.code));
});

test('legacy signed links resolve without a lookup even when the short-link database is unavailable', async () => {
  const h = harness(); h.fail.lookup = true; h.fail.linkInsert = true;
  const { token, expiresAt } = createSchoolStoreLink(config, secret, 1_000);
  assert.equal((await h.helper.resolveSchoolStoreInputLink(token, secret, 1_001)).quantity, 2);
  assert.equal(await h.helper.resolveSchoolStoreInputLink(token, 'wrong-key', 1_001), null);
  assert.equal(await h.helper.resolveSchoolStoreInputLink(token, secret, expiresAt), null);
  assert.equal(await h.helper.resolveSchoolStoreInputLink(`${token}.extra`, secret, 1_001), null);
  assert.equal(h.queries.length, 0);
  assert.equal(h.inserts.length, 0);
});

test('unknown, modified and expired short codes do not authorize a school submission', async () => {
  const h = harness();
  const { token, expiresAt } = createSchoolStoreLink(config, secret, 1_000);
  const { code } = await h.helper.shortenSchoolStoreLink(token, secret, 1_000);
  assert.equal(await h.helper.resolveSchoolStoreInputLink('a'.repeat(22), secret, 1_001), null);
  const changed = (code[0] === 'a' ? 'b' : 'a') + code.slice(1);
  assert.equal(await h.helper.resolveSchoolStoreInputLink(changed, secret, 1_001), null);
  assert.equal(await h.helper.resolveSchoolStoreInputLink(code, secret, expiresAt), null);
  for (const invalid of ['', 'short', 'a'.repeat(23), 'a'.repeat(21) + '/', 'a'.repeat(5000)]) {
    const before = h.queries.length;
    assert.equal(await h.helper.resolveSchoolStoreInputLink(invalid, secret, 1_001), null);
    assert.equal(h.queries.length, before);
  }
  assert.equal(h.orders.size, 0);
});

test('short-code resolution checks both database expiry and the original signed payload', async () => {
  const h = harness();
  const { token, expiresAt } = createSchoolStoreLink(config, secret, 1_000);
  const { code } = await h.helper.shortenSchoolStoreLink(token, secret, 1_000);
  const row = h.links.get(hash(code));
  row.expiresAt = new Date(1_001);
  assert.equal(await h.helper.resolveSchoolStoreInputLink(code, secret, 1_001), null);
  row.expiresAt = new Date(expiresAt + 50_000);
  assert.equal(await h.helper.resolveSchoolStoreInputLink(code, secret, expiresAt), null);
  row.expiresAt = new Date(expiresAt);
  const [data, signature] = token.split('.');
  const payload = JSON.parse(Buffer.from(data, 'base64url')); payload.quantity = 500;
  row.signedToken = Buffer.from(JSON.stringify(payload)).toString('base64url') + '.' + signature;
  assert.equal(await h.helper.resolveSchoolStoreInputLink(code, secret, 1_001), null);
  // Even a code matching this corrupt stored value must not bypass the original signature.
  const corruptCode = createHmac('sha256', secret).update(`school-store-short:${row.signedToken}`).digest('base64url').slice(0, 22);
  h.links.set(hash(corruptCode), { ...row, codeHash: hash(corruptCode) });
  assert.equal(await h.helper.resolveSchoolStoreInputLink(corruptCode, secret, 1_001), null);
  row.signedToken = token;
  assert.equal(await h.helper.resolveSchoolStoreInputLink(code, 'wrong-key', 1_001), null);
});

test('a valid signed token from another school cannot be substituted behind an existing short code', async () => {
  const h = harness();
  const now = 1_000;
  const first = createSchoolStoreLink(config, secret, now);
  const other = createSchoolStoreLink({ ...config, schoolName: '다른학교', quantity: 3 }, secret, now);
  const { code } = await h.helper.shortenSchoolStoreLink(first.token, secret, now);
  assert.ok(readSchoolStoreLink(other.token, secret, now + 1));
  const row = h.links.get(hash(code));
  row.signedToken = other.token;
  assert.equal(await h.helper.resolveSchoolStoreInputLink(code, secret, now + 1), null);
  row.signedToken = first.token;
  assert.equal((await h.helper.resolveSchoolStoreInputLink(code, secret, now + 1)).schoolName, config.schoolName);
  assert.equal(h.orders.size, 0);
});

test('retries reuse the same code, and a conflicting stored payload is rejected without overwriting', async () => {
  const h = harness();
  const { token, expiresAt } = createSchoolStoreLink(config, secret, 1_000);
  const first = await h.helper.shortenSchoolStoreLink(token, secret, 1_000);
  const second = await h.helper.shortenSchoolStoreLink(token, secret, 1_001);
  assert.equal(second.code, first.code);
  assert.equal(h.links.size, 1);
  const conflictingToken = createSchoolStoreLink({ ...config, schoolName: '다른학교' }, secret, 1_000).token;
  h.links.set(hash(first.code), { codeHash: hash(first.code), signedToken: conflictingToken, expiresAt: new Date(expiresAt) });
  await assert.rejects(h.helper.shortenSchoolStoreLink(token, secret, 1_001));
  assert.equal(h.links.get(hash(first.code)).signedToken, conflictingToken);
  h.links.set(hash(first.code), { codeHash: hash(first.code), signedToken: token, expiresAt: new Date(expiresAt - 1) });
  await assert.rejects(h.helper.shortenSchoolStoreLink(token, secret, 1_001));
  assert.equal(h.links.get(hash(first.code)).expiresAt.getTime(), expiresAt - 1);
});

test('expired or invalid signed payloads cannot create short-link records', async () => {
  const h = harness();
  const { token, expiresAt } = createSchoolStoreLink(config, secret, 1_000);
  await assert.rejects(h.helper.shortenSchoolStoreLink(token, secret, expiresAt));
  await assert.rejects(h.helper.shortenSchoolStoreLink(token, 'wrong-key', 1_001));
  assert.equal(h.inserts.length, 0);
  assert.equal(h.links.size, 0);
});

test('admin generation fails closed with 503 and no URL when persistence or readback fails', async () => {
  const old = process.env.ADMIN_SESSION_SECRET; process.env.ADMIN_SESSION_SECRET = secret;
  try {
    for (const failure of ['linkInsert', 'lookup']) {
      const h = harness(); h.fail[failure] = true;
      const result = await h.load('@/app/api/admin/school-store-links/route').POST(post(config));
      assert.equal(result.status, 503);
      assert.equal(result.headers.get('cache-control'), 'no-store');
      assert.equal((await result.json()).url, undefined);
      assert.equal(h.orders.size, 0);
    }
    const unauthorized = harness({ authenticated: false });
    assert.equal((await unauthorized.load('@/app/api/admin/school-store-links/route').POST(post(config))).status, 401);
    assert.equal(unauthorized.inserts.length, 0);
    delete process.env.ADMIN_SESSION_SECRET;
    const unconfigured = harness();
    const result = await unconfigured.load('@/app/api/admin/school-store-links/route').POST(post(config));
    assert.equal(result.status, 503);
    assert.equal((await result.json()).url, undefined);
    assert.equal(unconfigured.inserts.length, 0);
  } finally { if (old === undefined) delete process.env.ADMIN_SESSION_SECRET; else process.env.ADMIN_SESSION_SECRET = old; }
});

test('admin conversion preserves the existing purchase identity and expiry and returns the same short URL on retry', async () => {
  const old = process.env.ADMIN_SESSION_SECRET; process.env.ADMIN_SESSION_SECRET = secret;
  try {
    const h = harness();
    const original = createSchoolStoreLink(config, secret);
    const originalPayload = readSchoolStoreLink(original.token, secret);
    const route = h.load('@/app/api/admin/school-store-links/route');
    const convert = () => route.POST(post({
      existingToken: original.token, schoolName: '다른 구매 정보', quantity: 500,
    }));
    const first = await convert();
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('cache-control'), 'no-store');
    const body = await first.json();
    assert.match(body.url, /^https:\/\/example.test\/s\/[A-Za-z0-9_-]{22}$/);
    assert.equal(body.expiresAt, original.expiresAt);
    const code = body.url.split('/s/')[1];
    const resolved = await h.helper.resolveSchoolStoreInputLink(code, secret);
    assert.deepEqual(JSON.parse(JSON.stringify(resolved)), originalPayload);
    assert.equal(resolved.id, originalPayload.id);
    assert.equal(resolved.schoolName, config.schoolName);
    assert.equal(resolved.quantity, config.quantity);
    assert.equal(h.links.get(hash(code)).signedToken, original.token);
    const retry = await convert();
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), body);
    assert.equal(h.links.size, 1);
    assert.equal(h.orders.size, 0);
  } finally { if (old === undefined) delete process.env.ADMIN_SESSION_SECRET; else process.env.ADMIN_SESSION_SECRET = old; }
});

test('admin conversion rejects invalid, modified and expired existing tokens instead of issuing a different purchase link', async () => {
  const old = process.env.ADMIN_SESSION_SECRET; process.env.ADMIN_SESSION_SECRET = secret;
  try {
    const h = harness();
    const route = h.load('@/app/api/admin/school-store-links/route');
    const original = createSchoolStoreLink(config, secret);
    const expired = createSchoolStoreLink(config, secret, Date.now() - 31 * 24 * 60 * 60 * 1000);
    const wrongKey = createSchoolStoreLink(config, 'different-signing-secret');
    for (const existingToken of [null, false, 123, [], {}, '', 'not-a-token', original.token + 'x', expired.token, wrongKey.token]) {
      const result = await route.POST(post({ ...config, existingToken }));
      assert.equal(result.status, 400);
      assert.equal((await result.json()).url, undefined);
    }
    assert.equal(h.inserts.length, 0);
    assert.equal(h.queries.length, 0);
    assert.equal(h.orders.size, 0);
  } finally { if (old === undefined) delete process.env.ADMIN_SESSION_SECRET; else process.env.ADMIN_SESSION_SECRET = old; }
});

test('conversion requires admin authorization and returns no URL on database failure', async () => {
  const old = process.env.ADMIN_SESSION_SECRET; process.env.ADMIN_SESSION_SECRET = secret;
  try {
    const { token } = createSchoolStoreLink(config, secret);
    const unauthorized = harness({ authenticated: false });
    const denied = await unauthorized.load('@/app/api/admin/school-store-links/route').POST(post({ existingToken: token }));
    assert.equal(denied.status, 401);
    assert.equal((await denied.json()).url, undefined);
    assert.equal(unauthorized.inserts.length, 0);
    for (const failure of ['linkInsert', 'lookup']) {
      const h = harness(); h.fail[failure] = true;
      const failed = await h.load('@/app/api/admin/school-store-links/route').POST(post({ existingToken: token }));
      assert.equal(failed.status, 503);
      assert.equal(failed.headers.get('cache-control'), 'no-store');
      assert.equal((await failed.json()).url, undefined);
      assert.equal(h.orders.size, 0);
    }
  } finally { if (old === undefined) delete process.env.ADMIN_SESSION_SECRET; else process.env.ADMIN_SESSION_SECRET = old; }
});

test('old and short URLs concurrently submit one draft with the same identity and preserve the first write', async () => {
  const old = process.env.ADMIN_SESSION_SECRET; process.env.ADMIN_SESSION_SECRET = secret;
  try {
    const h = harness();
    const { token } = createSchoolStoreLink(config, secret);
    const payload = readSchoolStoreLink(token, secret);
    const { code } = await h.helper.shortenSchoolStoreLink(token, secret);
    const responses = await Promise.all([
      h.submit(token, 'first@example.test second@example.test'),
      h.submit(code, 'third@example.test fourth@example.test'),
    ]);
    assert.ok(responses.every((response) => response.status === 200));
    const body = await Promise.all(responses.map((response) => response.json()));
    assert.equal(body.filter((result) => result.alreadySubmitted).length, 1);
    assert.equal(h.orders.size, 1);
    const row = h.orders.get(`school-store-input:${payload.id}`);
    assert.equal(row.emails, 'first@example.test,second@example.test');
    assert.equal(row.status, 'draft'); assert.equal(row.channel, 'school_store');
    assert.equal(row.quantity, 2); assert.equal(row.schoolName, config.schoolName);
    assert.ok(h.rateCalls.every((call) => call.subject === payload.id));
    assert.equal((await h.submit(code, 'third@example.test fourth@example.test')).status, 200);
    assert.equal(h.orders.get(`school-store-input:${payload.id}`).emails, row.emails);
    assert.equal(row.processingEmailSentAt, undefined); assert.equal(row.confirmedAt, undefined);
  } finally { if (old === undefined) delete process.env.ADMIN_SESSION_SECRET; else process.env.ADMIN_SESSION_SECRET = old; }
});

test('short-link submission reports transient database failures and still enforces email count and rate limits', async () => {
  const old = process.env.ADMIN_SESSION_SECRET; process.env.ADMIN_SESSION_SECRET = secret;
  try {
    const h = harness();
    const { token } = createSchoolStoreLink(config, secret);
    const { code } = await h.helper.shortenSchoolStoreLink(token, secret);
    h.fail.lookup = true;
    assert.equal((await h.submit(code, 'a@example.test b@example.test')).status, 503);
    assert.equal(h.orders.size, 0);
    h.fail.lookup = false;
    assert.equal((await h.submit(code, 'only@example.test')).status, 400);
    assert.equal((await h.submit('a'.repeat(22), 'a@example.test b@example.test')).status, 404);
    assert.equal(h.orders.size, 0);
    h.fail.orderInsert = true;
    assert.equal((await h.submit(code, 'a@example.test b@example.test')).status, 503);
    const limited = harness({ rateOk: false });
    const short = await limited.helper.shortenSchoolStoreLink(token, secret);
    assert.equal((await limited.submit(short.code, 'a@example.test b@example.test')).status, 429);
    assert.equal(limited.orders.size, 0);
  } finally { if (old === undefined) delete process.env.ADMIN_SESSION_SECRET; else process.env.ADMIN_SESSION_SECRET = old; }
});
