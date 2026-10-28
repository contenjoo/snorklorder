import assert from 'node:assert/strict';
import test from 'node:test';
import { schoolRenewalDraft } from '../src/lib/school-renewal.ts';

const school = { name: '광신방송예술고등학교', nameEn: 'Kwangshin Broadcasting Arts High School' };
const request = (extra = {}) => ({ id: 1, schoolName: school.name, schoolNameEn: school.nameEn,
  type: 'upgrade', applicantType: 'school', accountType: 'school', quantity: 20,
  emails: 'reference@example.com', channel: 'school_store', status: 'paid',
  invoiceNumber: 'OLD-INVOICE', paymentDate: '2025-11-01', confirmToken: 'old-token',
  extensionDate: '2026-11-01', termYears: 2, ...extra });

test('학교 단체 연장은 기존 계정 식별 정보만 복사해 1교의 새 요청을 준비한다', () => {
  const previous = request();
  const draft = schoolRenewalDraft(school, [previous]);
  assert.equal(draft.type, 'extension');
  assert.equal(draft.accountType, 'school');
  assert.equal(draft.quantity, 1);
  assert.equal(draft.emails, previous.emails);
  assert.equal(draft.channel, 'school_store');
  assert.equal(draft.extensionDate, '');
  assert.equal(draft.termYears, 1);
  assert.equal(draft.needsInvoice, true);
  for (const field of ['invoiceNumber', 'paymentDate', 'confirmToken', 'status', 'id']) assert.ok(!(field in draft));
  assert.equal(previous.invoiceNumber, 'OLD-INVOICE');
});

test('교사별 계정·취소·보관·미신청 초안과 다른 학교의 계정을 재사용하지 않는다', () => {
  const rows = [request({ id: 2, accountType: 'teacher' }), request({ id: 3, status: 'draft' }),
    request({ id: 4, marketVoidState: 'voided' }), request({ id: 5, marketVoidState: 'prepared' }),
    request({ id: 6, partnerLifecycleState: 'cancelled' }), request({ id: 7, archivedAt: new Date() }),
    request({ id: 8, schoolName: '다른 학교', schoolNameEn: 'Other School' }),
    request({ id: 9, schoolNameEn: 'Same Korean Name, Other School' }),
    request({ id: 10, schoolName: '다른 국문명' }), request({ id: 11, schoolNameEn: null })];
  const draft = schoolRenewalDraft(school, rows);
  assert.equal(draft.emails, '');
  assert.equal(draft.schoolName, school.name);
  assert.equal(draft.schoolNameEn, school.nameEn);
});

test('최근 학교 전체 이용권의 계정을 선택하고 협력사 전용 발송 경로는 복사하지 않는다', () => {
  const draft = schoolRenewalDraft(school, [request(), request({ id: 20, type: 'extension',
    channel: 'partner', emails: 'recent@example.com' })]);
  assert.equal(draft.emails, 'recent@example.com');
  assert.equal(draft.channel, 'company');
});
