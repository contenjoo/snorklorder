import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { createSchoolStoreLink, readSchoolStoreLink, parseSchoolStoreLinkConfig, parseSchoolStoreEmails } from '../src/lib/school-store-link.ts';
import { moduleLoader } from './processing-mail-loader.mjs';
const { NextRequest } = createRequire(import.meta.url)('next/server');
const secret = 'test-only-school-store-secret';
const config = { schoolName: '테스트중학교', quantity: 2, accountType: 'teacher', type: 'upgrade', termYears: 1, extensionDate: null };

test('link binds purchase details; tampering, wrong key, expiration and session tokens are rejected', () => {
  const { token, expiresAt } = createSchoolStoreLink(config, secret, 1000);
  assert.equal(readSchoolStoreLink(token, secret, 1001).quantity, 2);
  assert.equal(readSchoolStoreLink(token, secret, expiresAt), null);
  assert.equal(readSchoolStoreLink(token, 'wrong-secret', 1001), null);
  const [data, sig] = token.split('.');
  const payload = JSON.parse(Buffer.from(data, 'base64url'));
  payload.quantity = 500;
  assert.equal(readSchoolStoreLink(Buffer.from(JSON.stringify(payload)).toString('base64url') + '.' + sig, secret, 1001), null);
  assert.equal(readSchoolStoreLink(token + '.extra', secret), null);
  assert.equal(readSchoolStoreLink('x'.repeat(5000), secret), null);
});
test('purchase inputs and complete email lists are validated without silently dropping addresses', () => {
  for (const change of [{ quantity: 0 }, { quantity: 501 }, { accountType: 'admin' }, { type: 'email_change' }, { termYears: 9 }, { accountType: 'school' }, { schoolName: '학교\n위조' }, { type: 'extension', extensionDate: '2027-02-30' }]) {
    assert.throws(() => parseSchoolStoreLinkConfig({ ...config, ...change }));
  }
  assert.equal(parseSchoolStoreLinkConfig({ ...config, type: 'extension', extensionDate: '2027-09-01' }).extensionDate, '2027-09-01');
  assert.deepEqual(parseSchoolStoreEmails(' A@example.com; b@example.com\n', 2), ['a@example.com', 'b@example.com']);
  for (const value of ['', 'a@example.com', 'a@example.com A@example.com', 'a@example.com bad-address', 'a@example.com b@example.com c@example.com']) assert.throws(() => parseSchoolStoreEmails(value, 2));
});
function harness({ authenticated = true, rateOk = true } = {}) {
  const writes = new Map(), calls = [];
  const load = moduleLoader({
    'next/server': { NextResponse: Response },
    '@/lib/auth': { checkAuth: async () => authenticated },
    '@/lib/security': { checkRateLimit: async () => ({ ok: rateOk, retryAfter: 60 }), createRateLimitResponse: () => Response.json({}, { status: 429 }) },
    '@/db/schema': { accountRequests: { id: 'id', idempotencyKey: 'idempotencyKey' } },
    '@/db': { db: { insert() { return { values(row) { calls.push(row); return { onConflictDoNothing() { return { returning: async () => { if (writes.has(row.idempotencyKey)) return []; writes.set(row.idempotencyKey, row); return [{ id: 1 }]; } }; } }; } }; } } },
  });
  return { load, writes, calls };
}
const post = (body) => new NextRequest('https://example.test/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('only an administrator generates links; generation writes no orders and sends no mail', async () => {
  const old = process.env.ADMIN_SESSION_SECRET; process.env.ADMIN_SESSION_SECRET = secret;
  try {
    assert.equal((await harness({ authenticated: false }).load('@/app/api/admin/school-store-links/route').POST(post(config))).status, 401);
    const h = harness();
    const result = await h.load('@/app/api/admin/school-store-links/route').POST(post(config));
    assert.equal(result.status, 200);
    const body = await result.json();
    assert.ok(body.url.includes('/school-store/'));
    assert.ok(readSchoolStoreLink(body.url.split('/school-store/')[1], secret));
    assert.equal(h.calls.length, 0);
  } finally { if (old === undefined) delete process.env.ADMIN_SESSION_SECRET; else process.env.ADMIN_SESSION_SECRET = old; }
});
test('public submission creates one draft school-store request under simultaneous retries and never overwrites it', async () => {
  const old = process.env.ADMIN_SESSION_SECRET; process.env.ADMIN_SESSION_SECRET = secret;
  try {
    const h = harness(), route = h.load('@/app/api/school-store-links/[token]/route');
    const { token } = createSchoolStoreLink(config, secret);
    const submit = (emails) => route.POST(post({ emails }), { params: Promise.resolve({ token }) });
    const responses = await Promise.all([submit('first@example.com second@example.com'), submit('third@example.com fourth@example.com')]);
    assert.ok(responses.every((r) => r.status === 200));
    assert.equal(h.writes.size, 1);
    const row = [...h.writes.values()][0];
    assert.equal(row.status, 'draft'); assert.equal(row.channel, 'school_store');
    assert.equal(row.emails, 'first@example.com,second@example.com');
    assert.equal(row.quantity, 2); assert.equal(row.schoolName, config.schoolName);
    assert.equal(row.processingEmailSentAt, undefined); assert.equal(row.confirmedAt, undefined);
    assert.equal((await submit('one@example.com')).status, 400);
    assert.equal((await route.POST(post({ emails: 'a@example.com b@example.com' }), { params: Promise.resolve({ token: token + 'x' }) })).status, 404);
    assert.equal(h.writes.size, 1);
    const rateLimited = harness({ rateOk: false });
    assert.equal((await rateLimited.load('@/app/api/school-store-links/[token]/route').POST(post({ emails: 'a@example.com b@example.com' }), { params: Promise.resolve({ token }) })).status, 429);
    assert.equal(rateLimited.calls.length, 0);
  } finally { if (old === undefined) delete process.env.ADMIN_SESSION_SECRET; else process.env.ADMIN_SESSION_SECRET = old; }
});

test('proxy exposes only token submission POST and still protects admin link generation', async () => {
  const load = moduleLoader({ '@/lib/signed-session': { ADMIN_SESSION_COOKIE_NAME: 'admin', PARTNER_SESSION_COOKIE_NAME: 'partner', verifyAdminSessionToken: async () => false, verifyPartnerSessionToken: async () => null } });
  const { proxy } = load('@/proxy');
  const result = await proxy(new NextRequest('https://example.test/api/school-store-links/signed-token', { method: 'POST' }));
  assert.equal(result.headers.get('x-middleware-next'), '1');
  for (const [path, method] of [['/api/school-store-links/signed-token', 'GET'], ['/api/school-store-links/signed-token/extra', 'POST'], ['/api/admin/school-store-links', 'POST']]) {
    assert.equal((await proxy(new NextRequest('https://example.test' + path, { method }))).status, 401);
  }
});
