"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
export default function SchoolStoreInput({ token, schoolName, quantity, accountType, requestType }: { token: string; schoolName: string; quantity: number; accountType: string; requestType: string }) {
  const [emails, setEmails] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/school-store-links/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emails }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data.error || "접수하지 못했습니다. 잠시 후 다시 시도해 주세요."); return; }
      setEmails(""); setDone(true);
    } catch { setError("연결하지 못했습니다. 잠시 후 다시 시도해 주세요."); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-lg px-5 py-12">
    <p className="text-sm font-semibold text-blue-700">Snorkl · 학교장터 구매</p>
    <h1 className="mt-3 text-2xl font-bold text-slate-900">{schoolName}</h1>
    {done ? <div className="mt-6 rounded-xl bg-emerald-50 p-5" role="status"><h2 className="font-bold">이메일 접수가 완료되었습니다</h2><p className="mt-2 text-sm">담당자가 구매 내역과 계정을 확인한 뒤 {requestType === "extension" ? "이용 기간 연장을" : "업그레이드를"} 요청합니다. 수정이 필요하면 학교장터 구매 담당자에게 알려주세요.</p></div>
      : <form onSubmit={submit} className="mt-6 space-y-5">
        <p className="text-sm leading-relaxed text-slate-600">{accountType === "school" ? "학교 이용권을 연결할 대표 계정" : `${accountType === "student" ? "학생" : "선생님"} ${quantity}명의 계정`} 이메일을 입력해 주세요. Snorkl에 가입한 이메일과 같아야 합니다.</p>
        <div><label htmlFor="snorkl-emails" className="text-sm font-semibold">Snorkl 가입 이메일 {quantity}개</label><Textarea id="snorkl-emails" value={emails} onChange={(e) => setEmails(e.target.value)} required maxLength={130000} rows={Math.min(10, Math.max(3, quantity))} placeholder="teacher@example.com" className="mt-2" /><p className="mt-2 text-xs text-slate-500">한 줄에 하나씩, 전체 이메일을 입력한 뒤 제출해 주세요. 이 링크로 한 번 접수할 수 있습니다.</p></div>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full">{busy ? "접수 중…" : "이메일 제출하기"}</Button>
        <p className="text-xs text-slate-500">입력한 이메일은 Snorkl 계정 {requestType === "extension" ? "연장" : "업그레이드"} 처리와 완료 안내에 사용됩니다.</p>
      </form>}
  </main>;
}
