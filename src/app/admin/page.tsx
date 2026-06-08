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

function parseAmount(s?: string | null): number {
  if (!s) return 0;
  const n = Number(String(s).replace(/[^\d.]/g, ""));
  return isNaN(n) ? 0 : n;
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

interface HqQueueTeacher {
  id: number;
  schoolId: number;
  name: string;
  email: string;
  subject: string | null;
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
  teamGroups: TeamGroup[];
  hqVerificationQueue: HqQueueTeacher[];
  upgradeNeeded: Array<SchoolSummary & { needTeachers: DashboardTeacher[] }>;
  recentTeachers: DashboardTeacher[];
  recentBatches: RecentBatch[];
  recentFailedEmails: FailedEmail[];
  openAccountRequests: OpenAccountRequest[];
  openDomainRequests: OpenDomainRequest[];
  regions: RegionSummary[];
}

const teamColorMap = TEAM_COLORS;

export default function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

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

  const { stats, teamGroups, hqVerificationQueue, upgradeNeeded, recentTeachers, recentBatches, recentFailedEmails, openAccountRequests, openDomainRequests, regions } = data;

  // Billing pipeline 분류 (account + domain 통합)
  type BillingItem = { id: string; source: "account" | "domain"; rawId: number; schoolName: string; schoolNameEn: string | null; team: string | null; amount: number; amountText: string; paymentLink: string | null; invoiceNumber: string | null; invoiceDueDate: string | null; status: string; bucket: "JON_PROCESS" | "JON_INVOICE" | "ME_PAY" | "JON_CONFIRM"; updatedAt: string; ageDays: number };
  const items: BillingItem[] = [];
  for (const r of (openAccountRequests || [])) {
    items.push({
      id: `a-${r.id}`, source: "account", rawId: r.id, schoolName: r.schoolName, schoolNameEn: r.schoolNameEn, team: null,
      amount: parseAmount(r.invoiceAmount), amountText: r.invoiceAmount || "",
      paymentLink: r.paymentLink, invoiceNumber: r.invoiceNumber, invoiceDueDate: r.invoiceDueDate,
      status: r.status, bucket: classifyAccount(r),
      updatedAt: r.updatedAt, ageDays: daysSince(r.updatedAt) ?? 0,
    });
  }
  for (const r of (openDomainRequests || [])) {
    items.push({
      id: `d-${r.id}`, source: "domain", rawId: r.id, schoolName: r.schoolName, schoolNameEn: r.schoolNameEn, team: r.team,
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
  const outstanding = buckets.ME_PAY.reduce((s, i) => s + i.amount, 0);
  const needUpgrade = stats.pending + stats.sent;
  const upgradeRate = stats.totalTeachers > 0 ? Math.round((stats.confirmed / stats.totalTeachers) * 100) : 0;
  const maxRegionTeachers = Math.max(1, ...regions.map((region) => region.teachers));

  const allPendingIds = upgradeNeeded.flatMap((school) =>
    school.needTeachers.filter((teacher) => teacher.status === "pending").map((teacher) => teacher.id)
  );
  const targetIds = selectedIds.size > 0
    ? allPendingIds.filter((id) => selectedIds.has(id))
    : allPendingIds;

  async function reviewHqTeacher(ids: number[], action: "approve" | "reject") {
    let reason: string | undefined;
    if (action === "reject") { const r = prompt("거절 사유 (선택)"); reason = r || undefined; }
    const res = await fetch("/api/admin/verify-teacher", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, action, reason }) });
    if (res.ok) { await load(); } else { const d = await res.json().catch(() => ({})); setMessage(d.error || "처리 실패"); }
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

  return (
    <div className="space-y-6 pb-20 md:pb-0">
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
      {items.length > 0 && (
        <div className="bg-white rounded-2xl border p-4 md:p-5 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <span className="text-lg">💳</span>
              <h2 className="font-bold text-gray-900">Billing Action Center</h2>
            </div>
            <Link href="/admin/accounts" className="text-xs text-blue-600 hover:underline">정산 전체 →</Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className={`rounded-xl border p-3 ${buckets.JON_PROCESS.length ? "bg-amber-50 border-amber-200" : "bg-gray-50 border-gray-100"}`}>
              <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Jon 처리대기</div>
              <div className="text-xl font-bold text-gray-900 mt-0.5">{buckets.JON_PROCESS.length}</div>
              <div className="text-[10px] text-gray-500 mt-0.5">draft + sent</div>
            </div>
            <div className={`rounded-xl border p-3 ${buckets.JON_INVOICE.length ? "bg-orange-50 border-orange-200" : "bg-gray-50 border-gray-100"}`}>
              <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Jon 인보이스 대기</div>
              <div className="text-xl font-bold text-gray-900 mt-0.5">{buckets.JON_INVOICE.length}</div>
              <div className="text-[10px] text-gray-500 mt-0.5">처리완료 · 미발급</div>
            </div>
            <div className={`rounded-xl border p-3 ${buckets.ME_PAY.length ? "bg-red-50 border-red-200" : "bg-gray-50 border-gray-100"}`}>
              <div className="text-[10px] font-bold text-red-700 uppercase tracking-wider">내 차례 · 결제</div>
              <div className="text-xl font-bold text-red-700 mt-0.5">{buckets.ME_PAY.length}</div>
              <div className="text-[10px] text-red-600 mt-0.5">미수금 {outstanding > 0 ? `~${outstanding.toLocaleString()}` : "—"}</div>
            </div>
            <div className={`rounded-xl border p-3 ${buckets.JON_CONFIRM.length ? "bg-blue-50 border-blue-200" : "bg-gray-50 border-gray-100"}`}>
              <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Jon 확인 대기</div>
              <div className="text-xl font-bold text-gray-900 mt-0.5">{buckets.JON_CONFIRM.length}</div>
              <div className="text-[10px] text-gray-500 mt-0.5">paid · 미확인</div>
            </div>
          </div>
          {buckets.ME_PAY.length > 0 && (
            <div className="rounded-xl bg-red-50/50 border border-red-100 p-3 space-y-1.5">
              <div className="text-[11px] font-bold text-red-900">⚡ 내가 결제할 것</div>
              {buckets.ME_PAY.sort((a, b) => b.ageDays - a.ageDays).slice(0, 5).map((i) => (
                <div key={i.id} className="flex items-center gap-2 text-xs bg-white rounded px-2 py-1.5 border border-red-100">
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium shrink-0">{i.source === "domain" ? "🌐 도메인" : "📚 정산"}</span>
                  <span className="text-gray-700 truncate flex-1">{i.schoolNameEn || i.schoolName}</span>
                  {i.amountText && <span className="font-mono text-gray-900 shrink-0">{i.amountText}</span>}
                  <span className={`text-[10px] shrink-0 ${i.ageDays >= 7 ? "text-red-600 font-bold" : i.ageDays >= 3 ? "text-orange-600" : "text-gray-500"}`}>{i.ageDays}d</span>
                  {i.paymentLink && <a href={i.paymentLink} target="_blank" rel="noopener noreferrer" className="text-[10px] bg-red-600 text-white rounded px-2 py-0.5 font-bold shrink-0 hover:bg-red-700">💳 결제</a>}
                </div>
              ))}
            </div>
          )}
          {(buckets.JON_PROCESS.some((i) => i.ageDays >= 3) || buckets.JON_INVOICE.some((i) => i.ageDays >= 5)) && (
            <div className="rounded-xl bg-amber-50/50 border border-amber-100 p-3 space-y-1.5">
              <div className="text-[11px] font-bold text-amber-900">⏰ Jon 차례 · 오래된 건</div>
              {[...buckets.JON_PROCESS, ...buckets.JON_INVOICE].filter((i) => (i.bucket === "JON_PROCESS" ? i.ageDays >= 3 : i.ageDays >= 5)).sort((a, b) => b.ageDays - a.ageDays).slice(0, 5).map((i) => (
                <div key={i.id} className="flex items-center gap-2 text-xs bg-white rounded px-2 py-1.5 border border-amber-100">
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium shrink-0">{i.source === "domain" ? "🌐" : "📚"}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium shrink-0">{i.bucket === "JON_PROCESS" ? "처리대기" : "인보이스대기"}</span>
                  <span className="text-gray-700 truncate flex-1">{i.schoolNameEn || i.schoolName}</span>
                  <span className={`text-[10px] shrink-0 ${i.ageDays >= 7 ? "text-red-600 font-bold" : "text-orange-600"}`}>{i.ageDays}d</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:flex md:items-center md:gap-6 bg-white rounded-2xl border p-4 md:p-5">
        <div className="flex items-center gap-3 md:pr-6 md:border-r">
          <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.26 10.147a60.438 60.438 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342" /></svg>
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{stats.totalSchools}</p>
            <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">학교</p>
          </div>
        </div>
        <div className="flex items-center gap-3 md:pr-6 md:border-r">
          <div className="w-10 h-10 rounded-xl bg-indigo-500 flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{stats.totalTeachers}</p>
            <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">교사</p>
          </div>
        </div>
        <div className="flex items-center gap-3 md:pr-6 md:border-r">
          <div className="relative w-12 h-12">
            <svg className="w-12 h-12 -rotate-90" viewBox="0 0 36 36">
              <path d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#e5e7eb" strokeWidth="3" />
              <path d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#10b981" strokeWidth="3" strokeDasharray={`${upgradeRate}, 100`} strokeLinecap="round" />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-gray-900">{upgradeRate}%</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">확정률</p>
            <p className="text-[10px] text-gray-400">{stats.confirmed} / {stats.totalTeachers}</p>
          </div>
        </div>
        {needUpgrade > 0 ? (
          <div className="col-span-2 md:col-span-1 flex items-center gap-3 bg-amber-50 rounded-xl px-4 py-2.5 border border-amber-200">
            <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
              <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" /></svg>
            </div>
            <div>
              <p className="text-sm font-bold text-amber-900">{needUpgrade}명 처리 필요</p>
              <p className="text-[10px] text-amber-700">{stats.pending} 대기 · {stats.sent} 발송됨</p>
            </div>
          </div>
        ) : (
          <div className="col-span-2 md:col-span-1 flex items-center gap-3 bg-emerald-50 rounded-xl px-4 py-2.5 border border-emerald-200">
            <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span className="text-sm font-semibold text-emerald-700">전원 확정 완료</span>
          </div>
        )}
        <div className="col-span-2 md:col-span-1 md:ml-auto flex gap-2">
          <Link href="/admin/schools" className="text-xs text-gray-500 hover:text-gray-900 border rounded-lg px-3 py-2 hover:bg-gray-50 transition-colors">학교 관리</Link>
          <Link href="/admin/teachers" className="text-xs text-gray-500 hover:text-gray-900 border rounded-lg px-3 py-2 hover:bg-gray-50 transition-colors">교사 관리</Link>
        </div>
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-4">
          <div className="bg-white rounded-2xl border overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div className="flex items-center gap-3">
                <h2 className="font-bold text-gray-900">공동구매팀</h2>
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
                      className="w-full flex flex-wrap md:flex-nowrap items-center gap-2 md:gap-4 px-4 md:px-5 py-3 md:py-3.5 text-left hover:bg-gray-50/80 transition-colors"
                      onClick={() => setExpandedTeam(isOpen ? null : group.team)}
                    >
                      <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${tc.dot}`} />
                      <span className="font-semibold text-sm text-gray-900 w-20 shrink-0">{group.team}</span>
                      <div className="hidden md:flex items-center gap-1.5 flex-1 flex-wrap overflow-hidden">
                        {group.schools.slice(0, 5).map((school) => (
                          <span key={school.id} className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded truncate max-w-[100px]">{school.name}</span>
                        ))}
                        {group.schools.length > 5 && <span className="text-[10px] text-gray-400">+{group.schools.length - 5}</span>}
                      </div>
                      <span className="text-[10px] text-gray-400 md:hidden">{group.schoolCount}교</span>
                      <div className="ml-auto flex items-center gap-2">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${rate === 100 ? "text-emerald-600 bg-emerald-50 border-emerald-200" : "text-amber-600 bg-amber-50 border-amber-200"}`}>{rate === 100 ? "완성" : `${rate}%`}</span>
                        <svg className={`w-4 h-4 text-gray-300 transition-transform shrink-0 ${isOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                      <div className="flex md:hidden items-center gap-2 w-full pl-[22px]">
                        <span className="text-xs font-mono text-gray-500">{group.confirmedCount}/{group.teacherCount}</span>
                        <div className="h-1.5 flex-1 rounded-full bg-gray-100 overflow-hidden">
                          <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${rate}%` }} />
                        </div>
                      </div>
                      <span className="hidden md:inline text-xs font-mono text-gray-500">{group.confirmedCount}/{group.teacherCount}</span>
                      <div className="hidden md:block h-1.5 w-16 rounded-full bg-gray-100 overflow-hidden">
                        <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${rate}%` }} />
                      </div>
                    </button>
                    {isOpen && (
                      <div className="bg-gray-50/60 border-t px-5 py-2 divide-y divide-gray-100">
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

          <div className="bg-white rounded-2xl border overflow-hidden">
            <div className="px-4 md:px-5 py-3 md:py-4 border-b">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="font-bold text-gray-900">본사 승인 대기 / HQ approval queue</h2>
                <span className="text-xs font-medium text-purple-700 bg-purple-50 px-2.5 py-1 rounded-full border border-purple-200">{hqVerificationQueue.length}</span>
              </div>
              <p className="text-[11px] text-gray-400 mt-1">학교 관리자가 없거나 기한 내 미처리되어 본사로 이관된 등록입니다.</p>
            </div>
            {hqVerificationQueue.length === 0 ? (
              <div className="px-5 py-6 text-sm text-gray-400 text-center">이관된 항목이 없습니다.</div>
            ) : (
              <div className="divide-y max-h-[400px] overflow-y-auto">
                {hqVerificationQueue.map((teacher) => {
                  const tc = teamColorMap[teacher.schoolTeam || ""] || { bg: "bg-gray-50", text: "text-gray-600", dot: "bg-gray-400", border: "border-gray-200" };
                  return (
                    <div key={teacher.id} className="flex flex-col sm:flex-row sm:items-center gap-2 px-4 md:px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                          <span className="text-sm font-bold text-gray-900 truncate">{teacher.email}</span>
                          {teacher.schoolTeam && <span className={`text-[10px] px-2 py-0.5 rounded-full ${tc.bg} ${tc.text} border ${tc.border}`}>{teacher.schoolTeam}</span>}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          <span className="text-[11px] text-gray-500 truncate">{teacher.schoolNameEn ? `${teacher.schoolNameEn} (${teacher.schoolName})` : teacher.schoolName}</span>
                          {teacher.escalatedAt && <span className="text-[10px] text-gray-400">· 이관일 {new Date(teacher.escalatedAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => reviewHqTeacher([teacher.id], "approve")}
                          className="text-xs font-semibold bg-emerald-600 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-700 transition-colors"
                        >
                          승인
                        </button>
                        <button
                          type="button"
                          onClick={() => reviewHqTeacher([teacher.id], "reject")}
                          className="text-xs font-semibold bg-red-50 text-red-700 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-100 transition-colors"
                        >
                          거절
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {needUpgrade > 0 && (
            <div className="bg-white rounded-2xl border overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 md:px-5 py-3 md:py-4 border-b">
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="font-bold text-gray-900">업그레이드 대기</h2>
                  <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200">{needUpgrade}명</span>
                  {stats.pending > 0 && (() => {
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
                {stats.pending > 0 && (
                  <button onClick={sendSelected} disabled={sending || targetIds.length === 0}
                    className="text-xs font-semibold bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors w-full sm:w-auto">
                    {sending ? "발송 중..." : selectedIds.size > 0 ? `선택한 ${targetIds.length}명 Jon에게 발송` : `전체 ${stats.pending}명 Jon에게 발송`}
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
              {message && (
                <div className={`px-5 py-2.5 text-sm font-medium border-t ${message.includes("완료") ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                  {message}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-xl border p-4">
              <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">공동구매</p>
              <p className="text-xl font-bold text-gray-900 mt-1">{teamGroups.reduce((sum, group) => sum + group.teacherCount, 0)}</p>
              <p className="text-[10px] text-gray-400 mt-1">{teamGroups.length}팀 · {teamGroups.reduce((sum, group) => sum + group.schoolCount, 0)}교</p>
            </div>
            <div className="bg-white rounded-xl border p-4">
              <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">개별구매</p>
              <p className="text-xl font-bold text-gray-900 mt-1">{stats.individual}</p>
              <p className="text-[10px] text-gray-400 mt-1">개별 계정 구매</p>
            </div>
          </div>

          {recentBatches.length > 0 && (
            <div className="bg-white rounded-2xl border overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <h2 className="font-bold text-gray-900">Jon 확인 내역</h2>
                </div>
                <span className="text-[10px] text-gray-400">최근 {recentBatches.length}건</span>
              </div>
              <div className="divide-y">
                {recentBatches.map((batch) => {
                  const when = batch.confirmedAt ? new Date(batch.confirmedAt) : null;
                  const rel = when ? Math.max(0, Math.floor((Date.now() - when.getTime()) / 60000)) : null;
                  const relText = rel === null ? "—" : rel < 1 ? "방금" : rel < 60 ? `${rel}분 전` : rel < 1440 ? `${Math.floor(rel / 60)}시간 전` : `${Math.floor(rel / 1440)}일 전`;
                  return (
                    <div key={batch.id} className="px-4 md:px-5 py-3">
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

          <div className="bg-white rounded-2xl border overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h2 className="font-bold text-gray-900">최근 등록</h2>
              <Link href="/admin/teachers" className="text-xs text-blue-600 hover:underline">전체 보기</Link>
            </div>
            <div className="divide-y">
              {recentTeachers.map((teacher) => {
                const sc: Record<string, string> = { upgraded: "bg-emerald-400", pending: "bg-amber-400", sent: "bg-blue-400", individual: "bg-purple-400" };
                return (
                  <div key={teacher.id} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 px-4 md:px-5 py-3 hover:bg-gray-50/80 transition-colors">
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${sc[teacher.status] || "bg-gray-300"}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-gray-800 truncate">{teacher.name}</p>
                        <p className="text-[10px] text-gray-400 font-mono truncate">{teacher.email}</p>
                      </div>
                      <span className="sm:hidden text-[10px] text-gray-300 shrink-0">
                        {new Date(teacher.createdAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between pl-4 sm:pl-0 sm:block sm:text-right shrink-0">
                      <p className="text-[10px] text-gray-400 truncate max-w-[160px] sm:max-w-[120px]">{teacher.schoolName}</p>
                      <p className="hidden sm:block text-[10px] text-gray-300">
                        {new Date(teacher.createdAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white rounded-2xl border overflow-hidden">
            <div className="px-5 py-4 border-b">
              <h2 className="font-bold text-gray-900">지역별</h2>
            </div>
            <div className="px-5 py-3">
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
        </div>
      </div>
    </div>
  );
}
