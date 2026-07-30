-- 0013: account_requests 에 인보이스 필요 여부 플래그 추가
-- 배경: 본사 요청 — 인보이스가 필요한 건에만 정산 담당(Cailie)을 CC 로 포함.
-- 기본값 true: 빠뜨렸을 때 인보이스 누락 손실이 메일 한 통보다 크므로 켜짐이 안전한 쪽.
ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "needs_invoice" boolean NOT NULL DEFAULT true;

-- 백필: 이메일 변경 / 타입 변경은 돈이 들지 않는 유형이므로 인보이스 불필요.
UPDATE "account_requests" SET "needs_invoice" = false WHERE "type" IN ('email_change', 'type_change');
