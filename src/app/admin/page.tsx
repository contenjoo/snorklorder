"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TEAM_COLORS } from "@/lib/teams";

interface DashboardTeacher {
  id: number;
  schoolId: number;
  name: string;
  email: string;
  status: string;
  createdAt: string;
  notifiedAt?: string | null;
  schoolName: string;
  schoolNameEn: string | null;
  schoolTeam: string | null;
}

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

interface SchoolSummary {
  id: number;
  name: string;
  nameEn: string | null;
  region: string | null;
  team: string | null;
  teacherCount: number;
  pendingCount: number;
  sentCount: number;
  upgradedCount: number;
  individualCount: number;
  confirmedCount: number;
}

interface TeamGroup {
  team: string;
  schools: SchoolSummary[];
  schoolCount: number;
  teacherCount: number;
  confirmedCount: number;
}

interface RegionSummary {
  region: string;
  schools: number;
  teachers: number;
}

interface RecentBatch {
  id: number;
  confirmedAt: string | null;
  count: number;
  schools: { name: string; nameEn: string | null; team: string | null; count: number }[];
}

interface FailedEmail {
  id: number;
  toEmail: string;
  subject: string;
  kind: string;
  errorMessage: string | null;
  createdAt: string;
}

interface OpenAccountRequest {
  id: number;
  schoolName: string;
  schoolNameEn: string | null;
  type: string;
  applicantType: string;
  emails: string;
  status: string; // draft | sent | processed | invoiced
  invoiceNumber: string | null;
  invoiceAmount: string | null;
  invoiceDueDate: string | null;
  paymentLink: string | null;
  paymentDate: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
}

interface OpenDomainRequest {
  id: number;
  schoolName: string;
  schoolNameEn: string | null;
  domain: string;
  team: string | null;
  status: string; // pending | done | invoiced
  invoiceNumber: string | null;
  invoiceAmount: string | null;
  invoiceDueDate: string | null;
  paymentLink: string | null;
  paymentDate: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
}

interface ActivityItem {
  id: string;
  type: "email" | "confirm";
  at: string;
  status?: string;
  kind?: string;
  toEmail?: string;
  subject?: string;
  schoolName?: string;
  schoolNameEn?: string | null;
}

function parseAmount(s?: string | null): number {
  if (!s) return 0;
  const n = Number(String(s).replace(/[^\d.]/g, ""));
  return isNaN(n) ? 0 : n;
}

// D-day 뱃지: 결제 기한 기준 (account는 'YYYY-MM-DD' date, domain은 자유 텍스트일 수 있어 파싱 실패 시 null)
function dDayInfo(invoiceDueDate: string | null | undefined): { label: string; cls: string; diff: number } | null {
  if (!invoiceDueDate) return null;
  const due = /^\d{4}-\d{2}-\d{2}/.test(invoiceDueDate)
    ? new Date(`${invoiceDueDate.slice(0, 10)}T00:00:00`)
    : new Date(invoiceDueDate);
  if (isNaN(due.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return { label: `D+${-diff}`, cls: "bg-red-100 text-red-700", diff }; // 기한 초과
  if (diff <= 3) return { label: `D-${diff}`, cls: "bg-orange-100 text-orange-700", diff }; // 임박
  return { label: `D-${diff}`, cls: "bg-gray-100 text-gray-500", diff };
}

function classifyAccount(r: OpenAccountRequest): "JON_PROCESS" | "JON_INVOICE" | "ME_PAY" | "JON_CONFIRM" {
  if (r.status === "draft" || r.status === "sent") return "JON_PROCESS";
  if (r.status === "processed" && !r.invoiceNumber) return "JON_INVOICE";
  if (r.status === "invoiced" && !r.paymentDate) return "ME_PAY";
  return "JON_CONFIRM";
}

function classifyDomain(r: OpenDomainRequest): "JON_PROCESS" | "JON_INVOICE" | "ME_PAY" | "JON_CONFIRM" {
  if (r.status === "pending") return "JON_PROCESS";
  if (r.status === "done" && !r.invoiceNumber) return "JON_INVOICE";
  if (r.status === "invoiced" && !r.paymentDate) return "ME_PAY";
  return "JON_CONFIRM";
}

interface ApprovalQueueTeacher {
  id: number;
  schoolId: number;
  name: string;
  email: string;
  subject: string | null;
  verificationStatus: string;
  emailVerifiedAt: string | null;
  escalatedAt: string | null;
  createdAt: string;
  schoolName: string;
  schoolNameEn: string | null;
  schoolTeam: string | null;
}

interface DashboardData {
  stats: {
    totalSchools: number;
    totalTeachers: number;
    pending: number;
    sent: number;
    upgraded: number;
    individual: number;
    confirmed: number;
  };
  pipeline: { awaitingApproval: number; readyForJon: number; sentToJon: number };
  teamGroups: TeamGroup[];
  approvalQueue: ApprovalQueueTeacher[];
  upgradeNeeded: Array<SchoolSummary & { needTeachers: DashboardTeacher[] }>;
  recentTeachers: DashboardTeacher[];
  recentBatches: RecentBatch[];
  recentFailedEmails: FailedEmail[];
  openAccountRequests: OpenAccountRequest[];
  openDomainRequests: OpenDomainRequest[];
  regions: RegionSummary[];
  monthlyUpgrades: { teachers: number; schools: number };
  activity: ActivityItem[];
  billingStatusCounts: Record<string, number>;
}

const teamColorMap = TEAM_COLORS;

const REQ_TYPE_CHIP: Record<string, string> = {
  upgrade: "⬆️",
  email_change: "✉️",
  type_change: "🔄",
  extension: "📅",
};

const EMAIL_KIND_LABEL: Record<string, string> = {
  batch_notification: "Jon 발송",
  teacher_upgraded: "완료 안내",
  account_email: "정산 메일",
  account_confirm: "confirm 안내",
  stale_reminder: "리마인드",
  daily_digest: "다이제스트",
  school_code: "학교 코드",
  admin_request: "관리자 알림",
};

const PIPE_STAGES = [
  { value: "draft", label: "작성" },
  { value: "sent", label: "발송됨" },
  { value: "processed", label: "처리완료" },
  { value: "invoiced", label: "인보이스" },
  { value: "paid", label: "결제완료" },
];

// 활동 피드 시간: 오늘=HH:MM, 어제, 그 외 M/D
function feedTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (d >= startToday) return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
  const startYesterday = new Date(startToday);
  startYesterday.setDate(startYesterday.getDate() - 1);
  if (d >= startYesterday) return "어제";
  return d.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}

function ageText(days: number): string {
  return days <= 0 ? "오늘" : `${days}일째`;
}

export default function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [approvalSelected, setApprovalSelected] = useState<Set<number>>(new Set());
  const [approving, setApproving] = useState(false);

  function toggleId(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleSchool(ids: number[], allSelected: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/summary");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to load dashboard");
      setData(body);
    } catch {
      setMessage("대시보드를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" />
      </div>
    );
  }

  const { stats, pipeline, teamGroups, approvalQueue, upgradeNeeded, recentTeachers, recentBatches, recentFailedEmails, openAccountRequests, openDomainRequests, regions, monthlyUpgrades, activity, billingStatusCounts } = data;

  // Billing pipeline 분류 (account + domain 통합) — 기존 classify 로직 재사용
  type BillingItem = {
    id: string; source: "account" | "domain"; rawId: number;
    schoolName: string; schoolNameEn: string | null; team: string | null;
    reqType: string; applicantType: string; emailCount: number;
    amount: number; amountText: string;
    paymentLink: string | null; invoiceNumber: string | null; invoiceDueDate: string | null;
    status: string; bucket: "JON_PROCESS" | "JON_INVOICE" | "ME_PAY" | "JON_CONFIRM";
    updatedAt: string; ageDays: number;
  };
  const items: BillingItem[] = [];
  for (const r of (openAccountRequests || [])) {
    items.push({
      id: `a-${r.id}`, source: "account", rawId: r.id, schoolName: r.schoolName, schoolNameEn: r.schoolNameEn, team: null,
      reqType: r.type, applicantType: r.applicantType || "school",
      emailCount: r.emails.split(/[,;\n]+/).filter((e) => e.trim() && e.includes("@")).length,
      amount: parseAmount(r.invoiceAmount), amountText: r.invoiceAmount || "",
      paymentLink: r.paymentLink, invoiceNumber: r.invoiceNumber, invoiceDueDate: r.invoiceDueDate,
      status: r.status, bucket: classifyAccount(r),
      updatedAt: r.updatedAt, ageDays: daysSince(r.updatedAt) ?? 0,
    });
  }
  for (const r of (openDomainRequests || [])) {
    items.push({
      id: `d-${r.id}`, source: "domain", rawId: r.id, schoolName: r.schoolName, schoolNameEn: r.schoolNameEn, team: r.team,
      reqType: "domain", applicantType: "school", emailCount: 0,
      amount: parseAmount(r.invoiceAmount), amountText: r.invoiceAmount || "",
      paymentLink: r.paymentLink, invoiceNumber: r.invoiceNumber, invoiceDueDate: r.invoiceDueDate,
      status: r.status, bucket: classifyDomain(r),
      updatedAt: r.updatedAt, ageDays: daysSince(r.updatedAt) ?? 0,
    });
  }
  const buckets = {
    JON_PROCESS: items.filter((i) => i.bucket === "JON_PROCESS"),
    JON_INVOICE: items.filter((i) => i.bucket === "JON_INVOICE"),
    ME_PAY: items.filter((i) => i.bucket === "ME_PAY"),
    JON_CONFIRM: items.filter((i) => i.bucket === "JON_CONFIRM"),
  };

  // 오늘 할 일 그룹: 내 차례 → Jon 차례 → 승인 대기
  const myDrafts = buckets.JON_PROCESS.filter((i) => i.source === "account" && i.status === "draft")
    .sort((a, b) => b.ageDays - a.ageDays);
  const mePay = [...buckets.ME_PAY].sort((a, b) => {
    const da = dDayInfo(a.invoiceDueDate)?.diff ?? Infinity;
    const db_ = dDayInfo(b.invoiceDueDate)?.diff ?? Infinity;
    return da - db_;
  });
  const jonWaiting = buckets.JON_PROCESS.filter((i) => !(i.source === "account" && i.status === "draft"))
    .sort((a, b) => b.ageDays - a.ageDays);
  const jonInvoice = [...buckets.JON_INVOICE].sort((a, b) => b.ageDays - a.ageDays);
  const jonConfirm = [...buckets.JON_CONFIRM].sort((a, b) => b.ageDays - a.ageDays);

  const myTurnCount = myDrafts.length + mePay.length;
  const jonTurnItems = [...jonWaiting, ...jonInvoice, ...jonConfirm];
  const todoCount = myTurnCount + jonTurnItems.length + approvalQueue.length;

  // KPI 계산
  const outstanding = buckets.ME_PAY.reduce((s, i) => s + i.amount, 0);
  const dueDiffs = buckets.ME_PAY
    .map((i) => dDayInfo(i.invoiceDueDate)?.diff)
    .filter((d): d is number => d !== undefined);
  const nearestDue = dueDiffs.length > 0 ? Math.min(...dueDiffs) : null;
  const nearestDueLabel = nearestDue === null ? null : nearestDue < 0 ? `D+${-nearestDue}` : `D-${nearestDue}`;

  // Jon 발송 대기/발송됨 = 검증 승인(approved)된 교사만 (목록과 카운트 일치)
  const needUpgrade = pipeline.readyForJon + pipeline.sentToJon;
  const upgradeRate = stats.totalTeachers > 0 ? Math.round((stats.confirmed / stats.totalTeachers) * 100) : 0;
  const maxRegionTeachers = Math.max(1, ...regions.map((region) => region.teachers));

  const allPendingIds = upgradeNeeded.flatMap((school) =>
    school.needTeachers.filter((teacher) => teacher.status === "pending").map((teacher) => teacher.id)
  );
  const targetIds = selectedIds.size > 0
    ? allPendingIds.filter((id) => selectedIds.has(id))
    : allPendingIds;

  function toggleApproval(id: number) {
    setApprovalSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function reviewHqTeacher(ids: number[], action: "approve" | "reject") {
    if (ids.length === 0) return;
    let reason: string | undefined;
    if (action === "reject") { const r = prompt(`거절 사유 (선택) — ${ids.length}명`); reason = r || undefined; }
    setApproving(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/verify-teacher", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, action, reason }) });
      if (res.ok) {
        setMessage(`${ids.length}명 ${action === "approve" ? "승인" : "거절"} 완료`);
        setApprovalSelected(new Set());
        await load();
      } else {
        const d = await res.json().catch(() => ({}));
        setMessage(d.error || "처리 실패");
      }
    } catch {
      setMessage("연결 오류");
    } finally {
      setApproving(false);
    }
  }

  async function sendSelected() {
    if (targetIds.length === 0) return;

    setSending(true);
    setMessage("");
    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teacherIds: targetIds }),
      });
      const body = await res.json();
      setMessage(body.success ? `${targetIds.length}명 Jon에게 발송 완료` : "발송 실패");
      if (body.success) { setSelectedIds(new Set()); await load(); }
    } catch {
      setMessage("연결 오류");
    } finally {
      setSending(false);
    }
  }

  // 할 일 행 공통: 학교명(영문 병기) + 타입 칩 + 상세 1줄 + 경과일 + 인라인 액션
  function renderBillingRow(i: BillingItem, group: "MY_DRAFT" | "MY_PAY" | "JON") {
    const dday = group === "MY_PAY" ? dDayInfo(i.invoiceDueDate) : null;
    const stale = i.ageDays >= 3;
    const typeChip = i.source === "domain"
      ? "🌐 도메인"
      : i.reqType === "upgrade" && i.emailCount > 0
        ? `⬆️ ${i.emailCount}명`
        : `${REQ_TYPE_CHIP[i.reqType] || "📚"} ${i.reqType === "email_change" ? "이메일 변경" : i.reqType === "type_change" ? "타입 변경" : i.reqType === "extension" ? "연장" : "정산"}`;
    const jonChip = i.bucket === "JON_PROCESS" ? { label: "처리 대기", cls: "bg-purple-50 text-purple-700" }
      : i.bucket === "JON_INVOICE" ? { label: "인보이스 대기", cls: "bg-amber-50 text-amber-700" }
        : { label: "확인 대기", cls: "bg-blue-50 text-blue-700" };
    const detail = group === "MY_DRAFT"
      ? `draft — Jon에게 아직 발송 안 됨`
      : group === "MY_PAY"
        ? [i.invoiceNumber, i.invoiceDueDate ? `기한 ${i.invoiceDueDate.slice(0, 10)}` : null, i.paymentLink ? "결제 링크 있음" : "결제 링크 없음"].filter(Boolean).join(" · ")
        : i.bucket === "JON_PROCESS"
          ? `${i.status === "sent" ? "Jon에게 발송됨" : "처리 요청됨"} — 처리 대기 중`
          : i.bucket === "JON_INVOICE"
            ? "처리 완료 · 인보이스 아직"
            : "결제 완료 · Jon confirm 대기";
    return (
      <div key={i.id} className="flex items-center gap-3 px-4 md:px-5 py-2.5 border-t hover:bg-gray-50/70">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-bold text-gray-900 truncate">
              {i.applicantType === "individual" ? `개인 · ${i.schoolName}` : i.schoolName}
            </span>
            {i.schoolNameEn && <span className="text-[11px] text-gray-400 truncate hidden sm:inline">{i.schoolNameEn}</span>}
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 whitespace-nowrap">{typeChip}</span>
            {group === "MY_PAY" && i.amountText && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-700 whitespace-nowrap">💳 {i.amountText}</span>
            )}
            {group === "JON" && (
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${jonChip.cls}`}>{jonChip.label}</span>
            )}
          </div>
          <div className="text-[11px] text-gray-500 truncate mt-0.5">{detail}</div>
        </div>
        {group === "MY_PAY" && dday ? (
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${dday.cls}`} title={`결제 기한: ${i.invoiceDueDate}`}>{dday.label}</span>
        ) : (
          <span className={`text-[11px] shrink-0 tabular-nums ${stale ? "text-red-600 font-bold" : "text-gray-400"}`}>
            {ageText(i.ageDays)}{stale ? " 🔥" : ""}
          </span>
        )}
        {group === "MY_DRAFT" && (
          <Link
            href={`/admin/accounts?focus=${i.rawId}`}
            className="shrink-0 text-xs font-semibold bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
          >
            📧 발송
          </Link>
        )}
        {group === "MY_PAY" && (
          i.paymentLink ? (
            <a
              href={i.paymentLink}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-xs font-semibold bg-red-600 text-white px-3 py-1.5 rounded-lg hover:bg-red-700 transition-colors whitespace-nowrap"
            >
              결제 열기
            </a>
          ) : i.source === "account" ? (
            <Link
              href={`/admin/accounts?focus=${i.rawId}`}
              className="shrink-0 text-xs font-semibold border text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap"
            >
              상세
            </Link>
          ) : null
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-20 md:pb-0">
      {/* ── KPI 스트립 ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <div className={`bg-white rounded-xl border p-3.5 ${myTurnCount > 0 ? "border-red-300 shadow-[inset_3px_0_0_#dc2626]" : ""}`}>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">지금 내 차례</p>
          <p className={`text-2xl font-extrabold tabular-nums leading-tight mt-0.5 ${myTurnCount > 0 ? "text-red-600" : "text-gray-900"}`}>{myTurnCount}</p>
          <p className="text-[11px] text-gray-500">발송 대기 {myDrafts.length} · 결제 {mePay.length}</p>
        </div>
        <div className="bg-white rounded-xl border p-3.5">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Jon 차례</p>
          <p className="text-2xl font-extrabold tabular-nums text-gray-900 leading-tight mt-0.5">{jonWaiting.length + jonInvoice.length}</p>
          <p className="text-[11px] text-gray-500">처리 대기 {jonWaiting.length} · 인보이스 {jonInvoice.length}</p>
        </div>
        <div className="bg-white rounded-xl border p-3.5">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">결제 예정 금액</p>
          <p className="text-2xl font-extrabold tabular-nums text-gray-900 leading-tight mt-0.5">{outstanding > 0 ? `$${outstanding.toLocaleString()}` : "—"}</p>
          <p className="text-[11px] text-gray-500">인보이스 {mePay.length}건{nearestDueLabel ? ` · 최근접 ${nearestDueLabel}` : ""}</p>
        </div>
        <div className="bg-white rounded-xl border p-3.5">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">이번 달 업그레이드</p>
          <p className="text-2xl font-extrabold tabular-nums text-gray-900 leading-tight mt-0.5">
            {monthlyUpgrades?.teachers ?? 0}<span className="text-sm font-semibold text-gray-400">명</span>
          </p>
          <p className="text-[11px] text-gray-500">{monthlyUpgrades?.schools ?? 0}개교</p>
        </div>
      </div>

      {/* ── 메인 2컬럼 ── */}
      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-4 items-start">
        {/* 좌측: 오늘 할 일 */}
        <div className="space-y-4">
          <details open className="bg-white rounded-2xl border overflow-hidden group">
            <summary className="flex items-center gap-2.5 px-4 md:px-5 py-3.5 border-b cursor-pointer list-none [&::-webkit-details-marker]:hidden select-none">
              <h2 className="font-bold text-gray-900 text-[15px]">오늘 할 일</h2>
              <span className="text-[11px] font-bold text-gray-500 bg-gray-100 rounded-full px-2.5 py-0.5 tabular-nums">{todoCount}</span>
              <span className="ml-auto flex items-center gap-2">
                <Link href="/admin/accounts" onClick={(e) => e.stopPropagation()} className="text-xs text-blue-600 hover:underline font-medium">전체 보기 →</Link>
                <span className="text-gray-400 text-xs transition-transform group-open:rotate-180">▾</span>
              </span>
            </summary>

            {todoCount === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-gray-400">오늘 할 일 없음 ✓</div>
            ) : (
              <>
                {myTurnCount > 0 && (
                  <div className="flex items-center gap-1.5 px-4 md:px-5 pt-3 pb-1 text-[10px] font-extrabold uppercase tracking-widest text-blue-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-700" />내 차례
                  </div>
                )}
                {myDrafts.map((i) => renderBillingRow(i, "MY_DRAFT"))}
                {mePay.map((i) => renderBillingRow(i, "MY_PAY"))}

                {jonTurnItems.length > 0 && (
                  <div className="flex items-center gap-1.5 px-4 md:px-5 pt-3 pb-1 text-[10px] font-extrabold uppercase tracking-widest text-purple-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-700" />Jon 차례
                    <span className="font-medium normal-case tracking-normal text-gray-400">— 3일 넘으면 🔥</span>
                  </div>
                )}
                {jonTurnItems.map((i) => renderBillingRow(i, "JON"))}

                {approvalQueue.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 px-4 md:px-5 pt-3 pb-1">
                    <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-widest text-emerald-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-700" />승인 대기 (거짓등록 방지)
                    </div>
                    {(() => {
                      const allChecked = approvalSelected.size === approvalQueue.length && approvalQueue.length > 0;
                      return (
                        <button
                          type="button"
                          onClick={() => setApprovalSelected(allChecked ? new Set() : new Set(approvalQueue.map((t) => t.id)))}
                          className="text-[11px] font-medium text-blue-600 hover:text-blue-700 hover:underline"
                        >
                          {allChecked ? "전체 해제" : "전체 선택"}
                        </button>
                      );
                    })()}
                    <div className="ml-auto flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={approving}
                        onClick={() => reviewHqTeacher(approvalSelected.size > 0 ? [...approvalSelected] : approvalQueue.map((t) => t.id), "approve")}
                        className="text-[11px] font-semibold bg-emerald-600 text-white px-2.5 py-1 rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                      >
                        {approving ? "처리 중..." : approvalSelected.size > 0 ? `선택 ${approvalSelected.size}명 승인` : `전체 ${approvalQueue.length}명 승인`}
                      </button>
                      {approvalSelected.size > 0 && (
                        <button
                          type="button"
                          disabled={approving}
                          onClick={() => reviewHqTeacher([...approvalSelected], "reject")}
                          className="text-[11px] font-semibold bg-red-50 text-red-700 border border-red-200 px-2.5 py-1 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors"
                        >
                          거절
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {approvalQueue.map((teacher) => {
                  const tc = teamColorMap[teacher.schoolTeam || ""] || { bg: "bg-gray-50", text: "text-gray-600", dot: "bg-gray-400", border: "border-gray-200" };
                  const regDays = daysSince(teacher.createdAt) ?? 0;
                  return (
                    <div key={teacher.id} className="flex items-center gap-2.5 px-4 md:px-5 py-2.5 border-t hover:bg-gray-50/70">
                      <input
                        type="checkbox"
                        checked={approvalSelected.has(teacher.id)}
                        onChange={() => toggleApproval(teacher.id)}
                        className="w-4 h-4 accent-emerald-600 cursor-pointer shrink-0"
                        aria-label={`${teacher.email} 선택`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[13px] font-bold text-gray-900 truncate">{teacher.schoolName} · {teacher.name}</span>
                          <span className="text-[11px] text-gray-400 truncate hidden sm:inline">{teacher.email}</span>
                          {teacher.schoolTeam && <span className={`text-[10px] px-2 py-0.5 rounded-full ${tc.bg} ${tc.text} border ${tc.border}`}>{teacher.schoolTeam}</span>}
                        </div>
                        <div className="text-[11px] text-gray-500 truncate mt-0.5">
                          {teacher.emailVerifiedAt ? "이메일 인증됨" : "미인증(레거시)"}
                          {teacher.escalatedAt ? " · 학교 관리자 무응답 → 본사 이관" : ""}
                        </div>
                      </div>
                      <span className={`text-[11px] shrink-0 tabular-nums ${regDays >= 3 ? "text-red-600 font-bold" : "text-gray-400"}`}>{ageText(regDays)}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          disabled={approving}
                          onClick={() => reviewHqTeacher([teacher.id], "approve")}
                          className="text-xs font-semibold bg-emerald-600 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                        >
                          ✓ 승인
                        </button>
                        <button
                          type="button"
                          disabled={approving}
                          onClick={() => reviewHqTeacher([teacher.id], "reject")}
                          className="text-xs font-semibold bg-red-50 text-red-700 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors"
                        >
                          거절
                        </button>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </details>

          {/* Jon 발송 대기 큐 (교사 업그레이드) — 기존 기능 유지 */}
          {needUpgrade > 0 && (
            <div className="bg-white rounded-2xl border overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 md:px-5 py-3 md:py-4 border-b">
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="font-bold text-gray-900">Jon 발송 대기 / Upgrade</h2>
                  <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200">{needUpgrade}명</span>
                  {allPendingIds.length > 0 && (() => {
                    const allChecked = selectedIds.size === allPendingIds.length && allPendingIds.length > 0;
                    return (
                      <button
                        type="button"
                        onClick={() => setSelectedIds(allChecked ? new Set() : new Set(allPendingIds))}
                        className="text-[11px] font-medium text-blue-600 hover:text-blue-700 hover:underline"
                      >
                        {allChecked ? "전체 해제" : "전체 선택"}
                      </button>
                    );
                  })()}
                  {selectedIds.size > 0 && (
                    <span className="text-[11px] text-gray-500">{selectedIds.size}명 선택됨</span>
                  )}
                </div>
                {allPendingIds.length > 0 && (
                  <button onClick={sendSelected} disabled={sending || targetIds.length === 0}
                    className="text-xs font-semibold bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors w-full sm:w-auto">
                    {sending ? "발송 중..." : selectedIds.size > 0 ? `선택한 ${targetIds.length}명 Jon에게 발송` : `전체 ${allPendingIds.length}명 Jon에게 발송`}
                  </button>
                )}
              </div>
              <div className="divide-y max-h-[400px] overflow-y-auto">
                {upgradeNeeded.map((school) => {
                  const tc = teamColorMap[school.team || ""] || { bg: "bg-gray-50", text: "text-gray-600", dot: "bg-gray-400", border: "border-gray-200" };
                  const schoolPendingIds = school.needTeachers.filter((t) => t.status === "pending").map((t) => t.id);
                  const selectedInSchool = schoolPendingIds.filter((id) => selectedIds.has(id)).length;
                  const allSelected = schoolPendingIds.length > 0 && selectedInSchool === schoolPendingIds.length;
                  const someSelected = selectedInSchool > 0 && !allSelected;
                  const maxSentDays = school.needTeachers
                    .filter((t) => t.status === "sent")
                    .map((t) => daysSince(t.notifiedAt))
                    .filter((d): d is number => d !== null)
                    .reduce((max, d) => Math.max(max, d), 0);
                  const stale = maxSentDays >= 3;
                  return (
                    <div key={school.id} className="px-4 md:px-5 py-3">
                      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mb-2">
                        {schoolPendingIds.length > 0 && (
                          <input
                            type="checkbox"
                            checked={allSelected}
                            ref={(el) => { if (el) el.indeterminate = someSelected; }}
                            onChange={() => toggleSchool(schoolPendingIds, allSelected)}
                            className="w-3.5 h-3.5 accent-slate-900 cursor-pointer"
                            aria-label={`${school.name} 전체 선택`}
                          />
                        )}
                        <span className="text-sm font-semibold text-gray-900">{school.nameEn || school.name}</span>
                        {school.nameEn && <span className="text-[10px] text-gray-400">{school.name}</span>}
                        {school.team && <span className={`text-[10px] px-2 py-0.5 rounded-full ${tc.bg} ${tc.text} border ${tc.border}`}>{school.team}</span>}
                        {stale && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200 font-bold animate-pulse" title={`Jon에게 발송 후 ${maxSentDays}일 경과 — 리마인드 필요`}>
                            🔥 {maxSentDays}일째 묶임
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {school.needTeachers.map((teacher) => {
                          const selectable = teacher.status === "pending";
                          const isSelected = selectedIds.has(teacher.id);
                          return (
                            <label
                              key={teacher.id}
                              title={teacher.email}
                              className={`inline-flex items-center gap-1.5 text-[10px] font-mono px-2 py-0.5 rounded-lg truncate max-w-[200px] sm:max-w-none transition-colors ${
                                !selectable
                                  ? "bg-blue-50 text-blue-700 border border-blue-200 cursor-not-allowed"
                                  : isSelected
                                    ? "bg-slate-900 text-white border border-slate-900 cursor-pointer"
                                    : "bg-amber-50 text-amber-700 border border-amber-200 cursor-pointer hover:bg-amber-100"
                              }`}
                            >
                              {selectable && (
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleId(teacher.id)}
                                  className="w-3 h-3 accent-white cursor-pointer"
                                  aria-label={`${teacher.email} 선택`}
                                />
                              )}
                              <span className="truncate">{teacher.email}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 우측: 파이프라인 + 실패 메일 + 활동 피드 */}
        <div className="space-y-4">
          <section className="bg-white rounded-2xl border overflow-hidden">
            <div className="flex items-center justify-between px-4 md:px-5 py-3.5 border-b">
              <h2 className="font-bold text-gray-900 text-[15px]">정산 파이프라인</h2>
              <Link href="/admin/accounts" className="text-xs text-blue-600 hover:underline font-medium">정산 →</Link>
            </div>
            <div className="grid grid-cols-5 gap-1.5 px-4 py-3.5">
              {PIPE_STAGES.map((stage) => {
                const count = billingStatusCounts?.[stage.value] ?? 0;
                const stalled = stage.value !== "paid" && items.some(
                  (i) => i.source === "account" && i.status === stage.value && i.ageDays >= 3
                );
                return (
                  <Link
                    key={stage.value}
                    href={`/admin/accounts?filter=${stage.value}`}
                    className={`rounded-lg px-1.5 py-2 text-center transition-colors ${stalled ? "bg-red-50 hover:bg-red-100" : "bg-gray-50 hover:bg-gray-100"}`}
                    title={stalled ? "3일 이상 대기 중인 건 있음" : undefined}
                  >
                    <div className={`text-lg font-extrabold tabular-nums leading-tight ${stalled ? "text-red-600" : "text-gray-900"}`}>{count}</div>
                    <div className="text-[10px] font-semibold text-gray-500 whitespace-nowrap">{stage.label}</div>
                  </Link>
                );
              })}
            </div>
            <div className="flex justify-between px-5 pb-3 text-[10px] text-gray-400">
              <span>← 내가 보냄</span><span>Jon 처리</span><span>결제 →</span>
            </div>
          </section>

          {/* 실패 메일 배너 — 활동 피드 위 */}
          {recentFailedEmails && recentFailedEmails.length > 0 && (
            <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-4">
              <div className="flex items-start gap-3">
                <span className="text-2xl">⚠️</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <p className="text-sm font-bold text-red-900">최근 메일 발송 실패 {recentFailedEmails.length}건</p>
                    <span className="text-[10px] text-red-600">최근 10건 표시</span>
                  </div>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {recentFailedEmails.map((f) => (
                      <div key={f.id} className="flex items-center gap-2 text-[11px] bg-white rounded px-2 py-1 border border-red-100">
                        <span className="font-mono text-red-700 shrink-0">{f.kind}</span>
                        <span className="text-gray-600 truncate flex-1" title={f.subject}>{f.subject}</span>
                        <span className="font-mono text-gray-500 shrink-0">→ {f.toEmail}</span>
                        <span className="text-gray-400 shrink-0">{new Date(f.createdAt).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 활동 피드 */}
          <section className="bg-white rounded-2xl border overflow-hidden">
            <div className="flex items-center gap-2.5 px-4 md:px-5 py-3.5 border-b">
              <h2 className="font-bold text-gray-900 text-[15px]">활동</h2>
              <span className="text-[11px] font-bold text-gray-500 bg-gray-100 rounded-full px-2.5 py-0.5">최근 {activity?.length ?? 0}건</span>
            </div>
            {!activity || activity.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-gray-400">최근 활동이 없습니다.</div>
            ) : (
              <ul>
                {activity.map((a, idx) => {
                  const dot = a.type === "confirm"
                    ? "bg-purple-500"
                    : a.status === "failed"
                      ? "bg-red-500"
                      : a.kind === "account_email" || a.kind === "batch_notification"
                        ? "bg-blue-500"
                        : "bg-emerald-500";
                  return (
                    <li key={a.id} className={`flex gap-2.5 px-4 md:px-5 py-2 text-xs ${idx > 0 ? "border-t" : ""}`}>
                      <span className="text-gray-400 tabular-nums whitespace-nowrap w-11 shrink-0">{feedTime(a.at)}</span>
                      <span className={`w-2 h-2 rounded-full mt-1 shrink-0 ${dot}`} />
                      {a.type === "confirm" ? (
                        <span className="text-gray-500 min-w-0 truncate" title={a.schoolName || ""}>
                          Jon이 <b className="text-gray-900 font-semibold">{a.schoolNameEn || a.schoolName}</b> confirm
                        </span>
                      ) : (
                        <span className="text-gray-500 min-w-0 truncate" title={a.subject || ""}>
                          <b className="text-gray-900 font-semibold">{a.toEmail}</b> {EMAIL_KIND_LABEL[a.kind || ""] || a.kind} {a.status === "failed" ? "발송 실패" : "발송 성공"}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>

      {/* ── 하단: 전체 현황 접기 카드 ── */}
      <details className="bg-white rounded-2xl border overflow-hidden group">
        <summary className="flex items-center gap-2 px-4 md:px-5 py-3.5 cursor-pointer font-bold text-gray-900 text-[15px] list-none [&::-webkit-details-marker]:hidden select-none">
          📊 전체 현황 (팀 · 지역 · 누적)
          <svg className="w-4 h-4 text-gray-400 ml-auto transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </summary>
        <div className="border-t px-4 md:px-5 py-4 space-y-4">
          {/* 누적 통계 */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-lg font-extrabold tabular-nums text-gray-900">{stats.totalSchools}</p>
              <p className="text-[11px] text-gray-500">등록 학교</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-lg font-extrabold tabular-nums text-gray-900">{stats.totalTeachers}</p>
              <p className="text-[11px] text-gray-500">누적 교사</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-lg font-extrabold tabular-nums text-gray-900">{upgradeRate}%</p>
              <p className="text-[11px] text-gray-500">확정률 ({stats.confirmed}/{stats.totalTeachers})</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-lg font-extrabold tabular-nums text-gray-900">{teamGroups.reduce((sum, group) => sum + group.teacherCount, 0)}</p>
              <p className="text-[11px] text-gray-500">공동구매 ({teamGroups.length}팀 · {teamGroups.reduce((sum, group) => sum + group.schoolCount, 0)}교)</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-lg font-extrabold tabular-nums text-gray-900">{stats.individual}</p>
              <p className="text-[11px] text-gray-500">개별구매</p>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4 items-start">
            {/* 팀별 */}
            <div className="rounded-xl border overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50/60">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-gray-900 text-sm">공동구매팀</h3>
                  <span className="text-xs text-gray-400">{teamGroups.length}팀</span>
                </div>
                <Link href="/admin/schools" className="text-xs text-blue-600 hover:underline">전체 보기</Link>
              </div>
              <div className="divide-y">
                {teamGroups.map((group) => {
                  const tc = teamColorMap[group.team] || { bg: "bg-gray-50", text: "text-gray-600", dot: "bg-gray-400", border: "border-gray-200" };
                  const rate = group.teacherCount > 0 ? Math.round((group.confirmedCount / group.teacherCount) * 100) : 0;
                  const isOpen = expandedTeam === group.team;

                  return (
                    <div key={group.team}>
                      <button
                        type="button"
                        className="w-full flex flex-wrap items-center gap-2 px-4 py-2.5 text-left hover:bg-gray-50/80 transition-colors"
                        onClick={() => setExpandedTeam(isOpen ? null : group.team)}
                      >
                        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${tc.dot}`} />
                        <span className="font-semibold text-sm text-gray-900 w-20 shrink-0">{group.team}</span>
                        <span className="text-[10px] text-gray-400">{group.schoolCount}교</span>
                        <div className="ml-auto flex items-center gap-2">
                          <span className="text-xs font-mono text-gray-500">{group.confirmedCount}/{group.teacherCount}</span>
                          <div className="h-1.5 w-16 rounded-full bg-gray-100 overflow-hidden">
                            <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${rate}%` }} />
                          </div>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${rate === 100 ? "text-emerald-600 bg-emerald-50 border-emerald-200" : "text-amber-600 bg-amber-50 border-amber-200"}`}>{rate === 100 ? "완성" : `${rate}%`}</span>
                          <svg className={`w-4 h-4 text-gray-300 transition-transform shrink-0 ${isOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </button>
                      {isOpen && (
                        <div className="bg-gray-50/60 border-t px-4 py-2 divide-y divide-gray-100">
                          {group.schools.map((school) => (
                            <div key={school.id} className="py-2">
                              <div className="flex items-center gap-2">
                                <span className={`w-1.5 h-1.5 rounded-full ${school.teacherCount > 0 && school.confirmedCount === school.teacherCount ? "bg-emerald-400" : school.teacherCount > 0 ? "bg-amber-400" : "bg-gray-300"}`} />
                                <span className="text-xs font-medium text-gray-800">{school.name}</span>
                                <span className="text-[10px] text-gray-400">{school.nameEn}</span>
                                <span className="text-[10px] font-mono text-gray-400 ml-auto">{school.confirmedCount}/{school.teacherCount}</span>
                              </div>
                              {(school.pendingCount > 0 || school.sentCount > 0) && (
                                <div className="flex gap-1 ml-3.5 mt-1.5">
                                  {school.pendingCount > 0 && <span className="text-[10px] bg-amber-50 text-amber-600 border border-amber-200 rounded px-1.5 py-0.5">대기 {school.pendingCount}</span>}
                                  {school.sentCount > 0 && <span className="text-[10px] bg-blue-50 text-blue-600 border border-blue-200 rounded px-1.5 py-0.5">발송 {school.sentCount}</span>}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-4">
              {/* 지역별 */}
              <div className="rounded-xl border overflow-hidden">
                <div className="px-4 py-3 border-b bg-gray-50/60">
                  <h3 className="font-bold text-gray-900 text-sm">지역별</h3>
                </div>
                <div className="px-4 py-3">
                  <div className="space-y-2">
                    {regions.map((region) => (
                      <div key={region.region} className="flex items-center gap-3">
                        <span className="text-xs text-gray-600 w-8">{region.region}</span>
                        <div className="flex-1 h-4 rounded-full bg-gray-50 overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-blue-100 to-blue-200 rounded-full flex items-center justify-end pr-2 transition-all"
                            style={{ width: `${(region.teachers / maxRegionTeachers) * 100}%`, minWidth: "40px" }}>
                            <span className="text-[9px] font-medium text-blue-700">{region.teachers}</span>
                          </div>
                        </div>
                        <span className="text-[10px] text-gray-400 w-8 text-right">{region.schools}교</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Jon 확인 내역 (최근 배치) */}
              {recentBatches.length > 0 && (
                <div className="rounded-xl border overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50/60">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      <h3 className="font-bold text-gray-900 text-sm">Jon 확인 내역</h3>
                    </div>
                    <span className="text-[10px] text-gray-400">최근 {recentBatches.length}건</span>
                  </div>
                  <div className="divide-y">
                    {recentBatches.map((batch) => {
                      const when = batch.confirmedAt ? new Date(batch.confirmedAt) : null;
                      const rel = when ? Math.max(0, Math.floor((Date.now() - when.getTime()) / 60000)) : null;
                      const relText = rel === null ? "—" : rel < 1 ? "방금" : rel < 60 ? `${rel}분 전` : rel < 1440 ? `${Math.floor(rel / 60)}시간 전` : `${Math.floor(rel / 1440)}일 전`;
                      return (
                        <div key={batch.id} className="px-4 py-3">
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-gray-900">+{batch.count}명 upgraded</span>
                              <span className="text-[10px] text-gray-400">{batch.schools.length}교</span>
                            </div>
                            <span className="text-[10px] text-gray-400" title={when?.toLocaleString("ko-KR") || ""}>{relText}</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {batch.schools.slice(0, 4).map((school) => (
                              <span key={school.name} className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded px-1.5 py-0.5">
                                {school.nameEn || school.name} <span className="text-emerald-500/70">×{school.count}</span>
                              </span>
                            ))}
                            {batch.schools.length > 4 && <span className="text-[10px] text-gray-400 self-center">+{batch.schools.length - 4}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 최근 등록 */}
              <div className="rounded-xl border overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50/60">
                  <h3 className="font-bold text-gray-900 text-sm">최근 등록</h3>
                  <Link href="/admin/teachers" className="text-xs text-blue-600 hover:underline">전체 보기</Link>
                </div>
                <div className="divide-y">
                  {recentTeachers.map((teacher) => {
                    const sc: Record<string, string> = { upgraded: "bg-emerald-400", pending: "bg-amber-400", sent: "bg-blue-400", individual: "bg-purple-400" };
                    return (
                      <div key={teacher.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50/80 transition-colors">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${sc[teacher.status] || "bg-gray-300"}`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-gray-800 truncate">{teacher.name}</p>
                          <p className="text-[10px] text-gray-400 font-mono truncate">{teacher.email}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-[10px] text-gray-400 truncate max-w-[120px]">{teacher.schoolName}</p>
                          <p className="text-[10px] text-gray-300">
                            {new Date(teacher.createdAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </details>

      {/* 상태 메시지 토스트 */}
      {message && (
        <div className={`fixed bottom-20 md:bottom-4 right-4 px-4 py-2 rounded-lg text-sm font-medium shadow-lg z-50 ${message.includes("완료") ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
          {message}
        </div>
      )}
    </div>
  );
}
