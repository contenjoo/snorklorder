"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
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
import { dDayInfo } from "@/lib/ui-format";
// 미리보기 = 실제 발송. 수신자 규칙과 본문 생성은 전부 이 SSOT 모듈에서만 가져온다.
import {
  HQ_TO,
  HQ_INVOICE_CC,
  defaultNeedsInvoice,
  generateAccountEmail,
  buildBatchEmail,
  type BatchEmailItem,
} from "@/lib/account-email-template";

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
  needsInvoice: boolean;
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

function fmtMD(s: string | null | undefined) {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "—";
  return `${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getDate().toString().padStart(2, "0")}`;
}

const TYPES = [
  { value: "upgrade", label: "업그레이드", icon: "⬆️" },
  { value: "email_change", label: "이메일 변경", icon: "✉️" },
  { value: "type_change", label: "타입 변경", icon: "🔄" },
  { value: "extension", label: "연장", icon: "📅" },
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
  { value: "draft", label: "작성 중", color: "bg-gray-100 text-gray-600" },
  { value: "sent", label: "요청 완료", color: "bg-amber-100 text-amber-700" },
  { value: "processed", label: "처리 완료", color: "bg-green-100 text-green-700" },
  { value: "invoiced", label: "인보이스", color: "bg-blue-100 text-blue-700" },
  { value: "paid", label: "결제 완료", color: "bg-purple-100 text-purple-700" },
];

// 묶음 제목의 "N emails" 는 서버(parseEmailList)와 같은 규칙으로 세어야 미리보기 제목이 실제와 일치한다.
// security.ts 는 next/server 를 import 하므로 클라이언트에서 쓸 수 없어 동일 규칙만 여기서 반복한다.
function countEmails(raw: string): number {
  return new Set(
    raw
      .split(/[,;\n]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)),
  ).size;
}

function AccountsPageContent() {
  // 대시보드/커맨드 팔레트 연동: ?filter=상태 로 초기 필터, ?focus=id 로 해당 행 스크롤+강조,
  // ?new=1 로 새 요청 다이얼로그 자동 오픈
  const searchParams = useSearchParams();
  const filterParam = searchParams.get("filter");
  const focusId = Number(searchParams.get("focus")) || null;
  const newParam = searchParams.get("new") === "1";

  const [requests, setRequests] = useState<AccountRequest[]>([]);
  const [filter, setFilter] = useState(
    filterParam && STATUSES.some((s) => s.value === filterParam) ? filterParam : "all"
  );
  const [focusHighlight, setFocusHighlight] = useState<number | null>(null);
  const focusedOnce = useRef(false);
  const openedNewOnce = useRef(false);
  const [filterChannel, setFilterChannel] = useState("all");
  const [filterApplicant, setFilterApplicant] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [filterInvoice, setFilterInvoice] = useState("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AccountRequest | null>(null);
  const [emailPreview, setEmailPreview] = useState<AccountRequest | null>(null);
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchPreviewOpen, setBatchPreviewOpen] = useState(false);

  // Form
  const [fChannel, setFChannel] = useState("company");
  const [fApplicant, setFApplicant] = useState("school");
  const [fBulk, setFBulk] = useState(false);
  const [fBulkText, setFBulkText] = useState("");
  const [fType, setFType] = useState("upgrade");
  const [fSchool, setFSchool] = useState("");
  const [fSchoolEn, setFSchoolEn] = useState("");
  const [schoolMatches, setSchoolMatches] = useState<{ id: number; name: string; nameEn: string | null; code: string; team: string | null }[]>([]);
  const [showSchoolDrop, setShowSchoolDrop] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [fEmails, setFEmails] = useState("");
  const [fAccType, setFAccType] = useState("teacher");
  const [fQty, setFQty] = useState(1);
  const [fOldEmail, setFOldEmail] = useState("");
  const [fFromType, setFFromType] = useState("teacher");
  const [fExtDate, setFExtDate] = useState("");
  const [fNotes, setFNotes] = useState("");
  const [fNeedsInvoice, setFNeedsInvoice] = useState(defaultNeedsInvoice("upgrade"));
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

  // focus 대상 행으로 스크롤 + 배경 강조 (최초 1회)
  useEffect(() => {
    if (!focusId || focusedOnce.current || requests.length === 0) return;
    if (!requests.some((r) => r.id === focusId)) return;
    focusedOnce.current = true;
    setFocusHighlight(focusId);
    requestAnimationFrame(() => {
      document.getElementById(`account-row-${focusId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [requests, focusId]);

  // ?new=1 이면 새 요청 다이얼로그를 자동으로 연다 (최초 1회)
  useEffect(() => {
    if (!newParam || openedNewOnce.current) return;
    openedNewOnce.current = true;
    setOpen(true);
  }, [newParam]);

  useEffect(() => {
    if (fApplicant === "individual") { setSchoolMatches([]); return; }
    const q = fSchool.trim();
    if (q.length < 2) { setSchoolMatches([]); return; }
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/schools/search?q=${encodeURIComponent(q)}`);
        if (res.ok) setSchoolMatches(await res.json());
      } catch { /* ignore */ }
    }, 250);
    return () => clearTimeout(handle);
  }, [fSchool, fApplicant]);

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
    setFChannel("company"); setFApplicant("school"); setFBulk(false); setFBulkText(""); setFType("upgrade"); setFSchool(""); setFSchoolEn(""); setFEmails(""); setFAccType("teacher");
    setFQty(1); setFOldEmail(""); setFFromType("teacher"); setFExtDate("");
    setFNotes(""); setFNeedsInvoice(defaultNeedsInvoice("upgrade"));
    setFInvNum(""); setFInvAmt(""); setFInvDue("");
    setFPayLink(""); setFPayDate(""); setFPayMethod(""); setEditing(null);
  }

  // 유형 버튼 클릭: 인보이스 필요 여부를 해당 유형의 스마트 기본값으로 되돌린다.
  // (수동 토글은 다음 유형 변경 전까지 유지된다 — 여기서만 덮어쓰므로)
  function selectType(value: string) {
    setFType(value);
    setFNeedsInvoice(defaultNeedsInvoice(value));
  }

  function openEdit(r: AccountRequest) {
    setEditing(r);
    setFChannel(r.channel || "company"); setFApplicant(r.applicantType || "school"); setFType(r.type); setFSchool(r.schoolName); setFSchoolEn(r.schoolNameEn || ""); setFEmails(r.emails);
    setFAccType(r.accountType || "teacher"); setFQty(r.quantity || 1);
    setFOldEmail(r.oldEmail || ""); setFFromType(r.fromType || "teacher");
    setFExtDate(r.extensionDate || ""); setFNotes(r.notes || "");
    setFNeedsInvoice(r.needsInvoice ?? defaultNeedsInvoice(r.type));
    setFInvNum(r.invoiceNumber || ""); setFInvAmt(r.invoiceAmount || "");
    setFInvDue(r.invoiceDueDate || ""); setFPayLink(r.paymentLink || "");
    setFPayDate(r.paymentDate || ""); setFPayMethod(r.paymentMethod || "");
    setOpen(true);
  }

  // 일괄 입력 파싱: 한 줄당 "이름, email" 또는 "email" 허용. 쉼표/탭/공백 구분 허용.
  function parseBulk(text: string): { name: string; email: string }[] {
    const out: { name: string; email: string }[] = [];
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const emailMatch = line.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
      if (!emailMatch) continue;
      const email = emailMatch[0].toLowerCase();
      const rest = line.replace(email, "").replace(/[,;\t]+/g, " ").trim();
      const name = rest || email.split("@")[0];
      out.push({ name, email });
    }
    return out;
  }

  async function save() {
    // 일괄 생성 (개인 모드 + 신규 생성일 때만)
    if (!editing && fBulk) {
      const entries = parseBulk(fBulkText);
      if (entries.length === 0) {
        setSendMsg("유효한 이메일이 없습니다");
        return;
      }
      let ok = 0, fail = 0;
      for (const e of entries) {
        const data = {
          channel: fChannel, applicantType: "individual", type: fType,
          schoolName: e.name, schoolNameEn: null, emails: e.email,
          accountType: fAccType, quantity: 1,
          oldEmail: null, fromType: null, extensionDate: fExtDate || null,
          notes: fNotes || null, needsInvoice: fNeedsInvoice,
        };
        const res = await fetch("/api/account-requests", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create", ...data }),
        });
        if (res.ok) ok++; else fail++;
      }
      setSendMsg(fail === 0 ? `✓ ${ok}건 생성 완료` : `${ok}건 생성, ${fail}건 실패`);
      resetForm(); setOpen(false); load();
      return;
    }

    const data = {
      channel: fChannel, applicantType: fApplicant, type: fType, schoolName: fSchool, schoolNameEn: fSchoolEn || null, emails: fEmails, accountType: fAccType,
      quantity: fQty, oldEmail: fOldEmail || null, fromType: fFromType || null,
      extensionDate: fExtDate || null, notes: fNotes || null,
      needsInvoice: fNeedsInvoice,
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
    const { subject, body } = generateAccountEmail(r);
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
    const { subject, body } = generateAccountEmail(r);
    const cc = r.needsInvoice ? `cc=${encodeURIComponent(HQ_INVOICE_CC)}&` : "";
    const mailto = `mailto:${HQ_TO}?${cc}subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(mailto, "_blank");
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function clearSelection() { setSelectedIds(new Set()); }

  async function sendBatch() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const selectedRequests = ids
      .map((id) => requests.find((r) => r.id === id))
      .filter((r): r is AccountRequest => !!r);
    const sections = selectedRequests.map((r) => generateAccountEmail(r));
    setSending(true); setSendMsg("");
    try {
      const res = await fetch("/api/account-email/batch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestIds: selectedRequests.map((r) => r.id), sections }),
      });
      const data = await res.json();
      if (data.success) {
        setSendMsg(`✓ ${data.count}건 묶음 발송 완료`);
        setBatchPreviewOpen(false);
        clearSelection();
        load();
      } else {
        setSendMsg("실패: " + (data.error || ""));
      }
    } catch { setSendMsg("연결 오류"); }
    finally { setSending(false); }
  }

  // 클립보드 복사
  function copyEmail(r: AccountRequest) {
    const { subject, body } = generateAccountEmail(r);
    navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
    setSendMsg("📋 복사됨");
    setTimeout(() => setSendMsg(""), 2000);
  }

  const filtered = requests.filter((r) => {
    if (filter !== "all" && r.status !== filter) return false;
    if (filterChannel !== "all" && (r.channel || "company") !== filterChannel) return false;
    if (filterApplicant !== "all" && (r.applicantType || "school") !== filterApplicant) return false;
    if (filterType !== "all" && r.type !== filterType) return false;
    // 값이 그대로 트리거에 표시되므로(공용 Select 동작) 읽히는 라벨을 값으로 쓴다
    if (filterInvoice !== "all" && (r.needsInvoice ? "필요" : "불필요") !== filterInvoice) return false;
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
            <Select value={filterInvoice} onValueChange={(v) => setFilterInvoice(v ?? "all")}>
              <SelectTrigger className="w-24 h-7 text-[11px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">인보이스</SelectItem>
                <SelectItem value="필요">💳 필요</SelectItem>
                <SelectItem value="불필요">— 불필요</SelectItem>
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
                    <button key={a.value} onClick={() => { setFApplicant(a.value); if (a.value !== "individual") setFBulk(false); }}
                      className={`flex-1 py-2 rounded-lg text-xs text-center transition-colors ${fApplicant === a.value ? "bg-purple-100 ring-1 ring-purple-400 font-semibold" : "bg-gray-50 hover:bg-gray-100"}`}>
                      {a.icon} {a.label}
                    </button>
                  ))}
                </div>
                {!editing && fApplicant === "individual" && (
                  <div className="flex gap-1">
                    <button onClick={() => setFBulk(false)}
                      className={`flex-1 py-1.5 rounded-lg text-xs text-center transition-colors ${!fBulk ? "bg-indigo-100 ring-1 ring-indigo-400 font-semibold" : "bg-gray-50 hover:bg-gray-100"}`}>
                      👤 한 명
                    </button>
                    <button onClick={() => setFBulk(true)}
                      className={`flex-1 py-1.5 rounded-lg text-xs text-center transition-colors ${fBulk ? "bg-indigo-100 ring-1 ring-indigo-400 font-semibold" : "bg-gray-50 hover:bg-gray-100"}`}>
                      👥 여러 명 일괄
                    </button>
                  </div>
                )}
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
                    <button key={t.value} onClick={() => selectType(t.value)}
                      className={`p-2 rounded-lg text-xs text-center transition-colors ${fType === t.value ? "bg-blue-100 ring-1 ring-blue-400 font-semibold" : "bg-gray-50 hover:bg-gray-100"}`}>
                      {t.icon}<br />{t.label}
                    </button>
                  ))}
                </div>
                {fBulk ? (
                  <div className="space-y-1">
                    <Label className="text-xs">이름 + 이메일 목록 *</Label>
                    <Textarea value={fBulkText} onChange={(e) => setFBulkText(e.target.value)}
                      placeholder={"한 줄에 한 명씩:\n홍길동, gil@example.com\n김철수 chul@example.com\nsimple@example.com  (이름 생략 시 이메일 앞부분 사용)"}
                      rows={8} className="text-xs font-mono" />
                    <div className="text-[10px] text-gray-400">
                      {parseBulk(fBulkText).length}명 인식됨 — 저장 시 각각 별도 요청으로 생성됩니다
                    </div>
                    {fType === "upgrade" && (
                      <div className="space-y-1">
                        <Label className="text-xs">계정 타입 (전체 공통)</Label>
                        <Select value={fAccType} onValueChange={(v) => setFAccType(v ?? "teacher")}>
                          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="teacher">Teacher</SelectItem>
                            <SelectItem value="student">Student</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="space-y-1 relative">
                      <Label className="text-xs">{fApplicant === "individual" ? "이름 *" : "학교명 *"}</Label>
                      <Input
                        value={fSchool}
                        onChange={(e) => { setFSchool(e.target.value); if (fApplicant !== "individual") setShowSchoolDrop(true); }}
                        onBlur={() => { setTimeout(() => setShowSchoolDrop(false), 150); if (fApplicant !== "individual" && !fSchoolEn) translateSchool(fSchool); }}
                        onFocus={() => fApplicant !== "individual" && fSchool.trim().length >= 2 && setShowSchoolDrop(true)}
                        placeholder={fApplicant === "individual" ? "이름" : "한국어 학교명"}
                        className="h-8 text-sm"
                      />
                      {fApplicant !== "individual" && showSchoolDrop && schoolMatches.length > 0 && (
                        <div className="absolute z-10 top-full mt-1 left-0 right-0 bg-white border-2 border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto divide-y">
                          {schoolMatches.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => { setFSchool(s.name); setFSchoolEn(s.nameEn || ""); setShowSchoolDrop(false); }}
                              className="w-full text-left px-3 py-1.5 hover:bg-blue-50 text-xs"
                            >
                              <div className="font-medium text-gray-900">{s.name}</div>
                              {s.nameEn && <div className="text-[10px] text-gray-400">{s.nameEn}{s.team ? ` · ${s.team}` : ""}</div>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{fApplicant === "individual" ? "영문 이름 (선택)" : "영문 학교명"} {translating && <span className="text-blue-500 animate-pulse">번역 중...</span>}</Label>
                      <Input value={fSchoolEn} onChange={(e) => setFSchoolEn(e.target.value)} placeholder={fApplicant === "individual" ? "English Name" : "English School Name (자동 번역)"} className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">이메일 *</Label>
                      <Textarea value={fEmails} onChange={(e) => setFEmails(e.target.value)} placeholder="이메일 (여러 개는 쉼표/줄바꿈)" rows={2} className="text-sm" />
                    </div>
                  </>
                )}
                {fType === "upgrade" && !fBulk && (
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
                <div className="space-y-1">
                  <button
                    type="button"
                    aria-pressed={fNeedsInvoice}
                    onClick={() => setFNeedsInvoice((v) => !v)}
                    className={`w-full flex items-center justify-between py-2 px-3 rounded-lg text-xs transition-colors ${fNeedsInvoice ? "bg-blue-100 ring-1 ring-blue-400 font-semibold" : "bg-gray-50 hover:bg-gray-100 text-gray-500"}`}
                  >
                    <span>💳 인보이스 필요</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${fNeedsInvoice ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-500"}`}>
                      {fNeedsInvoice ? "ON" : "OFF"}
                    </span>
                  </button>
                  <div className="text-[10px] text-gray-400">켜면 Cailie가 CC로 포함됩니다</div>
                </div>
                {editing && (
                  <details className="border rounded-lg p-3">
                    <summary className="text-xs font-medium cursor-pointer">💳 인보이스/결제 정보</summary>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <div className="space-y-1"><Label className="text-[10px]">인보이스 #</Label><Input value={fInvNum} onChange={(e) => setFInvNum(e.target.value)} className="h-7 text-xs" /></div>
                      <div className="space-y-1"><Label className="text-[10px]">금액</Label><Input value={fInvAmt} onChange={(e) => setFInvAmt(e.target.value)} placeholder="$80.00" className="h-7 text-xs" /></div>
                      <div className="space-y-1"><Label className="text-[10px]">결제 기한</Label><Input type="date" value={fInvDue} onChange={(e) => setFInvDue(e.target.value)} className="h-7 text-xs" /></div>
                      <div className="space-y-1"><Label className="text-[10px]">결제 링크</Label><Input value={fPayLink} onChange={(e) => setFPayLink(e.target.value)} className="h-7 text-xs" /></div>
                      <div className="space-y-1"><Label className="text-[10px]">결제일</Label><Input type="date" value={fPayDate} onChange={(e) => setFPayDate(e.target.value)} className="h-7 text-xs" /></div>
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

      {/* 묶음 발송 액션 바 */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200">
          <span className="text-sm font-medium text-blue-900">{selectedIds.size}건 선택됨</span>
          <Button size="sm" onClick={() => setBatchPreviewOpen(true)} className="bg-blue-600 hover:bg-blue-700 text-xs">
            📧 묶음 발송 미리보기
          </Button>
          <button onClick={clearSelection} className="text-xs text-blue-700 hover:text-blue-900 underline">선택 해제</button>
        </div>
      )}

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
        <div className="hidden md:grid grid-cols-[auto_auto_1fr_auto_auto_auto_auto] gap-2 px-3 py-1.5 bg-gray-50 border-b text-[10px] text-gray-400 font-medium uppercase tracking-wider">
          <span className="w-4">
            <input
              type="checkbox"
              aria-label="전체 선택"
              checked={filtered.length > 0 && filtered.every((r) => selectedIds.has(r.id))}
              onChange={(e) => {
                if (e.target.checked) setSelectedIds(new Set(filtered.map((r) => r.id)));
                else clearSelection();
              }}
            />
          </span>
          <span className="w-5"></span>
          <span>학교 / 이메일</span>
          <span className="w-16 text-center">날짜</span>
          <span className="w-20 text-center">상태</span>
          <span className="w-24 text-center">결제</span>
          <span className="w-28 text-right">액션</span>
        </div>

        {filtered.map((r) => {
          const typeInfo = TYPES.find((t) => t.value === r.type);
          const statusInfo = STATUSES.find((s) => s.value === r.status);
          const emails = r.emails.split(/[,;\n]+/).map((e) => e.trim()).filter(Boolean);
          const dday = dDayInfo(r.invoiceDueDate, r.paymentDate);

          return (
            <div
              key={r.id}
              id={`account-row-${r.id}`}
              className={`border-b last:border-b-0 hover:bg-gray-50/50 ${focusHighlight === r.id ? "bg-yellow-50 ring-2 ring-inset ring-amber-300" : ""}`}
            >
              {/* Desktop row */}
              <div className={`hidden md:grid grid-cols-[auto_auto_1fr_auto_auto_auto_auto] gap-2 px-3 py-2 items-center ${selectedIds.has(r.id) ? "bg-blue-50/40" : ""}`}>
                <span className="w-4 flex items-center justify-center">
                  <input
                    type="checkbox"
                    aria-label={`${r.schoolName} 선택`}
                    checked={selectedIds.has(r.id)}
                    onChange={() => toggleSelect(r.id)}
                  />
                </span>
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
                    {r.needsInvoice && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium" title="인보이스 필요 — Cailie CC">💳</span>
                    )}
                    <span className="text-[10px] text-gray-400">{emails.length > 1 ? `${emails.length}명` : ""}</span>
                  </div>
                  <div className="text-[11px] font-mono text-gray-500 truncate">
                    {emails.length <= 2 ? emails.join(", ") : `${emails[0]} +${emails.length - 1}`}
                  </div>
                </div>
                <div className="w-16 text-center text-[10px] leading-tight" title={`신청: ${r.createdAt || "—"}\n완료: ${r.confirmedAt || "—"}`}>
                  <div className="text-gray-600">{fmtMD(r.createdAt)}</div>
                  <div className={r.confirmedAt ? "text-emerald-600" : "text-gray-300"}>{fmtMD(r.confirmedAt)}</div>
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
                  {dday && <span className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded-full mt-0.5 ${dday.cls}`} title={`결제 기한: ${r.invoiceDueDate}`}>{dday.label}</span>}
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
              <div className={`md:hidden px-3 py-2.5 ${selectedIds.has(r.id) ? "bg-blue-50/40" : ""}`}>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    aria-label={`${r.schoolName} 선택`}
                    checked={selectedIds.has(r.id)}
                    onChange={() => toggleSelect(r.id)}
                    className="shrink-0"
                  />
                  <span className="text-sm">{typeInfo?.icon}</span>
                  <span className="font-medium text-sm text-gray-900 truncate flex-1">
                    {(r.applicantType || "school") === "individual" && <span className="text-[9px] px-1 py-0.5 rounded bg-purple-50 text-purple-700 font-medium mr-1">개인</span>}
                    {r.schoolName}
                    {r.needsInvoice && <span className="text-[9px] px-1 py-0.5 rounded bg-blue-50 text-blue-700 font-medium ml-1" title="인보이스 필요 — Cailie CC">💳</span>}
                  </span>
                  <select value={r.status} onChange={(e) => updateStatus(r.id, e.target.value)}
                    className={`text-[10px] font-medium rounded-full px-2 py-0.5 border-0 ${statusInfo?.color || "bg-gray-100"}`}>
                    {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                <div className="text-[11px] font-mono text-gray-500 truncate mt-0.5 ml-6">
                  {emails.length <= 2 ? emails.join(", ") : `${emails[0]} +${emails.length - 1}`}
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5 ml-6 flex items-center gap-2" title={`신청: ${r.createdAt || "—"}\n완료: ${r.confirmedAt || "—"}`}>
                  <span>📅 {fmtMD(r.createdAt)}</span>
                  {r.confirmedAt && <span className="text-emerald-600">✓ {fmtMD(r.confirmedAt)}</span>}
                </div>
                <div className="flex items-center gap-1.5 mt-1.5 ml-6">
                  <button onClick={() => setEmailPreview(r)} className="text-[11px] text-gray-400 hover:text-blue-600 px-2 py-1 rounded bg-gray-50 min-h-[28px]">미리보기</button>
                  <button onClick={() => copyEmail(r)} className="text-[11px] text-gray-400 hover:text-blue-600 px-2 py-1 rounded bg-gray-50 min-h-[28px]">복사</button>
                  <button onClick={() => openEdit(r)} className="text-[11px] text-gray-400 hover:text-blue-600 px-2 py-1 rounded bg-gray-50 min-h-[28px]">수정</button>
                  {r.invoiceAmount && <span className="text-[10px] font-semibold text-gray-700 ml-auto">{r.invoiceAmount}{r.paymentDate && " ✓"}</span>}
                  {dday && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${dday.cls} ${r.invoiceAmount ? "" : "ml-auto"}`} title={`결제 기한: ${r.invoiceDueDate}`}>{dday.label}</span>}
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
        const { subject, body } = generateAccountEmail(emailPreview);
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setEmailPreview(null)}>
            <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="p-4 border-b bg-gray-50 rounded-t-xl">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-sm">본사에 보낼 이메일</h3>
                  <button onClick={() => setEmailPreview(null)} className="text-gray-400 hover:text-gray-600">✕</button>
                </div>
                <div className="text-xs text-gray-500 space-y-0.5">
                  <div>
                    <b>To:</b> {HQ_TO}
                    {emailPreview.needsInvoice && <span className="text-gray-400"> · CC: {HQ_INVOICE_CC}</span>}
                  </div>
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

      {/* 묶음 발송 미리보기 모달 */}
      {batchPreviewOpen && (() => {
        const ids = Array.from(selectedIds);
        const selectedRequests = ids
          .map((id) => requests.find((r) => r.id === id))
          .filter((r): r is AccountRequest => !!r);
        const totalEmails = selectedRequests.reduce((s, r) => s + countEmails(r.emails), 0);
        // 제목/본문/CC 판정은 전부 SSOT(buildBatchEmail) — 서버 발송과 같은 함수라 미리보기가 실제와 일치한다.
        // 실제 발송에서 confirmLine 자리에 들어갈 confirm 링크만 미리보기용 안내 문구로 대체한다.
        const items: BatchEmailItem[] = selectedRequests.map((r) => {
          const { subject: s, body } = generateAccountEmail(r);
          return {
            subject: s,
            body,
            needsInvoice: r.needsInvoice ?? defaultNeedsInvoice(r.type),
            confirmLine: "(Confirm 링크는 발송 시 자동 생성됩니다)",
          };
        });
        const { subject, body: previewBody, needsInvoiceCc: batchNeedsInvoice } = buildBatchEmail(items, totalEmails);
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setBatchPreviewOpen(false)}>
            <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="p-4 border-b bg-gray-50 rounded-t-xl">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-sm">묶음 발송 — {ids.length}건</h3>
                  <button onClick={() => setBatchPreviewOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
                </div>
                <div className="text-xs text-gray-500 space-y-0.5">
                  <div>
                    <b>To:</b> {HQ_TO}
                    {batchNeedsInvoice && <span className="text-gray-400"> · CC: {HQ_INVOICE_CC}</span>}
                  </div>
                  <div><b>Subject:</b> {subject}</div>
                </div>
              </div>
              <div className="p-4">
                <pre className="text-xs text-gray-800 whitespace-pre-wrap font-mono leading-relaxed bg-gray-50 rounded-lg p-3 max-h-[50vh] overflow-y-auto">{previewBody}</pre>
              </div>
              <div className="p-3 border-t bg-gray-50 rounded-b-xl flex items-center gap-2">
                <Button size="sm" onClick={sendBatch} disabled={sending} className="bg-blue-600 hover:bg-blue-700 text-xs">
                  {sending ? "발송 중..." : `📧 ${ids.length}건 발송`}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setBatchPreviewOpen(false)} className="text-xs">
                  취소
                </Button>
                <span className="text-[10px] text-gray-400 ml-auto">
                  발송 시 모두 &quot;요청 완료&quot;로 변경 + 각 요청별 confirm 링크 생성
                </span>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// useSearchParams는 prerender 시 Suspense 경계가 필요 (next docs: use-search-params)
export default function AccountsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" />
        </div>
      }
    >
      <AccountsPageContent />
    </Suspense>
  );
}
