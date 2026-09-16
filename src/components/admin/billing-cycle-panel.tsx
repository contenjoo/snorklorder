"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface CycleItem { requestId: number; schoolNameEn: string; quantity: number; }
interface Cycle {
  id: number; code: string; status: string; periodStart: string; periodEnd: string;
  invoiceNumber: string | null; lastError: string | null; items: CycleItem[];
  preview: { subject: string; body: string } | null;
}

const labels: Record<string, string> = {
  collecting: "수집 중", ready: "발송 대기", sending: "발송 중", sent: "인보이스 대기",
  send_unknown: "발송 확인 필요", invoice_mismatch: "인보이스 불일치",
  invoiced: "인보이스 확인", payment_mismatch: "결제 불일치", paid: "결제 완료", empty: "대상 없음",
};

export default function BillingCyclePanel({ onMessage }: { onMessage: (message: string) => void }) {
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/billing-cycles", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "통합 청구 원장을 불러오지 못했습니다.");
      setCycles(data.cycles || []);
      setUnassignedCount(data.unassignedCount || 0);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "통합 청구 원장을 불러오지 못했습니다.");
    } finally { setLoading(false); }
  }, [onMessage]);
  useEffect(() => { void load(); }, [load]);

  async function send(cycle: Cycle) {
    if (!window.confirm(`${cycle.code}의 ${cycle.items.length}건을 Cailie에게 통합 청구 메일로 발송하시겠습니까?`)) return;
    setSendingId(cycle.id);
    try {
      const response = await fetch(`/api/admin/billing-cycles/${cycle.id}/send`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "통합 청구 메일 발송에 실패했습니다.");
      onMessage(`✓ ${data.code} 통합 청구 메일 발송 완료`);
      await load();
    } catch (error) {
      onMessage(`⚠️ ${error instanceof Error ? error.message : "발송 결과를 확인하지 못했습니다."}`);
      await load();
    } finally { setSendingId(null); }
  }

  const visible = cycles.filter((cycle) => ["collecting", "ready", "sending", "sent", "send_unknown", "invoice_mismatch", "payment_mismatch"].includes(cycle.status));
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-slate-900">월 2회 통합 청구</h2>
        {unassignedCount > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">미편입 {unassignedCount}건</span>}
        <button onClick={() => void load()} className="ml-auto text-xs text-slate-500 underline" disabled={loading}>새로고침</button>
      </div>
      {loading ? <p className="py-4 text-xs text-slate-400">불러오는 중…</p> : visible.length === 0 ? (
        <p className="py-4 text-xs text-slate-400">진행 중인 청구 주기가 없습니다.</p>
      ) : <div className="mt-3 grid gap-3 lg:grid-cols-2">{visible.map((cycle) => (
        <article key={cycle.id} className={`rounded-lg border p-3 ${cycle.status.includes("mismatch") || cycle.status === "send_unknown" ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-slate-50"}`}>
          <div className="flex items-center gap-2"><strong className="font-mono text-sm">{cycle.code}</strong><span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">{labels[cycle.status] || cycle.status}</span><span className="ml-auto text-xs text-slate-500">{cycle.items.length}건</span></div>
          <ul className="mt-2 max-h-28 overflow-y-auto text-xs text-slate-700">{cycle.items.map((item) => <li key={item.requestId}>[#{item.requestId}] {item.schoolNameEn} · {item.quantity}</li>)}</ul>
          {cycle.lastError && <p className="mt-2 text-xs text-rose-700">{cycle.lastError}</p>}
          {cycle.preview && <details className="mt-2 text-xs"><summary className="cursor-pointer text-slate-600">메일 전체 미리보기</summary><pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded bg-white p-2">{cycle.preview.body}</pre></details>}
          {cycle.status === "ready" && <Button size="sm" className="mt-3 h-7 text-xs" disabled={sendingId === cycle.id} onClick={() => void send(cycle)}>{sendingId === cycle.id ? "발송 중…" : "검토 후 통합 청구 메일 발송"}</Button>}
        </article>
      ))}</div>}
    </section>
  );
}
