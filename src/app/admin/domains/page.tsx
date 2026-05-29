"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface DomainRequest {
  id: number;
  schoolName: string;
  schoolNameEn: string | null;
  domain: string;
  team: string | null;
  note: string | null;
  status: string;
  invoiceNumber: string | null;
  invoiceAmount: string | null;
  invoiceDueDate: string | null;
  paymentLink: string | null;
  paymentDate: string | null;
  paymentMethod: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATUSES = [
  { value: "pending", label: "Jon 처리대기", color: "bg-amber-100 text-amber-700" },
  { value: "done", label: "활성화 완료", color: "bg-blue-100 text-blue-700" },
  { value: "invoiced", label: "인보이스 발행", color: "bg-indigo-100 text-indigo-700" },
  { value: "paid", label: "결제 완료", color: "bg-emerald-100 text-emerald-700" },
];

function fmtMD(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

export default function DomainsPage() {
  const [rows, setRows] = useState<DomainRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<DomainRequest | null>(null);
  const [msg, setMsg] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/domain-requests");
      if (res.ok) setRows(await res.json());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function updateRow(id: number, patch: Partial<DomainRequest>) {
    const res = await fetch("/api/domain-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", id, ...patch }),
    });
    if (res.ok) { await load(); setMsg("저장됨"); setTimeout(() => setMsg(""), 1500); }
  }

  async function deleteRow(id: number) {
    if (!confirm("이 도메인 요청을 삭제할까요?")) return;
    await fetch("/api/domain-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id }) });
    await load();
  }

  if (loading) return <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-4 pb-20 md:pb-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-gray-900">도메인 유료 등록</h1>
          <span className="text-xs text-gray-400">{rows.length}건</span>
        </div>
        {msg && <span className="text-xs text-emerald-600 font-medium">{msg}</span>}
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-2xl border p-10 text-center text-gray-400 text-sm">
          아직 도메인 요청이 없습니다. 학교 관리에서 도메인 입력 후 &quot;Jon에게 유료 등록 요청&quot; 버튼으로 생성하세요.
        </div>
      ) : (
        <div className="bg-white rounded-2xl border divide-y">
          {rows.map((r) => {
            const st = STATUSES.find((s) => s.value === r.status);
            return (
              <div key={r.id} className="px-4 py-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm font-bold text-blue-700">@{r.domain}</span>
                  <span className="text-sm text-gray-700">{r.schoolNameEn || r.schoolName}</span>
                  {r.team && <span className="text-[10px] text-gray-400">{r.team}</span>}
                  <select
                    value={r.status}
                    onChange={(e) => updateRow(r.id, { status: e.target.value })}
                    className={`ml-auto text-[10px] font-medium rounded-full px-2 py-0.5 border-0 cursor-pointer ${st?.color || "bg-gray-100"}`}
                  >
                    {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                  <button onClick={() => setEditing(editing?.id === r.id ? null : r)} className="text-xs text-gray-400 hover:text-gray-700">
                    {editing?.id === r.id ? "닫기" : "💳 인보이스"}
                  </button>
                  <button onClick={() => deleteRow(r.id)} className="text-xs text-gray-300 hover:text-red-500">✕</button>
                </div>
                <div className="flex gap-3 mt-1 text-[10px] text-gray-400">
                  <span>요청 {fmtMD(r.createdAt)}</span>
                  {r.confirmedAt && <span className="text-blue-500">활성화 {fmtMD(r.confirmedAt)}</span>}
                  {r.invoiceNumber && <span className="text-indigo-500">📄 {r.invoiceNumber} {r.invoiceAmount}</span>}
                  {r.paymentDate && <span className="text-emerald-600">✓ 결제 {r.paymentDate}</span>}
                </div>

                {editing?.id === r.id && (
                  <div className="mt-3 grid grid-cols-2 gap-2 bg-gray-50 rounded-lg p-3">
                    <div className="space-y-1"><Label className="text-[10px]">인보이스 번호</Label><Input defaultValue={r.invoiceNumber || ""} onBlur={(e) => e.target.value !== (r.invoiceNumber || "") && updateRow(r.id, { invoiceNumber: e.target.value })} className="h-8 text-xs" /></div>
                    <div className="space-y-1"><Label className="text-[10px]">금액</Label><Input defaultValue={r.invoiceAmount || ""} placeholder="$240.00" onBlur={(e) => e.target.value !== (r.invoiceAmount || "") && updateRow(r.id, { invoiceAmount: e.target.value })} className="h-8 text-xs" /></div>
                    <div className="space-y-1"><Label className="text-[10px]">결제 기한</Label><Input defaultValue={r.invoiceDueDate || ""} placeholder="2026-06-30" onBlur={(e) => e.target.value !== (r.invoiceDueDate || "") && updateRow(r.id, { invoiceDueDate: e.target.value })} className="h-8 text-xs" /></div>
                    <div className="space-y-1"><Label className="text-[10px]">결제 링크</Label><Input defaultValue={r.paymentLink || ""} onBlur={(e) => e.target.value !== (r.paymentLink || "") && updateRow(r.id, { paymentLink: e.target.value })} className="h-8 text-xs" /></div>
                    <div className="space-y-1"><Label className="text-[10px]">결제일</Label><Input defaultValue={r.paymentDate || ""} placeholder="2026-06-15" onBlur={(e) => e.target.value !== (r.paymentDate || "") && updateRow(r.id, { paymentDate: e.target.value })} className="h-8 text-xs" /></div>
                    <div className="space-y-1"><Label className="text-[10px]">결제 수단</Label><Input defaultValue={r.paymentMethod || ""} onBlur={(e) => e.target.value !== (r.paymentMethod || "") && updateRow(r.id, { paymentMethod: e.target.value })} className="h-8 text-xs" /></div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
