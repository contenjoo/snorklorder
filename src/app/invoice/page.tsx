"use client";

// Cailie 의 인보이스 확인 페이지.
//
// 목적 한 줄: "내가 이거 보냈나?" 를 메일을 뒤지지 않고 답하게 하는 것.
// 그래서 링크가 늘 같고(북마크 한 번), 로그인이 없고, 위/아래 두 목록뿐이다.
// 위 = 남은 것, 아래 = 최근 끝낸 것. 여기 없으면 끝난 것이다.
//
// **읽기 전용이다. 버튼을 두지 말 것.** 목록을 닫는 일은 인보이스 번호를 받는 쪽
// (관리자 정산 화면)이 맡는다. 인보이스를 보내면 Cailie 의 일은 끝이고, 여기서 한 번 더
// 누르게 하면 안 눌렀을 때 목록이 거짓말을 한다.

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

interface OpenItem {
  id: number;
  school: string;
  what: string;
  emailedAt: string | null;
}

interface DoneItem {
  id: number;
  school: string;
  what: string;
  invoiceNumber: string | null;
  markedAt: string;
  paid: boolean;
}

/** 메일 본문이 UTC 기준 날짜를 쓰므로 화면도 UTC 로 맞춘다 — 하루 어긋나 보이면 대조가 안 된다. */
function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function InvoiceLedger() {
  const token = useSearchParams().get("k") ?? "";

  const [open, setOpen] = useState<OpenItem[]>([]);
  const [recent, setRecent] = useState<DoneItem[]>([]);
  const [recentTruncated, setRecentTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch(`/api/invoice?k=${encodeURIComponent(token)}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Could not load the list.");
        return;
      }
      setOpen(data.open ?? []);
      setRecent(data.recent ?? []);
      setRecentTruncated(Boolean(data.recentTruncated));
    } catch {
      setError("Connection error. Please refresh.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <p className="py-20 text-center text-slate-400">Loading…</p>;
  }

  if (error) {
    return (
      <div className="py-20 text-center">
        <p className="text-slate-900 font-medium">{error}</p>
        <p className="text-sm text-slate-500 mt-2">
          Please use the link from the most recent invoice email.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end gap-4">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-slate-400">
            Snorkl · Billing
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">Invoice list</h1>
          <p className="text-sm text-slate-500 mt-1">Anything not on this page is already done.</p>
        </div>
        <div className="ml-auto text-right">
          <div className="text-3xl font-bold text-amber-600 tabular-nums leading-none">
            {open.length}
          </div>
          <div className="text-xs font-mono text-slate-400 mt-1">waiting for invoice</div>
        </div>
      </header>

      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="flex items-baseline gap-2 px-5 py-3 border-b border-slate-100">
          <h2 className="text-xs font-mono uppercase tracking-widest text-amber-700">
            Waiting for invoice
          </h2>
          <span className="text-xs font-mono text-slate-400 tabular-nums">{open.length}</span>
        </div>

        {open.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-400 italic">Nothing waiting — all caught up.</p>
        ) : (
          <ul>
            {open.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 border-b border-slate-100 last:border-b-0"
              >
                <span className="font-mono text-xs font-bold text-slate-400 tabular-nums w-12 shrink-0">
                  #{r.id}
                </span>
                <span className="min-w-0 flex-1 basis-[calc(100%-4rem)] sm:basis-auto">
                  <span className="block text-sm font-medium text-slate-900">{r.school}</span>
                  <span className="block text-xs text-slate-500">{r.what}</span>
                </span>
                <span className="font-mono text-[11px] text-slate-400 text-right shrink-0 ml-16 sm:ml-auto">
                  <span className="block uppercase tracking-wider opacity-75">emailed</span>
                  {shortDate(r.emailedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-baseline gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50/60">
          <h2 className="text-xs font-mono uppercase tracking-widest text-emerald-700">
            Recently invoiced
          </h2>
          <span className="text-xs font-mono text-slate-400">
            {recentTruncated ? `most recent ${recent.length}` : "last 30 days"}
          </span>
        </div>

        {recent.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-400 italic">Nothing in the last 30 days.</p>
        ) : (
          <ul>
            {recent.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 border-b border-slate-100 last:border-b-0"
              >
                <span className="font-mono text-xs font-bold text-slate-400 tabular-nums w-12 shrink-0">
                  #{r.id}
                </span>
                <span className="min-w-0 flex-1 basis-[calc(100%-4rem)] sm:basis-auto">
                  <span className="block text-sm font-medium text-slate-900">{r.school}</span>
                  <span className="block text-xs text-slate-500">{r.what}</span>
                </span>
                <span className="font-mono text-[11px] text-slate-400 text-right shrink-0 ml-16 sm:ml-0">
                  <span className="block uppercase tracking-wider opacity-75">
                    {r.paid ? "paid" : "marked"}
                  </span>
                  {shortDate(r.markedAt)}
                </span>
                <span className="shrink-0 ml-auto sm:ml-0 rounded bg-emerald-50 px-2 py-1 font-mono text-[11px] text-emerald-700">
                  {r.invoiceNumber || "✓ invoiced"}
                </span>
              </li>
            ))}
          </ul>
        )}

        <p className="px-5 py-3 border-t border-slate-100 bg-slate-50/60 text-xs text-slate-500">
          This page is read-only. A request drops off the top list as soon as its invoice number is
          recorded on our side — you don&apos;t need to do anything here.
        </p>
      </section>
    </div>
  );
}

export default function InvoicePage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-3xl">
        <Suspense fallback={<p className="py-20 text-center text-slate-400">Loading…</p>}>
          <InvoiceLedger />
        </Suspense>
      </div>
    </main>
  );
}
