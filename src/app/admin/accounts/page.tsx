"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { FileText } from "lucide-react";
import { STATUS_CHIP } from "@/lib/status";
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
  HQ_INVOICE_TO,
  buildInvoiceEmail,
  defaultNeedsInvoice,
  isOpenInvoiceRequest,
  mergeOpenInvoiceItems,
  allocateInvoiceAmounts,
  parseInvoiceAmountToCents,
  formatCentsAsAmount,
  type InvoiceEmailItem,
  generateAccountEmail,
  buildBatchEmail,
  type BatchEmailItem,
} from "@/lib/account-email-template";
import { getAccountEmailDeliveryState } from "@/lib/account-email-delivery";
import { hasMarketLegacyOrderNote } from "@/lib/market-legacy-audit";

const LicenseCertificateDialog = dynamic(() => import("@/components/admin/license-certificate-dialog"), { ssr: false });

// 미리보기에는 실제 토큰을 넣지 않는다. 링크 줄의 존재와 위치만 확인되면 충분하다.
const INVOICE_VIEW_PREVIEW_URL = "https://<snorkl>/invoice?k=\u2026";

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
  processingEmailSendStartedAt: string | null;
  processingEmailSentAt: string | null;
  invoiceEmailSendStartedAt: string | null;
  invoiceEmailSentAt: string | null;
  invoiceEmailLastError: string | null;
  externalSource: string | null;
  marketOrderId: string | null;
  partnerRequestId: string | null;
  partnerItemId: string | null;
  teacherName: string | null;
  subject: string | null;
  partnerLifecycleState: string;
  partnerNotificationOperationId: string | null;
  partnerNotificationSentAt: string | null;
  marketVoidState: "active" | "non_voidable" | "prepared" | "voided";
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
  { value: "partner", label: "협력사", icon: "🤝" },
];

const APPLICANT_TYPES = [
  { value: "school", label: "학교", icon: "🏫" },
  { value: "individual", label: "개인", icon: "👤" },
];

// 색은 공용 팔레트(STATUS_CHIP)로 통일 — 라벨은 정산 문맥 유지
const STATUSES = [
  { value: "draft", label: "작성 중", color: STATUS_CHIP.draft },
  { value: "sent", label: "요청 완료", color: STATUS_CHIP.sent },
  { value: "processed", label: "처리 완료", color: STATUS_CHIP.processed },
  { value: "invoiced", label: "인보이스", color: STATUS_CHIP.invoiced },
  { value: "paid", label: "결제 완료", color: STATUS_CHIP.paid },
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

function needsInvoiceRetry(request: AccountRequest): boolean {
  return getAccountEmailDeliveryState(request) === "invoice_retry";
}

function needsDeliveryReview(request: AccountRequest): boolean {
  const state = getAccountEmailDeliveryState(request);
  return state === "processing_unknown" || state === "invoice_unknown";
}

function isLegacyDeliveryComplete(request: AccountRequest): boolean {
  return getAccountEmailDeliveryState(request) === "legacy_complete";
}

function isMarketManaged(request: AccountRequest): boolean {
  return request.externalSource === "market" || request.externalSource === "market_partner";
}

function isLegacyMarketAudit(request: AccountRequest): boolean {
  return (request.channel || "company") === "company"
    && !isMarketManaged(request)
    && hasMarketLegacyOrderNote(request.notes);
}

function isMarketVoidFenced(request: AccountRequest): boolean {
  return isMarketManaged(request)
    && (request.marketVoidState === "prepared" || request.marketVoidState === "voided");
}

function AccountsPageContent() {
  // 대시보드/커맨드 팔레트 연동: ?filter=상태 로 초기 필터, ?focus=id 로 해당 행 스크롤+강조,
  // ?new=1 로 새 요청 다이얼로그 자동 오픈
  const searchParams = useSearchParams();
  const filterParam = searchParams.get("filter");
  const focusId = Number(searchParams.get("focus")) || null;
  const newParam = searchParams.get("new") === "1";

  const [certificateRequest, setCertificateRequest] = useState<AccountRequest | null>(null);
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
  const [partnerHqPreview, setPartnerHqPreview] = useState<{ requestId: string; rows: AccountRequest[] } | null>(null);
  const [partnerNotifySelected, setPartnerNotifySelected] = useState<Set<number>>(new Set());
  const [partnerNotificationPreview, setPartnerNotificationPreview] = useState<{
    requestId: string;
    recipientEmail: string;
    schoolName: string;
    rows: Array<{ id: number; teacherName: string | null; email: string; subject: string | null }>;
  } | null>(null);
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchPreviewOpen, setBatchPreviewOpen] = useState(false);
  // 인보이스 1장을 선택한 여러 건에 나눠 기록하는 모달
  const [invBulkOpen, setInvBulkOpen] = useState(false);
  const [invBulkNum, setInvBulkNum] = useState("");
  const [invBulkTotal, setInvBulkTotal] = useState("");
  const [invBulkPaid, setInvBulkPaid] = useState(false);
  const [invBulkPayDate, setInvBulkPayDate] = useState("");
  const [invBulkSaving, setInvBulkSaving] = useState(false);
  const [billingSyncing, setBillingSyncing] = useState(false);

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
    if (isLegacyMarketAudit(r)) {
      setSendMsg("⚠️ 구 Market 주문 수동 감사 필요: 감사 원본은 수정할 수 없습니다.");
      return;
    }
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
    const request = requests.find((item) => item.id === id);
    if (request && (isMarketVoidFenced(request) || isLegacyMarketAudit(request))) {
      setSendMsg("⚠️ Market 감사 행의 상태는 변경할 수 없습니다.");
      return;
    }
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
    const request = requests.find((item) => item.id === id);
    if (request && (isMarketManaged(request) || isLegacyMarketAudit(request))) {
      setSendMsg("⚠️ Market 감사 원본은 삭제할 수 없습니다.");
      return;
    }
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
    if (isLegacyMarketAudit(r)) {
      setSendMsg("⚠️ 구 Market 주문 수동 감사 필요: 직접 발송을 차단했습니다.");
      return;
    }
    const { subject, body } = generateAccountEmail(r);
    setSending(true); setSendMsg("");
    try {
      const res = await fetch("/api/account-email", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: r.id, subject, body, mode: "send_all" }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSendMsg("✓ 발송 완료");
        setEmailPreview(null);
        load();
      } else if (data.deliveryUnknown) {
        const startedAt = new Date().toISOString();
        setSendMsg("⚠️ Gmail 보낸편지함 확인 필요: 발송 결과가 불확실하여 자동 재시도를 차단했습니다.");
        setEmailPreview({
          ...r,
          ...(data.unknownStage === "invoice"
            ? { invoiceEmailSendStartedAt: r.invoiceEmailSendStartedAt || startedAt }
            : { processingEmailSendStartedAt: r.processingEmailSendStartedAt || startedAt }),
        });
        load();
      } else if (data.legacyDeliveryBlocked) {
        setSendMsg("⚠️ 기존 발송 완료/중복 발송 차단: 이전 처리 완료 건은 다시 발송할 수 없습니다.");
        load();
      } else if (data.partialSuccess) {
        setSendMsg("⚠️ 부분 성공: Jon 처리 메일은 발송됐지만 Cailie 인보이스는 실패했습니다. 인보이스만 재시도하세요.");
        setEmailPreview({
          ...r,
          processingEmailSentAt: data.processingEmailSentAt || r.processingEmailSentAt || new Date().toISOString(),
          invoiceEmailLastError: data.error || "Cailie invoice email delivery failed",
        });
        load();
      } else {
        setSendMsg("실패: " + (data.error || ""));
      }
    } catch { setSendMsg("연결 오류"); }
    finally { setSending(false); }
  }

  async function sendPartnerGroup() {
    if (!partnerHqPreview || sending) return;
    const rows = partnerHqPreview.rows.filter((row) => getAccountEmailDeliveryState(row) === "ready");
    if (rows.length === 0) return;
    setSending(true);
    setSendMsg("");
    try {
      const response = await fetch("/api/account-email/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestIds: rows.map((row) => row.id),
          mode: "send_all",
          sections: rows.map((row) => generateAccountEmail(row)),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.success) {
        setSendMsg(`✓ 협력사 신청 ${partnerHqPreview.requestId}의 ${rows.length}명 본사 발송 완료`);
        setPartnerHqPreview(null);
        await load();
      } else if (result.deliveryUnknown) {
        setSendMsg("⚠️ Gmail 보낸편지함 확인 필요: 발송 결과가 불확실하여 자동 재시도를 차단했습니다.");
        setPartnerHqPreview(null);
        await load();
      } else if (result.partialSuccess) {
        setSendMsg("⚠️ Jon 처리 메일은 발송됐지만 Cailie 인보이스는 실패했습니다. 인보이스만 재시도해 주세요.");
        setPartnerHqPreview(null);
        await load();
      } else {
        setSendMsg("실패: " + (result.error || "본사 발송을 완료하지 못했습니다."));
      }
    } catch {
      setSendMsg("연결 오류가 발생했습니다.");
    } finally {
      setSending(false);
    }
  }

  function togglePartnerNotify(id: number) {
    setPartnerNotifySelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function previewPartnerNotification(requestId: string, rows: AccountRequest[]) {
    const selected = rows.filter((row) => partnerNotifySelected.has(row.id));
    if (selected.length === 0 || sending) return;
    setSending(true);
    setSendMsg("");
    try {
      const response = await fetch("/api/admin/partner-approval-notification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", partnerRequestId: requestId, requestIds: selected.map((row) => row.id) }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSendMsg("실패: " + (result.error || "승인 안내 미리보기를 만들지 못했습니다."));
        return;
      }
      setPartnerNotificationPreview({
        requestId,
        recipientEmail: result.recipientEmail,
        schoolName: result.schoolName,
        rows: result.rows,
      });
    } catch {
      setSendMsg("Market 연결 오류가 발생했습니다.");
    } finally {
      setSending(false);
    }
  }

  async function sendPartnerNotification() {
    if (!partnerNotificationPreview || sending) return;
    setSending(true);
    setSendMsg("");
    const operationId = crypto.randomUUID();
    try {
      const response = await fetch("/api/admin/partner-approval-notification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          partnerRequestId: partnerNotificationPreview.requestId,
          requestIds: partnerNotificationPreview.rows.map((row) => row.id),
          operationId,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (result.status === "sent") {
        setSendMsg(`✓ ${partnerNotificationPreview.rows.length}명 승인 안내를 협력사에 발송했습니다.`);
        setPartnerNotifySelected((previous) => {
          const next = new Set(previous);
          partnerNotificationPreview.rows.forEach((row) => next.delete(row.id));
          return next;
        });
        setPartnerNotificationPreview(null);
        await load();
      } else if (result.status === "unknown" || response.status === 202) {
        setSendMsg("⚠️ 발송 결과가 불확실합니다. 자동 재발송하지 말고 상태 확인 또는 Gmail 보낸편지함 수동 확인을 진행하세요.");
        setPartnerNotificationPreview(null);
        await load();
      } else {
        setSendMsg("실패: " + (result.error || "승인 안내를 발송하지 못했습니다."));
        await load();
      }
    } catch {
      setSendMsg("⚠️ Market 응답을 확인하지 못했습니다. 자동 재발송하지 말고 발송 상태를 확인하세요.");
      setPartnerNotificationPreview(null);
      await load();
    } finally {
      setSending(false);
    }
  }

  async function reconcilePartnerNotification(operationId: string) {
    if (sending) return;
    setSending(true);
    try {
      const response = await fetch("/api/admin/partner-approval-notification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", operationId }),
      });
      const result = await response.json().catch(() => ({}));
      setSendMsg(result.status === "sent"
        ? "✓ Market 원장에서 발송 완료를 확인했습니다."
        : result.status === "failed"
          ? "미발송 상태를 확인했습니다. 다시 선택해 발송할 수 있습니다."
          : "⚠️ 아직 발송 결과 불명입니다. Gmail 보낸편지함을 확인하세요.");
      await load();
    } catch {
      setSendMsg("발송 상태를 확인하지 못했습니다.");
    } finally {
      setSending(false);
    }
  }

  async function reviewPartnerNotification(operationId: string, outcome: "sent" | "not_sent") {
    if (sending) return;
    const note = window.prompt(outcome === "sent"
      ? "Gmail 보낸편지함에서 확인한 근거를 입력하세요."
      : "미발송으로 판단한 근거를 입력하세요.");
    if (!note || note.trim().length < 3) {
      setSendMsg("수동 확인 메모를 3자 이상 입력해야 합니다.");
      return;
    }
    setSending(true);
    try {
      const response = await fetch("/api/admin/partner-approval-notification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "review", operationId, outcome, note: note.trim() }),
      });
      const result = await response.json().catch(() => ({}));
      setSendMsg(response.ok
        ? outcome === "sent" ? "✓ 수동 확인으로 발송 완료 처리했습니다." : "미발송으로 확인했습니다. 다시 선택해 발송할 수 있습니다."
        : "실패: " + (result.error || "수동 확인을 저장하지 못했습니다."));
      await load();
    } catch {
      setSendMsg("수동 확인 결과를 저장하지 못했습니다.");
    } finally {
      setSending(false);
    }
  }

  async function retryInvoiceOnly(r: AccountRequest) {
    if (isLegacyMarketAudit(r)) {
      setSendMsg("⚠️ 구 Market 주문 수동 감사 필요: 인보이스 재발송을 차단했습니다.");
      return;
    }
    setSending(true); setSendMsg("");
    try {
      const res = await fetch("/api/account-email", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: r.id, mode: "invoice_only" }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSendMsg("✓ Cailie 인보이스 재전송 완료 — Jon에게는 다시 보내지 않았습니다");
        setEmailPreview(null);
        load();
      } else if (data.deliveryUnknown) {
        setSendMsg("⚠️ Gmail 보낸편지함 확인 필요: 인보이스 발송 결과가 불확실하여 자동 재시도를 차단했습니다.");
        setEmailPreview({
          ...r,
          invoiceEmailSendStartedAt: r.invoiceEmailSendStartedAt || new Date().toISOString(),
        });
        load();
      } else if (data.legacyDeliveryBlocked) {
        setSendMsg("⚠️ 기존 발송 완료/중복 발송 차단: 이전 처리 완료 건은 인보이스 재전송 대상이 아닙니다.");
        load();
      } else if (data.partialSuccess) {
        setSendMsg("⚠️ 인보이스 재전송 실패: Jon 메일은 다시 보내지 않았습니다. 다시 시도해 주세요.");
        load();
      } else {
        setSendMsg("실패: " + (data.error || "인보이스 재전송에 실패했습니다"));
      }
    } catch { setSendMsg("연결 오류"); }
    finally { setSending(false); }
  }

  // Gmail 열기
  function openGmail(r: AccountRequest) {
    if (isLegacyMarketAudit(r)) {
      setSendMsg("⚠️ 구 Market 주문 수동 감사 필요: Gmail 작성창을 열 수 없습니다.");
      return;
    }
    if (isMarketManaged(r)) {
      setSendMsg("⚠️ Market 주문은 취소 경합 보호를 위해 서버 발송만 허용합니다.");
      return;
    }
    const deliveryState = getAccountEmailDeliveryState(r);
    if (deliveryState === "legacy_complete") {
      setSendMsg("⚠️ 기존 발송 완료/중복 발송 차단: 이전 처리 완료 건은 Gmail 재발송을 열 수 없습니다.");
      return;
    }
    if (deliveryState !== "ready") {
      setSendMsg("Jon 처리 메일이 발송됐거나 결과 확인이 필요해 Gmail 재발송을 열지 않았습니다");
      return;
    }
    const { subject, body } = generateAccountEmail(r);
    // 처리 메일은 Jon 단독 — 인보이스 메일은 앱에서 Cailie 에게 따로 나간다.
    const mailto = `mailto:${HQ_TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(mailto, "_blank");
  }

  function toggleSelect(id: number) {
    const request = requests.find((item) => item.id === id);
    if (request && isLegacyMarketAudit(request)) {
      setSendMsg("⚠️ 구 Market 주문 수동 감사 필요: 묶음 발송 선택을 차단했습니다.");
      return;
    }
    if (request && isMarketManaged(request)) {
      setSendMsg("⚠️ Market 주문은 개별 서버 발송만 허용합니다.");
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function clearSelection() { setSelectedIds(new Set()); }

  /**
   * 선택한 건들에 인보이스 번호 하나를 배분 기록한다.
   *
   * Cailie 는 요청 여러 건을 인보이스 한 장으로 묶는데(예: 1098 = #195 + #196),
   * 건별로 따로 넣으면 한 건을 빠뜨린다 — 실제로 #195 가 그렇게 누락됐다.
   * 총액은 계정 수에 비례해 나누고, 반올림 잔여는 마지막 건이 흡수해 합계를 맞춘다.
   */
  const invBulkTargets = Array.from(selectedIds)
    .map((id) => requests.find((r) => r.id === id))
    .filter((r): r is AccountRequest => Boolean(r))
    .sort((a, b) => a.id - b.id);

  const invBulkCents = parseInvoiceAmountToCents(invBulkTotal);
  const invBulkSplit = invBulkCents === null
    ? []
    : allocateInvoiceAmounts(invBulkCents, invBulkTargets.map((r) => r.quantity || 1));

  async function saveInvoiceBulk() {
    if (!invBulkNum.trim() || invBulkCents === null || invBulkTargets.length === 0) return;
    setInvBulkSaving(true);
    let ok = 0;
    const failed: number[] = [];
    for (let i = 0; i < invBulkTargets.length; i++) {
      const r = invBulkTargets[i];
      const payload: Record<string, unknown> = {
        action: "update", id: r.id,
        invoiceNumber: invBulkNum.trim(),
        invoiceAmount: formatCentsAsAmount(invBulkSplit[i] ?? 0),
      };
      if (invBulkPaid) {
        payload.status = "paid";
        payload.paymentDate = invBulkPayDate || null;
        payload.paymentMethod = "card";
      }
      try {
        const res = await fetch("/api/account-requests", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) ok++; else failed.push(r.id);
      } catch { failed.push(r.id); }
    }
    setInvBulkSaving(false);
    setSendMsg(failed.length === 0
      ? `✓ 인보이스 ${invBulkNum.trim()} — ${ok}건 기록 완료`
      : `${ok}건 기록, 실패 #${failed.join(", #")}`);
    if (failed.length === 0) {
      setInvBulkOpen(false);
      setInvBulkNum(""); setInvBulkTotal(""); setInvBulkPaid(false); setInvBulkPayDate("");
      clearSelection();
    }
    load();
  }

  // 본사 청구 메일(Cailie 인보이스 PDF · QuickBooks 결제 확인) 을 지금 읽어 반영한다. 크론과 같은 경로.
  async function syncBillingMail() {
    if (billingSyncing) return;
    setBillingSyncing(true);
    try {
      const res = await fetch("/api/admin/sync-billing", { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setSendMsg(data.error || "메일 동기화 실패"); return; }
      if (data.skipped) { setSendMsg(`⚠️ 메일 동기화 건너뜀: ${data.reason}`); return; }
      type Applied = { invoiceNumber: string; ids: number[] };
      type Unmatched = { invoiceNumber: string; reason: string };
      const invCount = (data.invoices.applied as Applied[]).reduce((n, a) => n + a.ids.length, 0);
      const payCount = (data.payments.applied as Applied[]).reduce((n, a) => n + a.ids.length, 0);
      const unmatched = [...(data.invoices.unmatched as Unmatched[]), ...(data.payments.unmatched as Unmatched[])];
      const head = `메일 ${data.scanned}통 확인 — 인보이스 ${invCount}건 기록, 결제 ${payCount}건 완료`;
      setSendMsg(unmatched.length > 0
        ? `⚠️ ${head} · 미매칭 ${unmatched.length}건: ${unmatched.map((u) => `#${u.invoiceNumber} ${u.reason}`).join(" / ")}`
        : `✓ ${head}`);
      if (invCount + payCount > 0) load();
    } catch {
      setSendMsg("메일 동기화 실패");
    } finally {
      setBillingSyncing(false);
    }
  }

  async function sendBatch() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const selectedRequests = ids
      .map((id) => requests.find((r) => r.id === id))
      .filter((r): r is AccountRequest => !!r);
    if (selectedRequests.some(isLegacyMarketAudit)) {
      setSendMsg("⚠️ 구 Market 주문 수동 감사 필요: 묶음 발송을 차단했습니다.");
      return;
    }
    if (selectedRequests.some(isMarketManaged)) {
      setSendMsg("⚠️ Market 주문은 미리보기 없는 개별 서버 발송만 허용합니다.");
      return;
    }
    if (selectedRequests.some(needsDeliveryReview)) {
      setSendMsg("⚠️ Gmail 보낸편지함 확인이 필요한 건은 자동 발송할 수 없습니다.");
      return;
    }
    if (selectedRequests.some(isLegacyDeliveryComplete)) {
      setSendMsg("⚠️ 기존 발송 완료/중복 발송 차단: 이전 처리 완료 건은 묶음 발송할 수 없습니다.");
      return;
    }
    const retryOnly = selectedRequests.length > 0 && selectedRequests.every(needsInvoiceRetry);
    if (!retryOnly && selectedRequests.some((request) => getAccountEmailDeliveryState(request) !== "ready")) {
      setSendMsg("이미 Jon에게 발송된 건과 신규 발송 건을 함께 묶을 수 없습니다. 인보이스 재시도 건만 따로 선택해 주세요.");
      return;
    }
    const sections = selectedRequests.map((r) => generateAccountEmail(r));
    setSending(true); setSendMsg("");
    try {
      const res = await fetch("/api/account-email/batch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestIds: selectedRequests.map((r) => r.id),
          ...(retryOnly ? { mode: "invoice_only" } : { mode: "send_all", sections }),
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSendMsg(retryOnly
          ? `✓ ${data.count}건 Cailie 인보이스 재전송 완료 — Jon 재발송 없음`
          : `✓ ${data.count}건 묶음 발송 완료`);
        setBatchPreviewOpen(false);
        clearSelection();
        load();
      } else if (data.deliveryUnknown) {
        await load();
        setBatchPreviewOpen(false);
        setSendMsg("⚠️ Gmail 보낸편지함 확인 필요: 묶음 발송 결과가 불확실하여 자동 재시도를 차단했습니다.");
      } else if (data.legacyDeliveryBlocked) {
        await load();
        setBatchPreviewOpen(false);
        setSendMsg("⚠️ 기존 발송 완료/중복 발송 차단: 이전 처리 완료 건은 묶음 발송할 수 없습니다.");
      } else if (data.partialSuccess) {
        const retryIds = Array.isArray(data.invoiceRetryRequestIds)
          ? data.invoiceRetryRequestIds.filter((id: unknown): id is number => Number.isInteger(id))
          : selectedRequests
            .filter((request) => request.needsInvoice ?? defaultNeedsInvoice(request.type))
            .map((request) => request.id);
        await load();
        setSelectedIds(new Set(retryIds));
        setBatchPreviewOpen(false);
        setSendMsg("⚠️ 부분 성공: Jon 묶음 메일은 발송됐지만 Cailie 인보이스는 실패했습니다. 인보이스 재시도 건만 자동 선택했습니다.");
      } else {
        setSendMsg("실패: " + (data.error || ""));
      }
    } catch { setSendMsg("연결 오류"); }
    finally { setSending(false); }
  }

  // 클립보드 복사
  function copyEmail(r: AccountRequest) {
    if (isLegacyMarketAudit(r)) {
      setSendMsg("⚠️ 구 Market 주문 수동 감사 필요: 메일 복사를 허용하지 않습니다.");
      return;
    }
    if (isMarketManaged(r)) {
      setSendMsg("⚠️ Market 주문은 취소 경합 보호를 위해 메일 복사를 허용하지 않습니다.");
      return;
    }
    const { subject, body } = generateAccountEmail(r);
    navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
    setSendMsg("📋 복사됨");
    setTimeout(() => setSendMsg(""), 2000);
  }

  // 인보이스 메일에는 이번 건뿐 아니라 아직 청구가 안 끝난 전체가 실린다.
  // 미리보기가 실제 발송과 갈라지지 않도록 화면에서도 같은 규칙으로 목록을 만든다.
  const openInvoiceItems: InvoiceEmailItem[] = requests
    .filter(isOpenInvoiceRequest)
    .sort((a, b) => a.id - b.id)
    .map((r) => ({
      requestId: r.id, schoolName: r.schoolName, schoolNameEn: r.schoolNameEn,
      type: r.type, accountType: r.accountType, quantity: r.quantity, extensionDate: r.extensionDate,
    }));

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

  // prepared/voided 및 구 Market marker 행은 원본 목록에 보존하되 운영 집계에서는 제외한다.
  const operationalRequests = requests.filter((request) => (
    !isMarketVoidFenced(request) && !isLegacyMarketAudit(request)
  ));
  const selectableFiltered = filtered.filter((request) => (
    !isMarketManaged(request) && !isLegacyMarketAudit(request)
  ));
  const statusCounts = STATUSES.map((s) => ({ ...s, count: operationalRequests.filter((r) => r.status === s.value).length }));
  const emailCount = operationalRequests.reduce((s, r) => s + r.emails.split(/[,;\n]+/).filter((e) => e.trim() && e.includes("@")).length, 0);
  const selectedRequestsForAction = Array.from(selectedIds)
    .map((id) => requests.find((request) => request.id === id))
    .filter((request): request is AccountRequest => Boolean(request));
  const selectionIsInvoiceRetry = selectedRequestsForAction.length > 0
    && selectedRequestsForAction.every(needsInvoiceRetry);
  const selectionNeedsDeliveryReview = selectedRequestsForAction.some(needsDeliveryReview);
  const selectionHasLegacyDelivery = selectedRequestsForAction.some(isLegacyDeliveryComplete);
  const selectionHasLegacyMarketAudit = selectedRequestsForAction.some(isLegacyMarketAudit);
  const partnerGroups = Array.from(filtered.reduce((groups, request) => {
    if (request.channel !== "partner" || request.partnerLifecycleState !== "active" || !request.partnerRequestId) return groups;
    const rows = groups.get(request.partnerRequestId) || [];
    rows.push(request);
    groups.set(request.partnerRequestId, rows);
    return groups;
  }, new Map<string, AccountRequest[]>()).entries());

  return (
    <div className="space-y-3 pb-20 md:pb-0">
      {/* Compact header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-slate-900">Snorkl 계정 요청 관리</h1>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span><strong className="text-slate-900 text-sm">{operationalRequests.length}</strong> 건</span>
            <span className="text-slate-200">|</span>
            <span><strong className="text-slate-900 text-sm">{emailCount}</strong> 명</span>
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
            <Button
              size="sm"
              variant="outline"
              onClick={syncBillingMail}
              disabled={billingSyncing}
              title="Cailie 인보이스 PDF · QuickBooks 결제 확인 메일을 읽어 계정 요청에 반영"
              className="h-7 text-xs whitespace-nowrap border-emerald-300 text-emerald-800 hover:bg-emerald-50"
            >
              {billingSyncing ? "⏳ 동기화 중…" : "📥 메일 동기화"}
            </Button>
            <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
              <DialogTrigger className="inline-flex items-center justify-center rounded-md text-xs font-semibold bg-slate-900 text-white h-7 px-3 hover:bg-slate-800 cursor-pointer whitespace-nowrap">
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
                      className={`flex-1 py-2 rounded-lg text-xs text-center transition-colors ${fApplicant === a.value ? "bg-purple-100 ring-1 ring-purple-400 font-semibold" : "bg-slate-50 hover:bg-slate-100"}`}>
                      {a.icon} {a.label}
                    </button>
                  ))}
                </div>
                {!editing && fApplicant === "individual" && (
                  <div className="flex gap-1">
                    <button onClick={() => setFBulk(false)}
                      className={`flex-1 py-1.5 rounded-lg text-xs text-center transition-colors ${!fBulk ? "bg-indigo-100 ring-1 ring-indigo-400 font-semibold" : "bg-slate-50 hover:bg-slate-100"}`}>
                      👤 한 명
                    </button>
                    <button onClick={() => setFBulk(true)}
                      className={`flex-1 py-1.5 rounded-lg text-xs text-center transition-colors ${fBulk ? "bg-indigo-100 ring-1 ring-indigo-400 font-semibold" : "bg-slate-50 hover:bg-slate-100"}`}>
                      👥 여러 명 일괄
                    </button>
                  </div>
                )}
                <div className="flex gap-1">
                  {CHANNELS.map((c) => (
                    <button key={c.value} onClick={() => setFChannel(c.value)}
                      className={`flex-1 py-2 rounded-lg text-xs text-center transition-colors ${fChannel === c.value ? "bg-indigo-100 ring-1 ring-indigo-400 font-semibold" : "bg-slate-50 hover:bg-slate-100"}`}>
                      {c.icon} {c.label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {TYPES.map((t) => (
                    <button key={t.value} onClick={() => selectType(t.value)}
                      className={`p-2 rounded-lg text-xs text-center transition-colors ${fType === t.value ? "bg-blue-100 ring-1 ring-blue-400 font-semibold" : "bg-slate-50 hover:bg-slate-100"}`}>
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
                    <div className="text-[10px] text-slate-400">
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
                        <div className="absolute z-10 top-full mt-1 left-0 right-0 bg-white border-2 border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto divide-y">
                          {schoolMatches.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => { setFSchool(s.name); setFSchoolEn(s.nameEn || ""); setShowSchoolDrop(false); }}
                              className="w-full text-left px-3 py-1.5 hover:bg-blue-50 text-xs"
                            >
                              <div className="font-medium text-slate-900">{s.name}</div>
                              {s.nameEn && <div className="text-[10px] text-slate-400">{s.nameEn}{s.team ? ` · ${s.team}` : ""}</div>}
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
                        className={`flex-1 py-2 rounded text-xs ${fFromType === t ? "bg-blue-100 ring-1 ring-blue-400 font-semibold" : "bg-slate-50"}`}>
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
                    className={`w-full flex items-center justify-between py-2 px-3 rounded-lg text-xs transition-colors ${fNeedsInvoice ? "bg-blue-100 ring-1 ring-blue-400 font-semibold" : "bg-slate-50 hover:bg-slate-100 text-slate-500"}`}
                  >
                    <span>💳 인보이스 필요</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${fNeedsInvoice ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-500"}`}>
                      {fNeedsInvoice ? "ON" : "OFF"}
                    </span>
                  </button>
                  <div className="text-[10px] text-slate-400">켜면 Cailie가 CC로 포함됩니다</div>
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
          <Button
            size="sm"
            onClick={() => setBatchPreviewOpen(true)}
            disabled={selectionHasLegacyMarketAudit}
            className="bg-blue-600 hover:bg-blue-700 text-xs"
          >
            {selectionHasLegacyMarketAudit
              ? "⛔ 구 Market 주문 수동 감사 필요"
              : selectionNeedsDeliveryReview
              ? "⛔ 보낸편지함 확인"
              : selectionHasLegacyDelivery
                ? "⛔ 기존 발송 완료/중복 발송 차단"
              : selectionIsInvoiceRetry
                ? "↻ 인보이스 재시도 미리보기"
                : "📧 묶음 발송 미리보기"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setInvBulkOpen(true)}
            className="text-xs border-emerald-300 text-emerald-800 hover:bg-emerald-50"
          >
            🧾 인보이스 번호 입력
          </Button>
          <button onClick={clearSelection} className="text-xs text-blue-700 hover:text-blue-900 underline">선택 해제</button>
        </div>
      )}

      {/* 인보이스 번호 일괄 입력 — 인보이스 1장이 요청 여러 건을 덮는 구조라 건별 입력은 누락을 부른다 */}
      {invBulkOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => !invBulkSaving && setInvBulkOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b bg-slate-50 rounded-t-xl flex items-center justify-between">
              <h3 className="font-bold text-sm">인보이스 번호 입력 — {invBulkTargets.length}건</h3>
              <button onClick={() => !invBulkSaving && setInvBulkOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[11px]">인보이스 #</Label>
                  <Input value={invBulkNum} onChange={(e) => setInvBulkNum(e.target.value)} placeholder="1098" className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">인보이스 총액</Label>
                  <Input value={invBulkTotal} onChange={(e) => setInvBulkTotal(e.target.value)} placeholder="$160.00" className="h-8 text-sm" />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input type="checkbox" checked={invBulkPaid} onChange={(e) => setInvBulkPaid(e.target.checked)} />
                결제 완료로 표시
              </label>
              {invBulkPaid && (
                <div className="space-y-1">
                  <Label className="text-[11px]">결제일</Label>
                  <Input type="date" value={invBulkPayDate} onChange={(e) => setInvBulkPayDate(e.target.value)} className="h-8 text-sm w-44" />
                </div>
              )}

              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 text-[11px] font-medium text-slate-500 border-b">
                  계정 수 비례 배분 {invBulkCents !== null && `· 합계 ${formatCentsAsAmount(invBulkCents)}`}
                </div>
                <ul className="divide-y divide-slate-100">
                  {invBulkTargets.map((r, i) => (
                    <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                      <span className="font-mono text-slate-400 w-11 shrink-0">#{r.id}</span>
                      <span className="flex-1 min-w-0 truncate">{r.schoolNameEn || r.schoolName}</span>
                      <span className="text-slate-400 shrink-0">{r.quantity || 1}계정</span>
                      <span className="font-mono font-medium text-slate-900 shrink-0 w-20 text-right">
                        {invBulkCents === null ? "—" : formatCentsAsAmount(invBulkSplit[i] ?? 0)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {invBulkTotal && invBulkCents === null && (
                <p className="text-xs text-red-600">금액을 읽을 수 없습니다. 예: $160.00</p>
              )}
              {invBulkTargets.some((r) => r.invoiceNumber && r.invoiceNumber !== invBulkNum.trim()) && (
                <p className="text-xs text-amber-700">
                  ⚠️ 이미 다른 인보이스 번호가 있는 건이 포함돼 있습니다 — 덮어씁니다.
                </p>
              )}
            </div>

            <div className="p-4 border-t bg-slate-50 rounded-b-xl flex items-center gap-2">
              <Button
                size="sm"
                onClick={saveInvoiceBulk}
                disabled={invBulkSaving || !invBulkNum.trim() || invBulkCents === null || invBulkTargets.length === 0}
                className="bg-emerald-600 hover:bg-emerald-700 text-xs"
              >
                {invBulkSaving ? "저장 중…" : `${invBulkTargets.length}건에 기록`}
              </Button>
              <button onClick={() => !invBulkSaving && setInvBulkOpen(false)} className="text-xs text-slate-500 hover:text-slate-700 underline">취소</button>
            </div>
          </div>
        </div>
      )}

      {/* Status filter pills */}
      <div className="flex gap-1 flex-wrap">
        <button onClick={() => setFilter("all")}
          className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${filter === "all" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>
          전체 {operationalRequests.length}
        </button>
        {statusCounts.map((s) => (
          <button key={s.value} onClick={() => setFilter(filter === s.value ? "all" : s.value)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${filter === s.value ? "bg-slate-900 text-white" : s.color}`}>
            {s.label} {s.count}
          </button>
        ))}
      </div>

      {partnerGroups.length > 0 && (
        <section className="rounded-xl border border-cyan-200 bg-cyan-50/50 p-3 space-y-2" aria-labelledby="partner-request-groups">
          <div>
            <h2 id="partner-request-groups" className="text-sm font-semibold text-cyan-950">협력사 신청 묶음</h2>
            <p className="text-[11px] text-cyan-800">같은 신청의 교사를 함께 확인한 뒤 본사로 발송합니다.</p>
          </div>
          {partnerGroups.map(([requestId, rows]) => {
            const readyRows = rows.filter((row) => getAccountEmailDeliveryState(row) === "ready");
            const unknown = rows.some(needsDeliveryReview);
            const notificationCandidates = rows.filter((row) => (
              Boolean(row.confirmedAt)
              && !row.partnerNotificationSentAt
              && !row.partnerNotificationOperationId
            ));
            const selectedNotificationRows = notificationCandidates.filter((row) => partnerNotifySelected.has(row.id));
            const unknownOperations = [...new Set(rows
              .filter((row) => !row.partnerNotificationSentAt && row.partnerNotificationOperationId)
              .map((row) => row.partnerNotificationOperationId!))];
            return (
              <div key={requestId} className="rounded-lg border border-cyan-100 bg-white p-3 space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-slate-900">{rows[0]?.schoolName} · {rows.length}명</div>
                  {rows[0]?.schoolNameEn && <div className="text-[11px] text-slate-500">{rows[0].schoolNameEn}</div>}
                  <div className="mt-1 text-[11px] text-slate-500 truncate">{rows.map((row) => `${row.teacherName || "—"} (${row.subject || "—"})`).join(", ")}</div>
                  <div className="mt-1 font-mono text-[9px] text-slate-400">{requestId}</div>
                </div>
                <Button
                  size="sm"
                  disabled={sending || readyRows.length === 0 || unknown}
                  onClick={() => setPartnerHqPreview({ requestId, rows: readyRows })}
                  className="bg-cyan-700 hover:bg-cyan-800 text-xs"
                >
                  {unknown ? "보낸편지함 확인 필요" : readyRows.length > 0 ? `본사 발송 미리보기 (${readyRows.length})` : "본사 발송 완료"}
                </Button>
                </div>
                {rows.some((row) => row.confirmedAt) && (
                  <div className="rounded-md border border-emerald-100 bg-emerald-50/60 p-2 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-emerald-900">협력사 승인 안내</span>
                      <Button
                        size="sm"
                        disabled={sending || selectedNotificationRows.length === 0}
                        onClick={() => previewPartnerNotification(requestId, rows)}
                        className="h-7 bg-emerald-700 hover:bg-emerald-800 text-[11px]"
                      >
                        수신자·교사 미리보기 ({selectedNotificationRows.length})
                      </Button>
                    </div>
                    <ul className="space-y-1">
                      {rows.filter((row) => row.confirmedAt).map((row) => {
                        const selectable = !row.partnerNotificationSentAt && !row.partnerNotificationOperationId;
                        return (
                          <li key={row.id} className="flex items-center gap-2 text-[11px] text-slate-700">
                            <input
                              type="checkbox"
                              aria-label={`${row.teacherName || row.emails} 협력사 안내 선택`}
                              checked={partnerNotifySelected.has(row.id)}
                              disabled={!selectable || sending}
                              onChange={() => togglePartnerNotify(row.id)}
                            />
                            <span className="flex-1">{row.teacherName || "—"} · {row.subject || "—"} · {row.emails}</span>
                            <span className={row.partnerNotificationSentAt ? "text-emerald-700" : row.partnerNotificationOperationId ? "text-amber-700" : "text-slate-400"}>
                              {row.partnerNotificationSentAt ? "안내 완료" : row.partnerNotificationOperationId ? "확인 필요" : "안내 대기"}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {unknownOperations.map((operationId) => (
                      <div key={operationId} className="flex flex-wrap gap-1 border-t border-emerald-100 pt-2">
                        <Button size="sm" variant="outline" disabled={sending} onClick={() => reconcilePartnerNotification(operationId)} className="h-7 text-[10px]">Market 상태 확인</Button>
                        <Button size="sm" variant="outline" disabled={sending} onClick={() => reviewPartnerNotification(operationId, "sent")} className="h-7 text-[10px]">Gmail에서 발송 확인</Button>
                        <Button size="sm" variant="outline" disabled={sending} onClick={() => reviewPartnerNotification(operationId, "not_sent")} className="h-7 text-[10px]">미발송 확인</Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      {/* Request list */}
      <div className="bg-white rounded-xl border overflow-hidden">
        {/* Desktop header */}
        <div className="hidden md:grid grid-cols-[auto_auto_1fr_auto_auto_auto_auto] gap-2 px-3 py-1.5 bg-slate-50 border-b text-[10px] text-slate-400 font-medium uppercase tracking-wider">
          <span className="w-4">
            <input
              type="checkbox"
              aria-label="전체 선택"
              checked={selectableFiltered.length > 0 && selectableFiltered.every((r) => selectedIds.has(r.id))}
              onChange={(e) => {
                if (e.target.checked) setSelectedIds(new Set(selectableFiltered.map((r) => r.id)));
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
          const deliveryState = getAccountEmailDeliveryState(r);
          const legacyDeliveryComplete = deliveryState === "legacy_complete";
          const marketManaged = isMarketManaged(r);
          const marketVoidFenced = isMarketVoidFenced(r);
          const legacyMarketAudit = isLegacyMarketAudit(r);

          return (
            <div
              key={r.id}
              id={`account-row-${r.id}`}
              className={`border-b last:border-b-0 hover:bg-slate-50/50 ${focusHighlight === r.id ? "bg-yellow-50 ring-2 ring-inset ring-amber-300" : ""}`}
            >
              {/* Desktop row */}
              <div className={`hidden md:grid grid-cols-[auto_auto_1fr_auto_auto_auto_auto] gap-2 px-3 py-2 items-center ${selectedIds.has(r.id) ? "bg-blue-50/40" : ""}`}>
                <span className="w-4 flex items-center justify-center">
                  <input
                    type="checkbox"
                    aria-label={`${r.schoolName} 선택`}
                    checked={selectedIds.has(r.id)}
                    onChange={() => toggleSelect(r.id)}
                    disabled={marketManaged || legacyMarketAudit}
                    title={legacyMarketAudit
                      ? "구 Market 주문 수동 감사 필요 — 묶음 발송 선택 금지"
                      : marketManaged
                        ? "Market 주문은 개별 서버 발송만 허용"
                        : undefined}
                  />
                </span>
                <span className="text-sm w-5 text-center" title={typeInfo?.label}>{typeInfo?.icon}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-sm text-slate-900 truncate">{r.schoolName}</span>
                    {r.schoolNameEn && <span className="text-[10px] text-slate-400 truncate hidden lg:inline">({r.schoolNameEn})</span>}
                    {(r.applicantType || "school") === "individual" && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700 font-medium">개인</span>
                    )}
                    {(r.channel || "company") === "school_store" && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">학교장터</span>
                    )}
                    {(r.channel || "company") === "partner" && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-cyan-100 text-cyan-800 font-semibold">협력사</span>
                    )}
                    {r.needsInvoice && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium" title="인보이스 필요 — Cailie CC">💳</span>
                    )}
                    {needsInvoiceRetry(r) && (
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-semibold"
                        title={r.invoiceEmailLastError || "Jon 발송 완료 · Cailie 인보이스 재시도 필요"}
                      >⚠ 인보이스 재시도</span>
                    )}
                    {needsDeliveryReview(r) && (
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-800 font-semibold"
                        title="발송 결과 불확실 — Gmail 보낸편지함을 확인하기 전 자동 재시도 금지"
                      >⛔ 보낸편지함 확인</span>
                    )}
                    {legacyDeliveryComplete && (
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-700 font-semibold"
                        title="0016 이전 처리 완료 건 — 중복 발송 차단"
                      >⛔ 기존 발송 완료</span>
                    )}
                    {marketManaged && (
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${
                        marketVoidFenced ? "bg-rose-100 text-rose-800" : "bg-cyan-100 text-cyan-800"
                      }`}>
                        {r.marketVoidState === "voided" ? "Market 취소됨" : r.marketVoidState === "prepared" ? "Market 취소 준비" : "Market 서버 발송"}
                      </span>
                    )}
                    {legacyMarketAudit && (
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-800 font-semibold"
                        title="메일·복사·묶음·수정·삭제·상태 변경을 금지한 감사 전용 행"
                      >⛔ 구 Market 주문 수동 감사 필요</span>
                    )}
                    <span className="text-[10px] text-slate-400">{emails.length > 1 ? `${emails.length}명` : ""}</span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 truncate">
                    {emails.length <= 2 ? emails.join(", ") : `${emails[0]} +${emails.length - 1}`}
                  </div>
                  {r.channel === 'partner' && (
                    <div className="text-[10px] text-cyan-800 truncate">
                      {r.teacherName || '—'} · {r.subject || '—'}
                    </div>
                  )}
                </div>
                <div className="w-16 text-center text-[10px] leading-tight" title={`신청: ${r.createdAt || "—"}\n완료: ${r.confirmedAt || "—"}`}>
                  <div className="text-slate-600">{fmtMD(r.createdAt)}</div>
                  <div className={r.confirmedAt ? "text-emerald-600" : "text-slate-300"}>{fmtMD(r.confirmedAt)}</div>
                </div>
                <div className="w-20">
                  <select value={r.status} onChange={(e) => updateStatus(r.id, e.target.value)} disabled={marketVoidFenced || legacyMarketAudit}
                    className={`w-full text-[10px] font-medium rounded-full px-2 py-0.5 border-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${statusInfo?.color || "bg-slate-100"}`}>
                    {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                <div className="w-24 text-center">
                  {r.invoiceAmount ? (
                    <div className="text-[11px]">
                      <span className="font-semibold text-slate-700">{r.invoiceAmount}</span>
                      {r.paymentDate && <span className="text-emerald-600 ml-1">✓</span>}
                    </div>
                  ) : <span className="text-[10px] text-slate-300">—</span>}
                  {r.invoiceNumber && <div className="text-[9px] text-slate-400">{r.invoiceNumber}</div>}
                  {dday && <span className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded-full mt-0.5 ${dday.cls}`} title={`결제 기한: ${r.invoiceDueDate}`}>{dday.label}</span>}
                </div>
                <div className="w-28 flex items-center justify-end gap-0.5">
                  {legacyMarketAudit ? (
                    <span
                      className="h-7 px-2 rounded text-[10px] font-semibold bg-orange-50 text-orange-800 inline-flex items-center"
                      title="구 Market 주문은 자동 처리하지 않고 수동 감사만 허용"
                    >수동 감사</span>
                  ) : marketManaged && r.channel === "partner" ? (
                    <span className="h-7 px-2 rounded text-[10px] font-semibold bg-cyan-50 text-cyan-700 inline-flex items-center">위 묶음에서 발송</span>
                  ) : marketManaged ? (
                    <button
                      onClick={() => needsInvoiceRetry(r) ? retryInvoiceOnly(r) : sendToJon(r)}
                      disabled={sending || marketVoidFenced || deliveryState === "complete" || deliveryState === "legacy_complete" || needsDeliveryReview(r)}
                      className="h-7 px-2 rounded text-[10px] font-semibold bg-cyan-50 text-cyan-700 hover:bg-cyan-100 disabled:opacity-40 disabled:cursor-not-allowed"
                      title="미리보기·mailto·복사 없이 DB fence를 선점한 서버 발송"
                    >서버 발송</button>
                  ) : (
                    <>
                      <button onClick={() => setEmailPreview(r)} className="w-7 h-7 rounded flex items-center justify-center text-sm hover:bg-blue-50 text-slate-400 hover:text-blue-600" title="미리보기">📧</button>
                      <button
                        onClick={() => openGmail(r)}
                        disabled={deliveryState !== "ready"}
                        className="w-7 h-7 rounded flex items-center justify-center text-sm hover:bg-slate-100 text-slate-400 hover:text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
                        title={legacyDeliveryComplete
                          ? "기존 발송 완료/중복 발송 차단"
                          : deliveryState !== "ready"
                            ? "Jon 처리 메일 발송 완료/확인 필요 — 중복 발송 차단"
                            : "Gmail"}
                      >📨</button>
                      <button onClick={() => copyEmail(r)} className="w-7 h-7 rounded flex items-center justify-center text-sm hover:bg-slate-100 text-slate-400 hover:text-slate-600" title="복사">📋</button>
                    </>
                  )}
                  <button onClick={() => setCertificateRequest(r)} disabled={marketVoidFenced || legacyMarketAudit} className="w-7 h-7 rounded flex items-center justify-center text-slate-500 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-30 disabled:cursor-not-allowed" title="라이선스 확인서 발급" aria-label={`${r.schoolName} 라이선스 확인서 발급`}><FileText className="w-4 h-4" /></button>
                  <button onClick={() => openEdit(r)} disabled={marketVoidFenced || legacyMarketAudit} className="w-7 h-7 rounded flex items-center justify-center text-sm hover:bg-slate-100 text-slate-400 hover:text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed" title={legacyMarketAudit ? "구 Market 감사 원본 수정 금지" : "수정"}>✎</button>
                  {!marketManaged && !legacyMarketAudit && <button onClick={() => deleteRequest(r.id)} className="w-7 h-7 rounded flex items-center justify-center text-sm hover:bg-red-50 text-slate-300 hover:text-red-500" title="삭제">✕</button>}
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
                    disabled={marketManaged || legacyMarketAudit}
                    className="shrink-0"
                  />
                  <span className="text-sm">{typeInfo?.icon}</span>
                  <span className="font-medium text-sm text-slate-900 truncate flex-1">
                    {(r.applicantType || "school") === "individual" && <span className="text-[9px] px-1 py-0.5 rounded bg-purple-50 text-purple-700 font-medium mr-1">개인</span>}
                    {r.schoolName}
                    {r.needsInvoice && <span className="text-[9px] px-1 py-0.5 rounded bg-blue-50 text-blue-700 font-medium ml-1" title="인보이스 필요 — Cailie CC">💳</span>}
                    {needsInvoiceRetry(r) && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold ml-1">⚠ 재시도</span>
                    )}
                    {needsDeliveryReview(r) && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-rose-100 text-rose-800 font-semibold ml-1">⛔ 확인</span>
                    )}
                    {legacyDeliveryComplete && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-slate-200 text-slate-700 font-semibold ml-1">⛔ 기존 완료</span>
                    )}
                    {legacyMarketAudit && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-orange-100 text-orange-800 font-semibold ml-1">⛔ 구 Market 수동 감사</span>
                    )}
                  </span>
                  <select value={r.status} onChange={(e) => updateStatus(r.id, e.target.value)} disabled={marketVoidFenced || legacyMarketAudit}
                    className={`text-[10px] font-medium rounded-full px-2 py-0.5 border-0 disabled:opacity-50 ${statusInfo?.color || "bg-slate-100"}`}>
                    {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                <div className="text-[11px] font-mono text-slate-500 truncate mt-0.5 ml-6">
                  {emails.length <= 2 ? emails.join(", ") : `${emails[0]} +${emails.length - 1}`}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 ml-6 flex items-center gap-2" title={`신청: ${r.createdAt || "—"}\n완료: ${r.confirmedAt || "—"}`}>
                  <span>📅 {fmtMD(r.createdAt)}</span>
                  {r.confirmedAt && <span className="text-emerald-600">✓ {fmtMD(r.confirmedAt)}</span>}
                </div>
                <div className="flex items-center gap-1.5 mt-1.5 ml-6">
                  {legacyMarketAudit ? (
                    <span className="text-[11px] text-orange-800 px-2 py-1 rounded bg-orange-50 min-h-[28px] inline-flex items-center font-semibold">수동 감사만</span>
                  ) : marketManaged && r.channel === "partner" ? (
                    <span className="text-[11px] text-cyan-700 px-2 py-1 rounded bg-cyan-50 min-h-[28px] inline-flex items-center">위 묶음에서 발송</span>
                  ) : marketManaged ? (
                    <button
                      onClick={() => needsInvoiceRetry(r) ? retryInvoiceOnly(r) : sendToJon(r)}
                      disabled={sending || marketVoidFenced || deliveryState === "complete" || deliveryState === "legacy_complete" || needsDeliveryReview(r)}
                      className="text-[11px] text-cyan-700 px-2 py-1 rounded bg-cyan-50 min-h-[28px] disabled:opacity-40"
                    >서버 발송</button>
                  ) : (
                    <>
                      <button onClick={() => setEmailPreview(r)} className="text-[11px] text-slate-400 hover:text-blue-600 px-2 py-1 rounded bg-slate-50 min-h-[28px]">미리보기</button>
                      <button onClick={() => copyEmail(r)} className="text-[11px] text-slate-400 hover:text-blue-600 px-2 py-1 rounded bg-slate-50 min-h-[28px]">복사</button>
                    </>
                  )}
                  <button onClick={() => setCertificateRequest(r)} disabled={marketVoidFenced || legacyMarketAudit} className="text-[11px] text-blue-700 px-2 py-1 rounded bg-blue-50 min-h-[28px] disabled:opacity-40">라이선스 확인서</button>
                  <button onClick={() => openEdit(r)} disabled={marketVoidFenced || legacyMarketAudit} className="text-[11px] text-slate-400 hover:text-blue-600 px-2 py-1 rounded bg-slate-50 min-h-[28px] disabled:opacity-40">수정</button>
                  {r.invoiceAmount && <span className="text-[10px] font-semibold text-slate-700 ml-auto">{r.invoiceAmount}{r.paymentDate && " ✓"}</span>}
                  {dday && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${dday.cls} ${r.invoiceAmount ? "" : "ml-auto"}`} title={`결제 기한: ${r.invoiceDueDate}`}>{dday.label}</span>}
                </div>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="py-8 text-center text-slate-400 text-sm">
            {requests.length === 0 ? "계정 요청이 없습니다" : "검색 결과 없음"}
          </div>
        )}
      </div>

      {certificateRequest && <LicenseCertificateDialog request={certificateRequest} onClose={() => setCertificateRequest(null)} />}

      {/* 상태 메시지 */}
      {sendMsg && (
        <div className={`fixed bottom-4 right-4 max-w-lg px-4 py-2 rounded-lg text-sm font-medium shadow-lg z-50 ${
          sendMsg.includes("⚠️")
            ? "bg-amber-500 text-amber-950"
            : sendMsg.includes("✓") || sendMsg.includes("📋")
              ? "bg-green-600 text-white"
              : "bg-red-600 text-white"
        }`}>
          {sendMsg}
        </div>
      )}

      {partnerHqPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !sending && setPartnerHqPreview(null)}>
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="border-b bg-cyan-50 p-4 rounded-t-xl">
              <h3 className="font-bold text-cyan-950">협력사 신청 본사 발송 미리보기</h3>
              <p className="mt-1 text-xs text-cyan-800">Jon 처리 요청과 Cailie 인보이스 요청을 기존 서버 발송 흐름으로 보냅니다.</p>
            </div>
            <div className="p-4 space-y-3">
              <div className="text-xs text-slate-500"><b>신청 ID:</b> {partnerHqPreview.requestId}</div>
              <div className="text-sm"><b>학교:</b> {partnerHqPreview.rows[0]?.schoolNameEn || partnerHqPreview.rows[0]?.schoolName}</div>
              <ul className="divide-y rounded-lg border">
                {partnerHqPreview.rows.map((row) => (
                  <li key={row.id} className="p-3 text-sm">
                    <div className="font-medium">{row.teacherName || "—"} · {row.subject || "—"}</div>
                    <div className="mt-0.5 font-mono text-xs text-slate-500">{row.emails}</div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex items-center gap-2 border-t bg-slate-50 p-4 rounded-b-xl">
              <Button size="sm" disabled={sending} onClick={sendPartnerGroup} className="bg-cyan-700 hover:bg-cyan-800 text-xs">
                {sending ? "발송 중…" : "확인 후 본사 발송"}
              </Button>
              <Button size="sm" variant="outline" disabled={sending} onClick={() => setPartnerHqPreview(null)} className="text-xs">취소</Button>
            </div>
          </div>
        </div>
      )}

      {partnerNotificationPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !sending && setPartnerNotificationPreview(null)}>
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="border-b bg-emerald-50 p-4 rounded-t-xl">
              <h3 className="font-bold text-emerald-950">협력사 승인 안내 미리보기</h3>
              <p className="mt-1 text-xs text-emerald-800">최종 확인 전에는 이메일을 발송하지 않습니다.</p>
            </div>
            <div className="p-4 space-y-3">
              <div className="text-sm"><b>수신:</b> {partnerNotificationPreview.recipientEmail}</div>
              <div className="text-sm"><b>학교:</b> {partnerNotificationPreview.schoolName}</div>
              <ul className="divide-y rounded-lg border">
                {partnerNotificationPreview.rows.map((row) => (
                  <li key={row.id} className="p-3 text-sm">
                    <div className="font-medium">{row.teacherName || "—"}</div>
                    <div className="mt-0.5 text-xs text-slate-500">관리자 확인용: {row.email} · {row.subject || "—"}</div>
                  </li>
                ))}
              </ul>
              <p className="rounded-md bg-slate-50 p-2 text-xs text-slate-600">협력사 이메일 본문에는 교사명만 포함되며, 계정 이메일과 과목은 포함되지 않습니다.</p>
            </div>
            <div className="flex items-center gap-2 border-t bg-slate-50 p-4 rounded-b-xl">
              <Button size="sm" disabled={sending} onClick={sendPartnerNotification} className="bg-emerald-700 hover:bg-emerald-800 text-xs">
                {sending ? "발송 중…" : "확인 후 협력사에 발송"}
              </Button>
              <Button size="sm" variant="outline" disabled={sending} onClick={() => setPartnerNotificationPreview(null)} className="text-xs">취소</Button>
            </div>
          </div>
        </div>
      )}

      {/* Email Preview Modal */}
      {emailPreview && !isMarketManaged(emailPreview) && !isLegacyMarketAudit(emailPreview) && (() => {
        const { subject, body } = generateAccountEmail(emailPreview);
        const deliveryState = getAccountEmailDeliveryState(emailPreview);
        const invoiceRetryOnly = deliveryState === "invoice_retry";
        const deliveryUnknown = deliveryState === "processing_unknown" || deliveryState === "invoice_unknown";
        const deliveryComplete = deliveryState === "complete";
        const legacyDeliveryComplete = deliveryState === "legacy_complete";
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setEmailPreview(null)}>
            <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="p-4 border-b bg-slate-50 rounded-t-xl">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-sm">본사에 보낼 이메일</h3>
                  <button onClick={() => setEmailPreview(null)} className="text-slate-400 hover:text-slate-600">✕</button>
                </div>
                <div className="text-xs text-slate-500 space-y-0.5">
                  <div><b>To:</b> {HQ_TO} <span className="text-slate-400">— 처리 요청</span></div>
                  <div><b>Subject:</b> {subject}</div>
                </div>
              </div>
              <div className="p-4">
                <pre className="text-sm text-slate-800 whitespace-pre-wrap font-sans leading-relaxed">{body}</pre>
              </div>
              {emailPreview.needsInvoice && (() => {
                const merged = mergeOpenInvoiceItems([{
                  requestId: emailPreview.id, schoolName: emailPreview.schoolName,
                  schoolNameEn: emailPreview.schoolNameEn, type: emailPreview.type,
                  accountType: emailPreview.accountType, quantity: emailPreview.quantity,
                  extensionDate: emailPreview.extensionDate,
                }], openInvoiceItems);
                const inv = buildInvoiceEmail(merged.items, {
                  newIds: merged.newIds,
                  viewUrl: INVOICE_VIEW_PREVIEW_URL,
                });
                return (
                  <>
                    <div className="p-4 border-y bg-slate-50">
                      <div className="text-xs text-slate-500 space-y-0.5">
                        <div><b>To:</b> {HQ_INVOICE_TO} · CC: {HQ_TO} <span className="text-slate-400">— 인보이스 요청 (별도 발송)</span></div>
                        <div><b>Subject:</b> {inv.subject}</div>
                      </div>
                    </div>
                    <div className="p-4">
                      <pre className="text-sm text-slate-800 whitespace-pre-wrap font-sans leading-relaxed">{inv.body}</pre>
                    </div>
                  </>
                );
              })()}
              {invoiceRetryOnly && (
                <div className="mx-4 mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <div className="font-bold">부분 성공 — Cailie 인보이스 재시도 필요</div>
                  <div className="mt-1">Jon 처리 메일은 이미 발송됐습니다. 아래 버튼은 Jon에게 다시 보내지 않고 인보이스만 재전송합니다.</div>
                </div>
              )}
              {deliveryUnknown && (
                <div className="mx-4 mb-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-900">
                  <div className="font-bold">Gmail 보낸편지함 확인 필요</div>
                  <div className="mt-1">발송 결과가 불확실합니다. 보낸편지함에서 실제 발송 여부를 확인하기 전에는 자동 재시도하지 마세요.</div>
                </div>
              )}
              {legacyDeliveryComplete && (
                <div className="mx-4 mb-3 rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-xs text-slate-800">
                  <div className="font-bold">기존 발송 완료/중복 발송 차단</div>
                  <div className="mt-1">0016 적용 전 이미 처리 완료된 요청입니다. 발송 기록이 중복될 수 있어 일반 발송과 인보이스 재전송을 모두 차단합니다.</div>
                </div>
              )}
              <div className="p-3 border-t bg-slate-50 rounded-b-xl flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => invoiceRetryOnly ? retryInvoiceOnly(emailPreview) : sendToJon(emailPreview)}
                  disabled={sending || deliveryComplete || legacyDeliveryComplete || deliveryUnknown}
                  className={`${invoiceRetryOnly ? "bg-amber-600 hover:bg-amber-700" : "bg-blue-600 hover:bg-blue-700"} text-xs`}
                >
                  {sending
                    ? "발송 중..."
                    : deliveryUnknown
                      ? "⛔ 보낸편지함 확인 필요"
                    : legacyDeliveryComplete
                      ? "⛔ 기존 발송 완료/중복 발송 차단"
                    : deliveryComplete
                      ? "✓ 발송 완료"
                      : invoiceRetryOnly
                        ? "↻ Cailie 인보이스만 재전송"
                        : "📧 발송하기"}
                </Button>
                {deliveryState === "ready" && (
                  <Button size="sm" variant="outline" onClick={() => openGmail(emailPreview)} className="text-xs">
                    Gmail에서 열기
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => copyEmail(emailPreview)} className="text-xs">
                  복사
                </Button>
                <span className="text-[10px] text-slate-400 ml-auto">
                  {invoiceRetryOnly
                    ? "Jon 중복 발송 차단"
                    : deliveryUnknown
                      ? "자동 재시도 금지"
                    : legacyDeliveryComplete
                      ? "기존 발송 완료/중복 발송 차단"
                    : deliveryComplete
                      ? "본사 메일 발송 완료"
                      : "발송 후 자동으로 요청 완료로 변경"}
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
        // 새 목록을 불러오기 전의 오래된 선택 상태가 남아도 legacy 감사행 본문을 렌더링하지 않는다.
        if (selectedRequests.some(isLegacyMarketAudit)) return null;
        const invoiceRetryOnly = selectedRequests.length > 0 && selectedRequests.every(needsInvoiceRetry);
        const deliveryUnknown = selectedRequests.some(needsDeliveryReview);
        const legacyDeliveryComplete = selectedRequests.some(isLegacyDeliveryComplete);
        const hasPreviouslySent = selectedRequests.some(
          (request) => getAccountEmailDeliveryState(request) !== "ready",
        );
        const mixedDeliveryState = hasPreviouslySent && !invoiceRetryOnly && !deliveryUnknown && !legacyDeliveryComplete;
        const totalEmails = selectedRequests.reduce((s, r) => s + countEmails(r.emails), 0);
        // 제목/본문/CC 판정은 전부 SSOT(buildBatchEmail) — 서버 발송과 같은 함수라 미리보기가 실제와 일치한다.
        // 실제 발송에서 confirmLine 자리에 들어갈 confirm 링크만 미리보기용 안내 문구로 대체한다.
        const items: BatchEmailItem[] = selectedRequests.map((r) => {
          const { subject: s, body } = generateAccountEmail(r);
          return {
            subject: s,
            body,
            requestId: r.id,
            needsInvoice: r.needsInvoice ?? defaultNeedsInvoice(r.type),
            confirmLine: "(Confirm 링크는 발송 시 자동 생성됩니다)",
          };
        });
        const { subject, body: previewBody } = buildBatchEmail(items, totalEmails);
        const invoiceRequests = selectedRequests.filter((request) => (
          invoiceRetryOnly
            ? needsInvoiceRetry(request)
            : request.needsInvoice ?? defaultNeedsInvoice(request.type)
        ));
        const invMerged = mergeOpenInvoiceItems(
          invoiceRequests.map((r) => ({
            requestId: r.id, schoolName: r.schoolName, schoolNameEn: r.schoolNameEn,
            type: r.type, accountType: r.accountType, quantity: r.quantity, extensionDate: r.extensionDate,
          })),
          openInvoiceItems,
        );
        const invPreview = invoiceRequests.length > 0
          ? buildInvoiceEmail(invMerged.items, {
              newIds: invMerged.newIds,
              viewUrl: INVOICE_VIEW_PREVIEW_URL,
            })
          : null;
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setBatchPreviewOpen(false)}>
            <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="p-4 border-b bg-slate-50 rounded-t-xl">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-sm">
                    {invoiceRetryOnly ? "Cailie 인보이스 재전송" : "묶음 발송"} — {ids.length}건
                  </h3>
                  <button onClick={() => setBatchPreviewOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
                </div>
                <div className="text-xs text-slate-500 space-y-0.5">
                  {invoiceRetryOnly ? (
                    <div className="font-semibold text-amber-700">Jon 처리 메일은 다시 보내지 않습니다.</div>
                  ) : (
                    <>
                      <div><b>To:</b> {HQ_TO} <span className="text-slate-400">— 처리 요청</span></div>
                      <div><b>Subject:</b> {subject}</div>
                    </>
                  )}
                  {invPreview && (
                    <div className="text-slate-400 pt-0.5">
                      인보이스 {invoiceRequests.length}건은 {HQ_INVOICE_TO} 로 별도 발송 (CC: {HQ_TO}) — 아래 참조
                    </div>
                  )}
                </div>
              </div>
              {!invoiceRetryOnly && (
                <div className="p-4">
                  <pre className="text-xs text-slate-800 whitespace-pre-wrap font-mono leading-relaxed bg-slate-50 rounded-lg p-3 max-h-[50vh] overflow-y-auto">{previewBody}</pre>
                </div>
              )}
              {invPreview && (
                <>
                  <div className="px-4 pb-1 pt-2 border-t">
                    <div className="text-xs text-slate-500 space-y-0.5">
                      <div><b>To:</b> {HQ_INVOICE_TO} · CC: {HQ_TO} <span className="text-slate-400">— 인보이스 요청 (별도 발송)</span></div>
                      <div><b>Subject:</b> {invPreview.subject}</div>
                    </div>
                  </div>
                  <div className="p-4 pt-2">
                    <pre className="text-xs text-slate-800 whitespace-pre-wrap font-mono leading-relaxed bg-slate-50 rounded-lg p-3 max-h-[30vh] overflow-y-auto">{invPreview.body}</pre>
                  </div>
                </>
              )}
              {mixedDeliveryState && (
                <div className="mx-4 mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  이미 Jon에게 발송된 건과 신규 건이 섞여 있습니다. 인보이스 재시도 건만 따로 선택해 주세요.
                </div>
              )}
              {deliveryUnknown && (
                <div className="mx-4 mb-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-900">
                  <div className="font-bold">Gmail 보낸편지함 확인 필요</div>
                  <div className="mt-1">선택한 요청 중 발송 결과가 불확실한 건이 있습니다. 실제 발송 여부를 확인하기 전 자동 재시도는 금지됩니다.</div>
                </div>
              )}
              {legacyDeliveryComplete && (
                <div className="mx-4 mb-3 rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-xs text-slate-800">
                  <div className="font-bold">기존 발송 완료/중복 발송 차단</div>
                  <div className="mt-1">선택한 요청 중 0016 적용 전 이미 처리 완료된 건이 있어 전체 또는 혼합 묶음 발송을 차단합니다.</div>
                </div>
              )}
              <div className="p-3 border-t bg-slate-50 rounded-b-xl flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={sendBatch}
                  disabled={sending || mixedDeliveryState || deliveryUnknown || legacyDeliveryComplete}
                  className={`${invoiceRetryOnly ? "bg-amber-600 hover:bg-amber-700" : "bg-blue-600 hover:bg-blue-700"} text-xs`}
                >
                  {sending
                    ? "발송 중..."
                    : deliveryUnknown
                      ? "⛔ 보낸편지함 확인 필요"
                    : legacyDeliveryComplete
                      ? "⛔ 기존 발송 완료/중복 발송 차단"
                    : mixedDeliveryState
                      ? "선택을 나눠 주세요"
                      : invoiceRetryOnly
                        ? `↻ 인보이스 ${ids.length}건만 재전송`
                        : `📧 ${ids.length}건 발송`}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setBatchPreviewOpen(false)} className="text-xs">
                  취소
                </Button>
                <span className="text-[10px] text-slate-400 ml-auto">
                  {invoiceRetryOnly
                    ? "Jon 중복 발송 차단"
                    : deliveryUnknown
                      ? "자동 재시도 금지"
                    : legacyDeliveryComplete
                      ? "기존 발송 완료/중복 발송 차단"
                    : "발송 시 모두 요청 완료로 변경 + confirm 링크 생성"}
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
          <div className="w-6 h-6 border-2 border-slate-300 border-t-slate-900 rounded-full animate-spin" />
        </div>
      }
    >
      <AccountsPageContent />
    </Suspense>
  );
}
