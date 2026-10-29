import assert from 'node:assert/strict';
import test from 'node:test';
import { moduleLoader } from './processing-mail-loader.mjs';
function names(rows = []) {
  return moduleLoader({
    '@/db/schema': { schools: { name: 'name', nameEn: 'nameEn' } },
    '@/db': { db: { select: () => ({ from: () => ({ where: () => Object.assign(Promise.resolve(rows), { limit: async () => rows }) }) }) } },
  })('@/lib/account-request-school-name');
}
test('new Market request resolves missing English school name without external translation', async () => {
  assert.equal(await names().resolveAccountRequestSchoolNameEn('성호고등학교', null), 'Seongho High School');
});
test('existing drafts hydrate automatically and become eligible for HQ sending', async () => {
  const api = names();
  const [row] = await api.hydrateAccountRequestSchoolNames([{ schoolName: '성호고등학교', schoolNameEn: null, applicantType: 'school' }]);
  assert.equal(row.schoolNameEn, 'Seongho High School');
  assert.equal(api.needsEnglishSchoolNameForHq(row), false);
});
test('manual and registered names take priority over automatic romanization', async () => {
  const api = names([{ name: '성호고등학교', nameEn: 'Registered High School' }]);
  assert.equal(await api.resolveAccountRequestSchoolNameEn('성호고등학교', 'Custom High School'), 'Custom High School');
  assert.equal(await api.resolveAccountRequestSchoolNameEn('성호고등학교'), 'Registered High School');
  const rows = await api.hydrateAccountRequestSchoolNames([{ schoolName: ' 성호고등학교 ', schoolNameEn: null }, { schoolName: '성호고등학교', schoolNameEn: 'Custom High School' }]);
  assert.equal(rows[0].schoolNameEn, 'Registered High School');
  assert.equal(rows[1].schoolNameEn, 'Custom High School');
});
test('untranslatable incomplete Hangul stays blocked and English names remain usable', async () => {
  const api = names();
  assert.equal(await api.resolveAccountRequestSchoolNameEn('ㄱ학교'), null);
  assert.equal(await api.resolveAccountRequestSchoolNameEn('Example School'), 'Example School');
});
