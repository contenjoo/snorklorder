"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

interface Item { requestId: number; schoolNameEn: string; requestType: string; accountType: string | null; quantity: number; extensionDate: string | null; }
interface Cycle { id: number; code: string; status: string; periodStart: string; periodEnd: string; sentAt: string | null; invoiceNumber: string | null; paidAt: string | null; items: Item[]; }
interface Ledger { collecting: Cycle[]; awaiting: Cycle[]; issues: Cycle[]; recent: Cycle[]; }

const labels: Record<string, string> = {
  collecting: "Collecting", ready: "Ready for review", sending: "Sending", sent: "Waiting for invoice",
  send_unknown: "Delivery needs review", invoice_mismatch: "Invoice mismatch", payment_mismatch: "Payment mismatch",
  invoiced: "Invoiced", paid: "Paid", empty: "No requests",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Seoul" });
}

function what(item: Item) {
  if (item.requestType === "extension") return `Extend ${item.quantity} ${item.accountType || "account"}${item.quantity === 1 ? "" : "s"}${item.extensionDate ? ` to ${item.extensionDate}` : ""}`;
  return `${item.requestType.replaceAll("_", " ")} · ${item.quantity} ${item.accountType || "account"}${item.quantity === 1 ? "" : "s"}`;
}

function CycleCard({ cycle, tone = "slate" }: { cycle: Cycle; tone?: "slate" | "amber" | "rose" | "green" }) {
  const styles = { slate: "border-slate-200", amber: "border-amber-300", rose: "border-rose-300", green: "border-emerald-200" };
  return <article className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${styles[tone]}`}>
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
      <strong className="font-mono text-sm text-slate-900">{cycle.code}</strong>
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{labels[cycle.status] || cycle.status}</span>
      <span className="ml-auto text-xs text-slate-400">{formatDate(cycle.periodStart)} – {formatDate(cycle.periodEnd)}</span>
    </div>
    {cycle.items.length === 0 ? <p className="px-4 py-5 text-sm italic text-slate-400">No requests in this cycle.</p> : <ul>{cycle.items.map((item) => <li key={item.requestId} className="grid grid-cols-[3.5rem_1fr] gap-2 border-b border-slate-100 px-4 py-3 last:border-0 sm:grid-cols-[3.5rem_1fr_auto]">
      <span className="font-mono text-xs font-bold text-slate-400">#{item.requestId}</span>
      <span><span className="block text-sm font-medium text-slate-900">{item.schoolNameEn}</span><span className="block text-xs capitalize text-slate-500">{what(item)}</span></span>
      <span className="col-start-2 font-mono text-xs text-slate-400 sm:col-start-auto">qty {item.quantity}</span>
    </li>)}</ul>}
    {(cycle.invoiceNumber || cycle.paidAt) && <div className="border-t border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-500">{cycle.invoiceNumber && <>Invoice {cycle.invoiceNumber}</>}{cycle.paidAt && <span className="ml-3 text-emerald-700">Paid</span>}</div>}
  </article>;
}

function Section({ title, cycles, tone, empty }: { title: string; cycles: Cycle[]; tone: "slate" | "amber" | "rose" | "green"; empty: string }) {
  return <section className="space-y-3"><div className="flex items-baseline gap-2"><h2 className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-slate-600">{title}</h2><span className="text-xs text-slate-400">{cycles.length}</span></div>{cycles.length ? cycles.map((cycle) => <CycleCard key={cycle.id} cycle={cycle} tone={tone} />) : <p className="rounded-xl border border-dashed border-slate-200 px-4 py-5 text-sm italic text-slate-400">{empty}</p>}</section>;
}

function InvoiceLedger() {
  const token = useSearchParams().get("k") ?? "";
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/invoice?k=${encodeURIComponent(token)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load the list.");
      setLedger(data);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Connection error. Please refresh."); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  if (error) return <div className="py-20 text-center"><p className="font-medium text-slate-900">{error}</p><p className="mt-2 text-sm text-slate-500">Please use the link from the most recent invoice email.</p></div>;
  if (!ledger) return <p className="py-20 text-center text-slate-400">Loading…</p>;
  const waiting = ledger.awaiting.reduce((sum, cycle) => sum + cycle.items.length, 0);
  return <div className="space-y-8">
    <header className="flex flex-wrap items-end gap-4 border-b border-slate-200 pb-6"><div><div className="font-mono text-xs uppercase tracking-[0.2em] text-slate-400">Snorkl · Consolidated billing</div><h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Invoice cycles</h1><p className="mt-2 max-w-xl text-sm text-slate-500">This read-only ledger is the shared source of truth for each twice-monthly invoice.</p></div><div className="ml-auto text-right"><div className="text-4xl font-bold text-amber-600">{waiting}</div><div className="font-mono text-[11px] uppercase text-slate-400">requests awaiting invoice</div></div></header>
    <Section title="Awaiting invoice" cycles={ledger.awaiting} tone="amber" empty="Nothing is waiting for an invoice." />
    {ledger.issues.length > 0 && <Section title="Needs review" cycles={ledger.issues} tone="rose" empty="No issues." />}
    <Section title="Current collection" cycles={ledger.collecting} tone="slate" empty="No active collection cycle." />
    <Section title="Recent cycles" cycles={ledger.recent} tone="green" empty="No completed cycles yet." />
    <p className="pb-4 text-xs text-slate-400">This page contains school names and request summaries only. It does not expose teacher email addresses.</p>
  </div>;
}

export default function InvoicePage() {
  return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#fff7ed,_#f8fafc_42%,_#ecfdf5)] px-4 py-10"><div className="mx-auto w-full max-w-4xl"><Suspense fallback={<p className="py-20 text-center text-slate-400">Loading…</p>}><InvoiceLedger /></Suspense></div></main>;
}
