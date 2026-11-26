"use client";

import { useEffect, useState } from "react";
import { parseEmailList } from "@/lib/email-list";
import type { AccountHistory } from "@/lib/account-history";
import { AccountHistoryNotice } from "@/components/account-history-notice";

export function AccountHistoryLookup({ emails, id }: { emails: string; id?: number }) {
  const normalized = parseEmailList(emails).join(",");
  const key = JSON.stringify({ emails: normalized, id });
  const [result, setResult] = useState<{ key: string; items?: AccountHistory[] } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!normalized) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/admin/account-history", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: key, signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        const items = await response.json();
        if (!controller.signal.aborted) setResult({ key, items });
      } catch {
        if (!controller.signal.aborted) setResult({ key });
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, normalized, retry]);
  if (!normalized) return null;
  if (result?.key !== key) return <p role="status" className="text-xs">이메일 기록 확인 중…</p>;
  if (!result.items) return <p role="alert" className="text-xs">이메일 기록을 불러오지 못했습니다.{" "}
    <button type="button" className="underline" onClick={() => { setResult(null); setRetry(n => n + 1); }}>다시 확인</button></p>;
  return <div aria-live="polite"><AccountHistoryNotice items={result.items} /></div>;
}
