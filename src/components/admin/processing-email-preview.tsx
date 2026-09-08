"use client";

import { useEffect, useState } from "react";

export interface ProcessingEmailPreview {
  subject: string;
  body: string;
  newCount: number;
  pendingCount: number;
  manualReview: { requestId: number; reason: string }[];
  copyAllowed: boolean;
}

export async function fetchProcessingEmailPreview(requestIds: number[], batch = false, signal?: AbortSignal): Promise<ProcessingEmailPreview> {
  const response = await fetch("/api/account-email/preview", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestIds, batch }), signal,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "미리보기를 불러오지 못했습니다. 다시 시도해 주세요.");
  return data;
}

export function useProcessingEmailPreview(key: string) {
  const [result, setResult] = useState<{ key: string; data?: ProcessingEmailPreview; error?: string } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!key) return;
    const abort = new AbortController();
    const input = JSON.parse(key) as { requestIds: number[]; batch: boolean };
    fetchProcessingEmailPreview(input.requestIds, input.batch, abort.signal)
      .then((data) => { if (!abort.signal.aborted) setResult({ key, data }); })
      .catch((error) => { if (!abort.signal.aborted) setResult({ key, error: error.message }); });
    return () => abort.abort();
  }, [key, retry]);
  const current = result?.key === key ? result : null;
  return { data: current?.data, error: current?.error, retry: () => { setResult(null); setRetry((n) => n + 1); } };
}

export function ProcessingPreviewNotes({ data }: { data?: ProcessingEmailPreview }) {
  if (!data) return null;
  return <div className="text-xs space-y-2 text-slate-600 mb-3">
    <p>신규 {data.newCount}건 · 완료 확인 대기 {data.pendingCount}건. 발송 직전에 목록을 다시 확인합니다.</p>
    {data.manualReview.length > 0 && <div className="rounded border border-amber-200 bg-amber-50 p-2 text-amber-800">
      <p>다음 요청은 확인이 필요해 리마인드에서 제외했어요.</p>
      {data.manualReview.map((r) => <div key={r.requestId}><a className="underline" href={`/admin/accounts?focus=${r.requestId}`} target="_blank" rel="noreferrer">#{r.requestId}</a> — {r.reason}</div>)}
    </div>}
    {!data.copyAllowed && <p>Market 요청이 포함되어 앱의 발송 버튼으로만 보낼 수 있어요.</p>}
  </div>;
}
