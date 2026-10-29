"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export default function SchoolStoreLinkDialog() {
  const [open, setOpen] = useState(false);
  const [schoolName, setSchoolName] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [accountType, setAccountType] = useState("teacher");
  const [type, setType] = useState("upgrade");
  const [termYears, setTermYears] = useState(1);
  const [extensionDate, setExtensionDate] = useState("");
  const [url, setUrl] = useState("");
  const [expiry, setExpiry] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function generate(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/school-store-links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ schoolName, quantity, accountType, type, termYears, extensionDate }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(data.error || "링크를 만들지 못했습니다."); return; }
      setUrl(data.url); setExpiry(new Date(data.expiresAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }));
    } catch { setMessage("연결하지 못했습니다. 다시 시도해 주세요."); }
    finally { setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(url); setMessage("링크를 복사했습니다. 학교 담당자에게 보내주세요."); }
    catch { setMessage("아래 링크를 선택해서 직접 복사해 주세요."); }
  }
  return <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}>
    <DialogTrigger className="inline-flex h-7 items-center rounded-md border border-slate-300 px-3 text-xs font-semibold whitespace-nowrap hover:bg-slate-50">학교장터 이메일 입력 링크</DialogTrigger>
    <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
      <DialogHeader><DialogTitle>학교장터 이메일 입력 링크 만들기</DialogTitle></DialogHeader>
      {url ? <div className="space-y-4">
        <p className="text-sm">{schoolName} 담당자에게 아래 링크를 보내주세요. 이메일이 제출되면 ‘학교장터 · 초안’으로 접수됩니다.</p>
        <div><Label htmlFor="school-store-url">생성된 링크</Label><Input id="school-store-url" readOnly value={url} onFocus={(e) => e.target.select()} className="mt-2" /></div>
        <p className="text-xs text-slate-500">{expiry}까지 유효 · 1회 접수 · 자동 발송 없이 직접 공유</p>
        <Button onClick={copy}>링크 복사</Button>
        <Button variant="outline" onClick={() => { setUrl(""); setMessage(""); }}>다른 구매 건 링크 만들기</Button>
        <p className="text-xs text-slate-500">같은 구매 건은 위 링크를 다시 복사해 주세요. 새 링크를 만들면 별도 요청으로 접수됩니다.</p>
      </div> : <form onSubmit={generate} className="space-y-4">
        <p className="text-sm text-slate-600">구매 정보를 정한 뒤 링크를 복사해 학교 담당자에게 보내세요. 제출된 계정은 확인 후 Jon에게 전달합니다.</p>
        <div><Label htmlFor="store-school-name">학교명</Label><Input id="store-school-name" value={schoolName} onChange={(e) => setSchoolName(e.target.value)} required maxLength={100} className="mt-1" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label htmlFor="store-account-type">계정 종류</Label><select id="store-account-type" value={accountType} onChange={(e) => { setAccountType(e.target.value); if (e.target.value === "school") setQuantity(1); }} className="mt-1 h-9 w-full rounded-md border px-2 text-sm"><option value="teacher">교사</option><option value="student">학생</option><option value="school">학교 단체</option></select></div>
          <div><Label htmlFor="store-quantity">{accountType === "school" ? "대표 계정 수" : "구매 계정 수"}</Label><Input id="store-quantity" type="number" min={1} max={500} value={quantity} disabled={accountType === "school"} onChange={(e) => setQuantity(Number(e.target.value))} required className="mt-1" /></div>
          <div><Label htmlFor="store-type">신청 유형</Label><select id="store-type" value={type} onChange={(e) => setType(e.target.value)} className="mt-1 h-9 w-full rounded-md border px-2 text-sm"><option value="upgrade">업그레이드</option><option value="extension">이용 기간 연장</option></select></div>
          <div><Label htmlFor="store-term">구매 기간</Label><select id="store-term" value={termYears} onChange={(e) => setTermYears(Number(e.target.value))} className="mt-1 h-9 w-full rounded-md border px-2 text-sm"><option value={1}>1년</option><option value={2}>2년</option></select></div>
        </div>
        {type === "extension" && <div><Label htmlFor="store-expiry">연장 후 이용 종료일</Label><Input id="store-expiry" type="date" value={extensionDate} onChange={(e) => setExtensionDate(e.target.value)} required className="mt-1" /></div>}
        <Button type="submit" disabled={busy}>{busy ? "생성 중…" : "링크 만들기"}</Button>
      </form>}
      {message && <p role="status" className="text-sm text-blue-800">{message}</p>}
    </DialogContent>
  </Dialog>;
}
