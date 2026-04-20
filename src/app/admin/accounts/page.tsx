"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface AccountRequest {
  id: number;
  channel: string;
  applicantType: string;
  type: string;
  schoolName: string;
  schoolNameEn: string | null;
  emails: string;
  accountType: string;
  quantity: number;
  oldEmail: string | null;
  fromType: string | null;
  extensionDate: string | null;
  notes: string | null;
  status: string;
  invoiceNumber: string | null;
  invoiceAmount: string | null;
  invoiceDueDate: string | null;
  paymentLink: string | null;
  paymentDate: string | null;
  paymentMethod: string | null;
  createdAt: string;
  updatedAt: string;
}

const TYPES = [
  { value: "upgrade", label: "업그레이드", icon: "⬆️", en: "Upgrade" },
  { value: "email_change", label: "이메일 변경", icon: "✉️", en: "Email Change" },
  { value: "type_change", label: "타입 변경", icon: "🔄", en: "Type Change" },
  { value: "extension", label: "연장", icon: "📅", en: "Extension" },
];

const CHANNELS = [
  { value: "company", label: "회사몰", icon: "🏢" },
  { value: "school_store", label: "학교장터", icon: "🏫" },
];

const APPLICANT_TYPES = [
  { value: "school", label: "학교", icon: "🏫" },
  { value: "individual", label: "개인", icon: "👤" },
];

const STATUSES = [
  { value: "draft", label: "작성 중", color: "bg-gray-100 text-gray-600", dot: "bg-gray-400" },
  { value: "sent", label: "요청 완료", color: "bg-amber-100 text-amber-700", dot: "bg-amber-400" },
  { value: "processed", label: "처리 완료", color: "bg-green-100 text-green-700", dot: "bg-green-400" },
  { value: "invoiced", label: "인보이스", color: "bg-blue-100 text-blue-700", dot: "bg-blue-400" },
  { value: "paid", label: "결제 완료", color: "bg-purple-100 text-purple-700", dot: "bg-purple-400" },
];

// 이메일 본문 생성 (snorkl-manager 그대로)
function generateEmail(r: AccountRequest) {
  const accLabel = r.accountType === "teacher" ? "teacher" : r.accountType === "student" ? "student" : "school";
  const school = r.schoolNameEn || r.schoolName;
  let subject = "";
  let body = "";

  if (r.type === "upgrade") {
    const isSchool = r.accountType === "school";
    subject = isSchool
      ? `School Upgrade Request – ${school}`
      : `Teacher Upgrade Request – ${school} (${r.quantity || 1} ${accLabel})`;
    const emailList = r.emails.split(/[,;\n]+/).map((e) => e.trim()).filter(Boolean).map((e) => `- Email: ${e}`).join("\n");
    body = isSchool
      ? `Hi Jon,\n\nI'd like to request a school-wide upgrade for ${school}.\n\n${emailList}${r.notes ? `\n\nNote: ${r.notes}` : ""}\n\nPlease let me know once it's done. Thank you.\n\nBanghyun`
      : `Hi Jon,\n\nI'd like to request an upgrade for ${r.quantity || 1} ${accLabel} account${(r.quantity || 1) > 1 ? "s" : ""} for ${school}.\n\n${emailList}${r.notes ? `\n\nNote: ${r.notes}` : ""}\n\nPlease let me know once it's done. Thank you.\n\nBanghyun`;
  } else if (r.type === "email_change") {
    subject = `Account Email Change Request – ${school}`;
    body = `Hi Jon,\n\nCould you please update the email for the account at ${school}?\n\n- Old email: ${r.oldEmail || ""}\n- New email: ${r.emails || ""}${r.notes ? `\n\nNote: ${r.notes}` : ""}\n\nThank you.\n\nBanghyun`;
  } else if (r.type === "type_change") {
    subject = `Account Type Change Request - ${r.emails}`;
    body = `Hi Jon,\n\nThe account ${r.emails || ""} was registered as a ${r.fromType === "teacher" ? "teacher" : "student"}, but this user is a ${r.fromType === "teacher" ? "student" : "teacher"}. Could you please change the account type?${r.notes ? `\n\nNote: ${r.notes}` : ""}\n\nThank you.\n\nBanghyun`;
  } else if (r.type === "extension") {
    subject = `Account Extension Request – ${school}`;
    body = `Hi Jon,\n\nCould you extend the ${r.emails || ""} account through ${r.extensionDate || "[DATE]"}?\n\nPlease send me an invoice for that too.${r.notes ? `\n\nNote: ${r.notes}` : ""}\n\nThanks,\n\nBanghyun`;
  } else {
    subject = `Snorkl Request – ${school}`;
    body = `Hi Jon,\n\n${r.notes || ""}\n\nBanghyun`;
  }
  return { subject, body };
}

export default function AccountsPage() {
  const [requests, setRequests] = useState<AccountRequest[]>([]);
  const [filter, setFilter] = useState("all");
  const [filterChannel, setFilterChannel] = useState("all");
  const [filterApplicant, setFilterApplicant] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AccountRequest | null>(null);
  const [emailPreview, setEmailPreview] = useState<AccountRequest | null>(null);
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState("");

  // Form
  const [fChannel, setFChannel] = useState("company");
  const [fApplicant, setFApplicant] = useState("school");
  const [fType, setFType] = useState("upgrade");
  const [fSchool, setFSchool] = useState("");
  const [fSchoolEn, setFSchoolEn] = useState("");
  const [translating, setTranslating] = useState(false);
  const [fEmails, setFEmails] = useState("");
  const [fAccType, setFAccType] = useState("teacher");
  const [fQty, setFQty] = useState(1);
  const [fOldEmail, setFOldEmail] = useState("");
  const [fFromType, setFFromType] = useState("teacher");
  const [fExtDate, setFExtDate] = useState("");
  const [fNotes, setFNotes] = useState("");
  const [fInvNum, setFInvNum] = useState("");
  const [fInvAmt, setFInvAmt] = useState("");
  const [fInvDue, setFInvDue] = useState("");
  const [fPayLink, setFPayLink] = useState("");
  const [fPayDate, setFPayDate] = useState("");
  const [fPayMethod, setFPayMethod] = useState("");

  async function load() {
    const res = await fetch("/api/account-requests");
    const data = await res.json();
    if (!res.ok) {
      setRequests([]);
      setSendMsg(data.error || "목록을 불러오지 못했습니다");
      return;
    }
    setRequests(Array.isArray(data) ? data : []);
  }
  useEffect(() => { load(); }, []);

  async function translateSchool(korean: string) {
    if (!korean.trim()) return;
    setTranslating(true);
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: korean.trim() }),
      });
      const data = await res.json();
      if (data.translated) setFSchoolEn(data.translated);
    } catch {} finally { setTranslating(false); }
  }

  function resetForm() {
    setFChannel("company"); setFApplicant("school"); setFType("upgrade"); setFSchool(""); setFSchoolEn(""); setFEmails(""); setFAccType("teacher");
    setFQty(1); setFOldEmail(""); setFFromType("teacher"); setFExtDate("");
    setFNotes(""); setFInvNum(""); setFInvAmt(""); setFInvDue("");
    setFPayLink(""); setFPayDate(""); setFPayMethod(""); setEditing(null);
  }

  function openEdit(r: AccountRequest) {
    setEditing(r);
    setFChannel(r.channel || "company"); setFApplicant(r.applicantType || "school"); setFType(r.type); setFSchool(r.schoolName); setFSchoolEn(r.schoolNameEn || ""); setFEmails(r.emails);
    setFAccType(r.accountType || "teacher"); setFQty(r.quantity || 1);
    setFOldEmail(r.oldEmail || ""); setFFromType(r.fromType || "teacher");
    setFExtDate(r.extensionDate || ""); setFNotes(r.notes || "");
    setFInvNum(r.invoiceNumber || ""); setFInvAmt(r.invoiceAmount || "");
    setFInvDue(r.invoiceDueDate || ""); setFPayLink(r.paymentLink || "");
    setFPayDate(r.paymentDate || ""); setFPayMethod(r.paymentMethod || "");
    setOpen(true);
  }

  async function save() {
    const data = {
      channel: fChannel, applicantType: fApplicant, type: fType, schoolName: fSchool, schoolNameEn: fSchoolEn || null, emails: fEmails, accountType: fAccType,
      quantity: fQty, oldEmail: fOldEmail || null, fromType: fFromType || null,
      extensionDate: fExtDate || null, notes: fNotes || null,
      invoiceNumber: fInvNum || null, invoiceAmount: fInvAmt || null,
      invoiceDueDate: fInvDue || null, paymentLink: fPayLink || null,
      paymentDate: fPayDate || null, paymentMethod: fPayMethod || null,
    };
    const res = await fetch("/api/account-requests", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editing ? { action: "update", id: editing.id, ...data } : { action: "create", ...data }),
    });
    const result = await res.json();
    if (!res.ok) {
      setSendMsg(result.error || "저장에 실패했습니다");
      return;
    }
    setSendMsg(editing ? "✓ 수정 완료" : "✓ 생성 완료");
    resetForm(); setOpen(false); load();
  }

  async function updateStatus(id: number, status: string) {
    const res = await fetch("/api/account-requests", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", id, status }),
    });
    const result = await res.json();
    if (!res.ok) {
      setSendMsg(result.error || "상태 변경에 실패했습니다");
      return;
    }
    load();
  }

  async function deleteRequest(id: number) {
    if (!confirm("삭제할까요?")) return;
    const res = await fetch("/api/account-requests", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });
    const result = await res.json();
    if (!res.ok) {
      setSendMsg(result.error || "삭제에 실패했습니다");
      return;
    }
    setSendMsg("✓ 삭제 완료");
    load();
  }

  // Jon에게 이메일 발송 (Nodemailer 통해)
  async function sendToJon(r: AccountRequest) {
    const { subject, body } = generateEmail(r);
    setSending(true); setSendMsg("");
    try {
      const res = await fetch("/api/account-email", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: r.id, subject, body }),
      });
      const data = await res.json();
      if (data.success) {
        setSendMsg("✓ 발송 완료");
        setEmailPreview(null);
        load();
      } else {
        setSendMsg("실패: " + (data.error || ""));
      }
    } catch { setSendMsg("연결 오류"); }
    finally { setSending(false); }
  }

  // Gmail 열기
  function openGmail(r: AccountRequest) {
    const { subject, body } = generateEmail(r);
    const mailto = `mailto:jon@snorkl.app?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(mailto, "_blank");
  }

  // 클립보드 복사
  function copyEmail(r: AccountRequest) {
    const { subject, body } = generateEmail(r);
    navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
    setSendMsg("📋 복사됨");
    setTimeout(() => setSendMsg(""), 2000);
  }

  const filtered = requests.filter((r) => {
    if (filter !== "all" && r.status !== filter) return false;
    if (filterChannel !== "all" && (r.channel || "company") !== filterChannel) return false;
    if (filterApplicant !== "all" && (r.applicantType || "school") !== filterApplicant) return false;
    if (filterType !== "all" && r.type !== filterType) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!r.schoolName.toLowerCase().includes(q) && !r.emails.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const statusCounts = STATUSES.map((s) => ({ ...s, count: requests.filter((r) => r.status === s.value).length }));
  const emailCount = requests.reduce((s, r) => s + r.emails.split(/[,;\n]+/).filter((e) => e.trim() && e.includes("@")).length, 0);

  return (
    <div className="space-y-3 pb-20 md:pb-0">
      {/* Compact header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-gray-900">정산</h1>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span><strong className="text-gray-900 text-sm">{requests.length}</strong> 건</span>
            <span className="text-gray-200">|</span>
            <span><strong className="text-gray-900 text-sm">{emailCount}</strong> 명</span>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:ml-auto w-full sm:w-auto">
          <Input placeholder="검색..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full sm:w-36 h-7 text-xs" />
          <div className="flex items-center gap-1.5">
            <Select value={filterApplicant} onValueChange={(v) => setFilterApplicant(v ?? "all")}>
              <SelectTrigger className="w-24 h-7 text-[11px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">신청주체</SelectItem>
                {APPLICANT_TYPES.map((a) => <SelectItem key={a.value} value={a.value}>{a.icon} {a.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterChannel} onValueChange={(v) => setFilterChannel(v ?? "all")}>
              <SelectTrigger className="w-24 h-7 text-[11px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">구매처</SelectItem>
                {CHANNELS.map((c) => <SelectItem key={c.value} value={c.value}>{c.icon} {c.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterType} onValueChange={(v) => setFilterType(v ?? "all")}>
              <SelectTrigger className="w-24 h-7 text-[11px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">유형</SelectItem>
                {TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.icon} {t.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
              <DialogTrigger className="inline-flex items-center justify-center rounded-md text-xs font-semibold bg-gray-900 text-white h-7 px-3 hover:bg-gray-800 cursor-pointer whitespace-nowrap">
                + 새 요청
              </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editing ? "요청 수정" : "새 요청"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="flex gap-1">
                  {APPLICANT_TYPES.map((a) => (
                    <button key={a.value} onClick={() => setFApplicant(a.value)}
                      className={`flex-1 py-2 rounded-lg text-xs text-center transition-colors ${fApplicant === a.value ? "bg-purple-100 ring-1 ring-purple-400 font-semibold" : "bg-gray-50 hover:bg-gray-100"}`}>
                      {a.icon} {a.label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1">
                  {CHANNELS.map((c) => (
                    <button key={c.value} onClick={() => setFChannel(c.value)}
                      className={`flex-1 py-2 rounded-lg text-xs text-center transition-colors ${fChannel === c.value ? "bg-indigo-100 ring-1 ring-indigo-400 font-semibold" : "bg-gray-50 hover:bg-gray-100"}`}>
                      {c.icon} {c.label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {TYPES.map((t) => (
                    <button key={t.value} onClick={() => setFType(t.value)}
                      className={`p-2 rounded-lg text-xs text-center transition-colors ${fType === t.value ? "bg-blue-100 ring-1 ring-blue-400 font-semibold" : "bg-gray-50 hover:bg-gray-100"}`}>
                      {t.icon}<br />{t.label}
                    </button>
                  ))}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{fApplicant === "individual" ? "이름 *" : "학교명 *"}</Label>
                  <Input value={fSchool} onChange={(e) => setFSchool(e.target.value)} onBlur={() => fApplicant !== "individual" && !fSchoolEn && translateSchool(fSchool)} placeholder={fApplicant === "individual" ? "이름" : "한국어 학교명"} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{fApplicant === "individual" ? "영문 이름 (선택)" : "영문 학교명"} {translating && <span className="text-blue-500 animate-pulse">번역 중...</span>}</Label>
                  <Input value={fSchoolEn} onChange={(e) => setFSchoolEn(e.target.value)} placeholder={fApplicant === "individual" ? "English Name" : "English School Name (자동 번역)"} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">이메일 *</Label>
                  <Textarea value={fEmails} onChange={(e) => setFEmails(e.target.value)} placeholder="이메일 (여러 개는 쉼표/줄바꿈)" rows={2} className="text-sm" />
                </div>
                {fType === "upgrade" && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">계정 타입</Label>
                      <Select value={fAccType} onValueChange={(v) => setFAccType(v ?? "teacher")}>
                        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="teacher">Teacher</SelectItem>
                          <SelectItem value="student">Student</SelectItem>
                          <SelectItem value="school">School</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">수량</Label>
                      <Input type="number" value={fQty} onChange={(e) => setFQty(parseInt(e.target.value) || 1)} min={1} className="h-8 text-sm" />
                    </div>
                  </div>
                )}
                {fType === "email_change" && (
                  <div className="space-y-1">
                    <Label className="text-xs">기존 이메일</Label>
                    <Input value={fOldEmail} onChange={(e) => setFOldEmail(e.target.value)} placeholder="old@email.com" className="h-8 text-sm" />
                  </div>
                )}
                {fType === "type_change" && (
                  <div className="flex gap-2">
                    {["teacher", "student"].map((t) => (
                      <button key={t} onClick={() => setFFromType(t)}
                        className={`flex-1 py-2 rounded text-xs ${fFromType === t ? "bg-blue-100 ring-1 ring-blue-400 font-semibold" : "bg-gray-50"}`}>
                        {t === "teacher" ? "교사 → 학생" : "학생 → 교사"}
                      </button>
                    ))}
                  </div>
                )}
                {fType === "extension" && (
                  <div className="space-y-1">
                    <Label className="text-xs">만료일</Label>
                    <Input type="date" value={fExtDate} onChange={(e) => setFExtDate(e.target.value)} className="h-8 text-sm" />
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-xs">메모</Label>
                  <Textarea value={fNotes} onChange={(e) => setFNotes(e.target.value)} rows={2} placeholder="추가 메모" className="text-sm" />
                </div>
                {editing && (
                  <details className="border rounded-lg p-3">
                    <summary className="text-xs font-medium cursor-pointer">💳 인보이스/결제 정보</summary>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <div className="space-y-1"><Label className="text-[10px]">인보이스 #</Label><Input value={fInvNum} onChange={(e) => setFInvNum(e.target.value)} className="h-7 text-xs" /></div>
                      <div className="space-y-1"><Label className="text-[10px]">금액</Label><Input value={fInvAmt} onChange={(e) => setFInvAmt(e.target.value)} placeholder="$80.00" className="h-7 text-xs" /></div>
                      <div className="space-y-1"><Label className="text-[10px]">결제 기한</Label><Input value={fInvDue} onChange={(e) => setFInvDue(e.target.value)} placeholder="April 30, 2026" className="h-7 text-xs" /></div>
                      <div className="space-y-1"><Label className="text-[10px]">결제 링크</Label><Input value={fPayLink} onChange={(e) => setFPayLink(e.target.value)} className="h-7 text-xs" /></div>
                      <div className="space-y-1"><Label className="text-[10px]">결제일</Label><Input value={fPayDate} onChange={(e) => setFPayDate(e.target.value)} className="h-7 text-xs" /></div>
                      <div className="space-y-1"><Label className="text-[10px]">결제 방법</Label><Input value={fPayMethod} onChange={(e) => setFPayMethod(e.target.value)} placeholder="MasterCard ••1234" className="h-7 text-xs" /></div>
                    </div>
                  </details>
                )}
                <Button onClick={save} className="w-full h-9">{editing ? "수정" : "생성"}</Button>
              </div>
            </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      {/* Status filter pills */}
      <div className="flex gap-1 flex-wrap">
        <button onClick={() => setFilter("all")}
          className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${filter === "all" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500"}`}>
          전체 {requests.length}
        </button>
        {statusCounts.map((s) => (
          <button key={s.value} onClick={() => setFilter(filter === s.value ? "all" : s.value)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${filter === s.value ? "bg-gray-900 text-white" : s.color}`}>
            {s.label} {s.count}
          </button>
        ))}
      </div>

      {/* Request list */}
      <div className="bg-white rounded-xl border overflow-hidden">
        {/* Desktop header */}
        <div className="hidden md:grid grid-cols-[auto_1fr_auto_auto_auto] gap-2 px-3 py-1.5 bg-gray-50 border-b text-[10px] text-gray-400 font-medium uppercase tracking-wider">
          <span className="w-5"></span>
          <span>학교 / 이메일</span>
          <span className="w-20 text-center">상태</span>
          <span className="w-24 text-center">결제</span>
          <span className="w-28 text-right">액션</span>
        </div>

        {filtered.map((r) => {
          const typeInfo = TYPES.find((t) => t.value === r.type);
          const statusInfo = STATUSES.find((s) => s.value === r.status);
          const emails = r.emails.split(/[,;\n]+/).map((e) => e.trim()).filter(Boolean);

          return (
            <div key={r.id} className="border-b last:border-b-0 hover:bg-gray-50/50">
              {/* Desktop row */}
              <div className="hidden md:grid grid-cols-[auto_1fr_auto_auto_auto] gap-2 px-3 py-2 items-center">
                <span className="text-sm w-5 text-center" title={typeInfo?.label}>{typeInfo?.icon}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-sm text-gray-900 truncate">{r.schoolName}</span>
                    {r.schoolNameEn && <span className="text-[10px] text-gray-400 truncate hidden lg:inline">({r.schoolNameEn})</span>}
                    {(r.applicantType || "school") === "individual" && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700 font-medium">개인</span>
                    )}
                    {(r.channel || "company") === "school_store" && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">학교장터</span>
                    )}
                    <span className="text-[10px] text-gray-400">{emails.length > 1 ? `${emails.length}명` : ""}</span>
                  </div>
                  <div className="text-[11px] font-mono text-gray-500 truncate">
                    {emails.length <= 2 ? emails.join(", ") : `${emails[0]} +${emails.length - 1}`}
                  </div>
                </div>
                <div className="w-20">
                  <select value={r.status} onChange={(e) => updateStatus(r.id, e.target.value)}
                    className={`w-full text-[10px] font-medium rounded-full px-2 py-0.5 border-0 cursor-pointer ${statusInfo?.color || "bg-gray-100"}`}>
                    {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                <div className="w-24 text-center">
                  {r.invoiceAmount ? (
                    <div className="text-[11px]">
                      <span className="font-semibold text-gray-700">{r.invoiceAmount}</span>
                      {r.paymentDate && <span className="text-emerald-600 ml-1">✓</span>}
                    </div>
                  ) : <span className="text-[10px] text-gray-300">—</span>}
                  {r.invoiceNumber && <div className="text-[9px] text-gray-400">{r.invoiceNumber}</div>}
                </div>
                <div className="w-28 flex items-center justify-end gap-0.5">
                  <button onClick={() => setEmailPreview(r)} className="w-7 h-7 rounded flex items-center justify-center text-sm hover:bg-blue-50 text-gray-400 hover:text-blue-600" title="미리보기">📧</button>
                  <button onClick={() => openGmail(r)} className="w-7 h-7 rounded flex items-center justify-center text-sm hover:bg-gray-100 text-gray-400 hover:text-gray-600" title="Gmail">📨</button>
                  <button onClick={() => copyEmail(r)} className="w-7 h-7 rounded flex items-center justify-center text-sm hover:bg-gray-100 text-gray-400 hover:text-gray-600" title="복사">📋</button>
                  <button onClick={() => openEdit(r)} className="w-7 h-7 rounded flex items-center justify-center text-sm hover:bg-gray-100 text-gray-400 hover:text-gray-600" title="수정">✎</button>
                  <button onClick={() => deleteRequest(r.id)} className="w-7 h-7 rounded flex items-center justify-center text-sm hover:bg-red-50 text-gray-300 hover:text-red-500" title="삭제">✕</button>
                </div>
              </div>

              {/* Mobile row */}
              <div className="md:hidden px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{typeInfo?.icon}</span>
                  <span className="font-medium text-sm text-gray-900 truncate flex-1">
                    {(r.applicantType || "school") === "individual" && <span className="text-[9px] px-1 py-0.5 rounded bg-purple-50 text-purple-700 font-medium mr-1">개인</span>}
                    {r.schoolName}
                  </span>
                  <select value={r.status} onChange={(e) => updateStatus(r.id, e.target.value)}
                    className={`text-[10px] font-medium rounded-full px-2 py-0.5 border-0 ${statusInfo?.color || "bg-gray-100"}`}>
                    {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                <div className="text-[11px] font-mono text-gray-500 truncate mt-0.5 ml-6">
                  {emails.length <= 2 ? emails.join(", ") : `${emails[0]} +${emails.length - 1}`}
                </div>
                <div className="flex items-center gap-1.5 mt-1.5 ml-6">
                  <button onClick={() => setEmailPreview(r)} className="text-[11px] text-gray-400 hover:text-blue-600 px-2 py-1 rounded bg-gray-50 min-h-[28px]">미리보기</button>
                  <button onClick={() => copyEmail(r)} className="text-[11px] text-gray-400 hover:text-blue-600 px-2 py-1 rounded bg-gray-50 min-h-[28px]">복사</button>
                  <button onClick={() => openEdit(r)} className="text-[11px] text-gray-400 hover:text-blue-600 px-2 py-1 rounded bg-gray-50 min-h-[28px]">수정</button>
                  {r.invoiceAmount && <span className="text-[10px] font-semibold text-gray-700 ml-auto">{r.invoiceAmount}{r.paymentDate && " ✓"}</span>}
                </div>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="py-8 text-center text-gray-400 text-sm">
            {requests.length === 0 ? "계정 요청이 없습니다" : "검색 결과 없음"}
          </div>
        )}
      </div>

      {/* 상태 메시지 */}
      {sendMsg && (
        <div className={`fixed bottom-4 right-4 px-4 py-2 rounded-lg text-sm font-medium shadow-lg z-50 ${sendMsg.includes("✓") || sendMsg.includes("📋") ? "bg-green-600 text-white" : "bg-red-600 text-white"}`}>
          {sendMsg}
        </div>
      )}

      {/* Email Preview Modal */}
      {emailPreview && (() => {
        const { subject, body } = generateEmail(emailPreview);
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setEmailPreview(null)}>
            <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="p-4 border-b bg-gray-50 rounded-t-xl">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-sm">Jon에게 보낼 이메일</h3>
                  <button onClick={() => setEmailPreview(null)} className="text-gray-400 hover:text-gray-600">✕</button>
                </div>
                <div className="text-xs text-gray-500 space-y-0.5">
                  <div><b>To:</b> jon@snorkl.app</div>
                  <div><b>Subject:</b> {subject}</div>
                </div>
              </div>
              <div className="p-4">
                <pre className="text-sm text-gray-800 whitespace-pre-wrap font-sans leading-relaxed">{body}</pre>
              </div>
              <div className="p-3 border-t bg-gray-50 rounded-b-xl flex items-center gap-2">
                <Button size="sm" onClick={() => sendToJon(emailPreview)} disabled={sending} className="bg-blue-600 hover:bg-blue-700 text-xs">
                  {sending ? "발송 중..." : "📧 발송하기"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => openGmail(emailPreview)} className="text-xs">
                  Gmail에서 열기
                </Button>
                <Button size="sm" variant="outline" onClick={() => copyEmail(emailPreview)} className="text-xs">
                  복사
                </Button>
                <span className="text-[10px] text-gray-400 ml-auto">
                  발송 후 자동으로 &quot;요청 완료&quot;로 변경됩니다
                </span>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
