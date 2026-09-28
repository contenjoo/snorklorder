-- 0024: 결제 기간(1년/2년). 연장 날짜만으로는 몇 년치를 청구할지 알 수 없어 따로 기록한다.
-- 기존 행은 모두 1년(기본값). billing_cycle_items 는 마감 스냅샷이므로 같은 값을 복사해 둔다. Idempotent.
ALTER TABLE account_requests
  ADD COLUMN IF NOT EXISTS term_years integer NOT NULL DEFAULT 1;
ALTER TABLE billing_cycle_items
  ADD COLUMN IF NOT EXISTS term_years integer NOT NULL DEFAULT 1;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_requests_term_years_check') THEN
    ALTER TABLE account_requests ADD CONSTRAINT account_requests_term_years_check CHECK (term_years IN (1, 2));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_cycle_items_term_years_check') THEN
    ALTER TABLE billing_cycle_items ADD CONSTRAINT billing_cycle_items_term_years_check CHECK (term_years IN (1, 2));
  END IF;
END $$;
