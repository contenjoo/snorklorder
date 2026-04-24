"use client";

import { useState, useMemo, useEffect } from "react";
import { useSchoolData } from "@/lib/use-data";

interface Teacher {
  id: number;
  name: string;
  email: string;
  subject: string | null;
  status: string;
  createdAt: string;
  schoolId: number;
}

interface School {
  id: number;
  name: string;
  nameEn: string | null;
  code: string;
  region: string | null;
  team: string | null;
  teacherCount: number;
  teachers: Teacher[];
}

interface AccountRequest {
  id: number;
  type: string;
  schoolName: string;
  emails: string;
  status: string;
  notes: string | null;
  createdAt: string;
}

interface IndividualTeacher {
  email: string;
  schoolName: string;
  status: string;
  requestId: number;
}

const statusLabel: Record<string, string> = {
  pending: "대기",
  sent: "발송",
  upgraded: "확정",
  individual: "개별",
  paid: "결제",
  draft: "임시",
  processed: "처리됨",
  invoiced: "청구됨",
};

const statusDot: Record<string, string> = {
  pending: "bg-amber-400",
  sent: "bg-blue-400",
  upgraded: "bg-emerald-400",
  individual: "bg-violet-400",
  paid: "bg-violet-400",
};

const statusText: Record<string, string> = {
  pending: "text-amber-600",
  sent: "text-blue-600",
  upgraded: "text-emerald-600",
  individual: "text-violet-600",
  paid: "text-violet-600",
};

export default function TeachersPage() {
  const { schools, refresh: load } = useSchoolData();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<"school" | "individual">("school");
  const [expandedSchool, setExpandedSchool] = useState<number | null>(null);
  const [accountRequests, setAccountRequests] = useState<AccountRequest[]>([]);

  useEffect(() => {
    fetch("/api/account-requests")
      .then((r) => r.json())
      .then((data) => setAccountRequests(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const individualTeachers = useMemo(() => {
    const result: IndividualTeacher[] = [];
    for (const r of accountRequests) {
      const emails = r.emails.split(/[,;\n]+/).map((e) => e.trim()).filter((e) => e && e.includes("@"));
      for (const email of emails) {
        result.push({ email, schoolName: r.schoolName, status: r.status, requestId: r.id });
      }
    }
    return result;
  }, [accountRequests]);

  const individualBySchool = useMemo(() => {
    const grouped = new Map<string, IndividualTeacher[]>();
    let filtered = individualTeachers;
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((t) => t.email.toLowerCase().includes(q) || t.schoolName.toLowerCase().includes(q));
    }
    for (const t of filtered) {
      if (!grouped.has(t.schoolName)) grouped.set(t.schoolName, []);
      grouped.get(t.schoolName)!.push(t);
    }
    return Array.from(grouped.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [individualTeachers, search]);

  const filteredSchools = useMemo(() => {
    return schools
      .map((s) => {
        let teachers = s.teachers;
        if (filterStatus !== "all") teachers = teachers.filter((t) => t.status === filterStatus);
        if (search) {
          const q = search.toLowerCase();
          teachers = teachers.filter((t) =>
            t.name.toLowerCase().includes(q) || t.email.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
          );
        }
        return { ...s, teachers };
      })
      .filter((s) => s.teachers.length > 0)
      .sort((a, b) => b.teachers.length - a.teachers.length);
  }, [schools, search, filterStatus]);

  // Stats
  const allTeachers = schools.flatMap(s => s.teachers);
  const totalCount = allTeachers.length;
  const indivCount = individualTeachers.length;
  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {};
    allTeachers.forEach(t => { c[t.status] = (c[t.status] || 0) + 1; });
    return c;
  }, [allTeachers]);

  // Actions
  function toggleTeacher(id: number) {
    setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function toggleSchool(school: { teachers: Teacher[] }) {
    const ids = school.teachers.map(t => t.id);
    const all = ids.every(id => selected.has(id));
    setSelected(prev => {
      const next = new Set(prev);
      ids.forEach(id => { if (all) next.delete(id); else next.add(id); });
      return next;
    });
  }
  async function sendSelected() {
    if (selected.size === 0) return;
    setSending(true); setMessage("");
    try {
      const res = await fetch("/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teacherIds: Array.from(selected) }) });
      const data = await res.json();
      setMessage(data.success ? `${selected.size}명 발송 완료` : "발송 실패");
      if (data.success) { setSelected(new Set()); load(); }
    } catch { setMessage("오류"); } finally { setSending(false); }
  }
  async function markStatus(status: string) {
    if (selected.size === 0) return;
    await fetch("/api/teachers", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(selected), status }) });
    setSelected(new Set()); load();
  }
  function downloadCSV() {
    const rows: string[] = [];
    for (const s of filteredSchools) for (const t of s.teachers) rows.push([s.name, s.nameEn || "", s.team || "", "단체", t.email, t.subject || "", t.status].join(","));
    for (const t of individualTeachers) rows.push([t.schoolName, "", "", "개별", t.email, "", t.status].join(","));
    const csv = ["학교,영문명,팀,유형,이메일,과목,상태", ...rows].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `snorkl-교사-${new Date().toISOString().split("T")[0]}.csv`; a.click();
  }

  return (
    <div className="space-y-4 pb-20 md:pb-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-4 flex-wrap">
          <h1 className="text-lg font-bold text-gray-900 whitespace-nowrap">교사 관리</h1>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span><strong className="text-gray-900 text-sm">{totalCount + indivCount}</strong> 명</span>
            <span className="text-gray-200">|</span>
            <span className="text-emerald-600 font-medium">{statusCounts.upgraded || 0} 확정</span>
            {(statusCounts.pending || 0) > 0 && (
              <>
                <span className="text-gray-200">|</span>
                <span className="text-amber-600 font-medium">{statusCounts.pending} 대기</span>
              </>
            )}
            {indivCount > 0 && (
              <>
                <span className="text-gray-200">|</span>
                <span className="text-violet-600 font-medium">{indivCount} 개별</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          <button onClick={downloadCSV} className="text-xs text-gray-400 hover:text-gray-700 px-2 py-1.5 rounded-lg border hover:bg-gray-50 transition-colors whitespace-nowrap">
            CSV
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex items-center gap-2">
          {/* Tab */}
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5 shrink-0">
            <button onClick={() => setTab("school")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${tab === "school" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}>
              단체 {totalCount}
            </button>
            <button onClick={() => setTab("individual")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${tab === "individual" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}>
              개별 {indivCount}
            </button>
          </div>

          {/* Status filter */}
          <div className="flex items-center gap-0.5 overflow-x-auto shrink-0">
            {[["all", "전체"], ["pending", "대기"], ["upgraded", "확정"], ["sent", "발송"], ["individual", "개별"]].map(([val, label]) => (
              <button key={val} onClick={() => setFilterStatus(val)}
                className={`px-2 py-1 rounded-md text-xs font-medium transition-all whitespace-nowrap ${filterStatus === val ? "bg-gray-900 text-white" : "text-gray-400 hover:text-gray-700"}`}>
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1 hidden sm:block" />
        </div>

        {/* Search - full width on mobile, inline on desktop */}
        <div className="relative w-full sm:w-auto sm:shrink-0">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input placeholder="이름, 이메일, 학교 검색"
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-52 pl-8 pr-3 py-1.5 text-xs border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 transition-all" />
        </div>
      </div>

      {/* Selection bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 bg-blue-600 text-white rounded-xl sticky top-16 z-10 shadow-lg flex-wrap">
          <span className="font-bold">{selected.size}</span>
          <span className="text-blue-200 text-xs">명 선택</span>
          <div className="h-4 w-px bg-blue-400 hidden sm:block" />
          <button onClick={sendSelected} disabled={sending}
            className="bg-white text-blue-700 px-2.5 py-1 rounded-lg text-xs font-semibold hover:bg-blue-50 disabled:opacity-50 transition-colors">
            {sending ? "발송중..." : "Jon 발송"}
          </button>
          <button onClick={() => markStatus("upgraded")}
            className="bg-emerald-500 text-white px-2.5 py-1 rounded-lg text-xs font-semibold hover:bg-emerald-600 transition-colors">
            확정 처리
          </button>
          <button onClick={() => markStatus("sent")} className="text-blue-200 hover:text-white text-xs px-1.5 py-1 hidden sm:inline">발송 처리</button>
          <button onClick={() => markStatus("pending")} className="text-blue-200 hover:text-white text-xs px-1.5 py-1 hidden sm:inline">대기 처리</button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-blue-200 hover:text-white text-xs">취소</button>
          {message && <span className="text-xs text-green-300 w-full sm:w-auto">{message}</span>}
        </div>
      )}

      {/* School teachers (grouped) */}
      {tab === "school" && (
        <div className="space-y-2">
          {filteredSchools.map((school) => {
            const allChecked = school.teachers.every(t => selected.has(t.id));
            const someChecked = school.teachers.some(t => selected.has(t.id));
            const pendingC = school.teachers.filter(t => t.status === "pending" || t.status === "sent").length;
            const conf = school.teachers.filter(t => t.status === "upgraded" || t.status === "individual").length;
            const isOpen = expandedSchool === school.id;

            return (
              <div key={school.id} className={`bg-white rounded-xl border overflow-hidden transition-all ${isOpen ? "ring-1 ring-blue-200" : ""}`}>
                {/* School header */}
                <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 cursor-pointer hover:bg-gray-50/80 transition-colors"
                  onClick={() => setExpandedSchool(isOpen ? null : school.id)}>
                  <input type="checkbox" checked={allChecked}
                    ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked; }}
                    onChange={(e) => { e.stopPropagation(); toggleSchool(school); }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-3.5 h-3.5 rounded shrink-0" />

                  <div className={`w-2 h-2 rounded-full shrink-0 ${pendingC > 0 ? "bg-amber-400" : "bg-emerald-400"}`} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-900 truncate max-w-[140px] sm:max-w-none">{school.name}</span>
                      {school.nameEn && <span className="text-xs text-gray-400 hidden sm:inline truncate">{school.nameEn}</span>}
                      {school.team && !school.team.includes("개별") && (
                        <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded whitespace-nowrap">{school.team}</span>
                      )}
                      {pendingC > 0 && (
                        <span className="text-[10px] font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded whitespace-nowrap">{pendingC}대기</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {school.teachers.length > 0 && (
                      <div className="w-10 h-1 rounded-full bg-gray-100 overflow-hidden hidden sm:block">
                        {conf > 0 && <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${(conf / school.teachers.length) * 100}%` }} />}
                      </div>
                    )}
                    <span className="text-sm font-semibold text-gray-700 tabular-nums">{school.teachers.length}</span>
                  </div>

                  <svg className={`w-4 h-4 text-gray-300 transition-transform shrink-0 ${isOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>

                {/* Teacher rows */}
                {isOpen && (
                  <div className="border-t divide-y divide-gray-50">
                    {school.teachers.map((t) => (
                      <label key={t.id}
                        className={`flex items-center gap-2 sm:gap-3 px-3 sm:px-4 pl-6 sm:pl-8 py-2 cursor-pointer transition-colors ${selected.has(t.id) ? "bg-blue-50/60" : "hover:bg-gray-50/60"}`}>
                        <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleTeacher(t.id)} className="w-3 h-3 rounded shrink-0" />
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot[t.status] || "bg-gray-300"}`} />
                        <span className="text-xs text-gray-600 w-12 sm:w-16 truncate shrink-0">{t.name}</span>
                        <span className="text-xs text-gray-500 font-mono truncate flex-1 min-w-0">{t.email}</span>
                        {t.subject && <span className="text-[10px] text-gray-300 hidden sm:inline shrink-0">{t.subject}</span>}
                        <span className={`text-[10px] font-semibold shrink-0 ${statusText[t.status] || "text-gray-400"}`}>
                          {statusLabel[t.status] || t.status}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {filteredSchools.length === 0 && (
            <div className="text-center py-16">
              <p className="text-gray-400 text-sm">검색 결과 없음</p>
              {search && <p className="text-gray-300 text-xs mt-1">다른 검색어를 시도해보세요</p>}
            </div>
          )}
        </div>
      )}

      {/* Individual teachers */}
      {tab === "individual" && (
        <div className="space-y-2">
          {individualBySchool.length > 0 ? (
            individualBySchool.map(([schoolName, teachers]) => (
              <div key={schoolName} className="bg-white rounded-xl border overflow-hidden">
                <div className="flex items-center gap-2 px-3 sm:px-4 py-2.5 bg-violet-50/40">
                  <span className="w-2 h-2 rounded-full bg-violet-400 shrink-0" />
                  <span className="text-sm font-medium text-gray-900 truncate">{schoolName}</span>
                  <span className="text-xs text-violet-500 font-medium shrink-0">{teachers.length}명</span>
                </div>
                <div className="divide-y divide-gray-50">
                  {teachers.map((t) => (
                    <div key={`${t.requestId}-${t.email}`}
                      className="flex items-center gap-2 px-3 sm:px-4 pl-6 sm:pl-8 py-2 text-xs">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot[t.status] || "bg-gray-300"}`} />
                      <span className="font-mono text-gray-600 truncate flex-1 min-w-0">{t.email}</span>
                      <span className={`font-medium shrink-0 ${statusText[t.status] || "text-gray-400"}`}>
                        {statusLabel[t.status] || t.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-16">
              <p className="text-gray-400 text-sm">개별 구매 교사 없음</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
