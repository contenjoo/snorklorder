-- 0016: Jon 처리 메일과 Cailie 인보이스 메일의 단계별 발송 상태
-- 기존 요청은 모두 null로 유지되어 기존 데이터와 발송 계약을 바꾸지 않는다.
ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "processing_email_send_started_at" timestamp;
ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "processing_email_sent_at" timestamp;
ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "invoice_email_send_started_at" timestamp;
ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "invoice_email_sent_at" timestamp;
ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "invoice_email_last_error" text;
