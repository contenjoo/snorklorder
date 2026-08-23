-- 0015: Stripe Gmail 메시지 단위 CAS 선점 및 재실행 멱등성
-- nullable 열이므로 기존 요청에는 영향이 없고, invoice/receipt는 같은 thread를 공유할 수 있다.
ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "invoice_gmail_message_id" text;
ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "invoice_gmail_thread_id" text;
ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "receipt_gmail_message_id" text;
ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "receipt_gmail_thread_id" text;

-- 같은 Gmail 메시지가 둘 이상의 요청에 반영되는 것을 DB에서도 차단한다.
CREATE UNIQUE INDEX IF NOT EXISTS "account_requests_invoice_gmail_message_id_unique_idx"
  ON "account_requests" ("invoice_gmail_message_id");
CREATE UNIQUE INDEX IF NOT EXISTS "account_requests_receipt_gmail_message_id_unique_idx"
  ON "account_requests" ("receipt_gmail_message_id");
