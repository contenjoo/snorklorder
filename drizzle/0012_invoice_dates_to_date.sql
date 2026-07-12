-- 0012: account_requests 정산 날짜 컬럼 text → date 전환
-- 운영 DB 전 행 NULL 확인 완료 (2026-07-12) — NULLIF 로 빈 문자열만 방어, 데이터 정규화 불필요
ALTER TABLE "account_requests" ALTER COLUMN "invoice_due_date" TYPE date USING NULLIF("invoice_due_date", '')::date;
ALTER TABLE "account_requests" ALTER COLUMN "payment_date" TYPE date USING NULLIF("payment_date", '')::date;
