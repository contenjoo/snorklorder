-- 0025: 신규 학교(라이선스 없는 학교)의 첫 교사 승인 때 만든 학교 계정·청구 요청.
-- 학교당 1회만 만든다 — 값이 있으면 이후 교사는 일반 발송 흐름으로 간다. Idempotent.
ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS billing_account_request_id integer
    REFERENCES account_requests(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS schools_billing_account_request_unique_idx
  ON schools(billing_account_request_id)
  WHERE billing_account_request_id IS NOT NULL;
