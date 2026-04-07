"use client";

import { useState, useMemo, useEffect } from "react";
import { useSchoolData } from "@/lib/use-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

const statusDot: Record<string, string> = {
  pending: "bg-amber-400",
  sent: "bg-blue-400",
  upgraded: "bg-emerald-400",
  paid: "bg-purple-400",
  draft: "bg-gray-400",
  processed: "bg-blue-400",
  invoiced: "bg-indigo-400",
};

const teamColors: Record<string, string> = {
  "서울1팀": "bg-blue-600", "서울4팀": "bg-blue-500", "서울 (개별)": "bg-sky-500",
  "경기2팀": "bg-green-600", "경기3팀": "bg-green-500", "경기5팀": "bg-emerald-600",
  "경기 (개별)": "bg-lime-500", "인천 (개별)": "bg-violet-500", "대전 (개별)": "bg-orange-500",
  "대구 (개별)": "bg-red-500", "부산 (개별)": "bg-rose-500", "울산 (개별)": "bg-amber-500",
  "경남 (개별)": "bg-teal-500",
};

type ViewTab = "all" | "school" | "individual";

export default function TeachersPage() {
  const { schools, refresh: load } = useSchoolData();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterTeam, setFilterTeam] = useState("all");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<ViewTab>("all");
  const [accountRequests, setAccountRequests] = useState<AccountRequest[]>([]);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

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

  const allTeams = useMemo(() => {
    const t = new Set<string>();
    schools.forEach((s) => { if (s.team) t.add(s.team); });
    return Array.from(t).sort();
  }, [schools]);

  const filteredSchools = useMemo(() => {
    return schools
      .map((s) => {
        let teachers = s.teachers;
        if (filterStatus !== "all") teachers = teachers.filter((t) => t.status === filterStatus);
        if (search) {
          const q = search.toLowerCase();
          teachers = teachers.filter((t) => t.name.toLowerCase().includes(q) || t.email.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
        }
        return { ...s, teachers };
      })
      .filter((s) => s.teachers.length > 0)
      .filter((s) => filterTeam === "all" || s.team === filterTeam);
  }, [schools, search, filterStatus, filterTeam]);

  const schoolCount = filteredSchools.reduce((s, sc) => s + sc.teachers.length, 0);
  const indivCount = individualTeachers.length;
  const pendingAll = filteredSchools.reduce((s, sc) => s + sc.teachers.filter((t) => t.status === "pending").length, 0);
  const sentAll = filteredSchools.reduce((s, sc) => s + sc.teachers.filter((t) => t.status === "sent").length, 0);
  const upgradedAll = filteredSchools.reduce((s, sc) => s + sc.teachers.filter((t) => t.status === "upgraded").length, 0);
  const paidAll = individualTeachers.filter((t) => t.status === "paid").length;
  const needAction = pendingAll + sentAll;

  function toggleTeacher(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSchool(school: School) {
    const ids = school.teachers.map((t) => t.id);
    const all = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => {
        if (all) next.delete(id);
        else next.add(id);
      });
      return next;
    });
  }
  function selectAll() {
    const ids = filteredSchools.flatMap((s) => s.teachers.map((t) => t.id));
    setSelected(ids.every((id) => selected.has(id)) ? new Set() : new Set(ids));
  }
  function toggleCollapse(id: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function sendSelected() {
    if (selected.size === 0) return;
    setSending(true); setMessage("");
    try {
      const res = await fetch("/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teacherIds: Array.from(selected) }) });
      const data = await res.json();
      setMessage(data.success ? `✓ ${selected.size}명 발송 완료` : "실패");
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
    const csv = ["School,School(EN),Team,Type,Email,Subject,Status", ...rows].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `snorkl-${new Date().toISOString().split("T")[0]}.csv`; a.click();
  }

  return (
    <div className="space-y-3">
      {/* Compact header bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-bold text-gray-900">교사 <span className="text-gray-400 font-normal text-sm">{schoolCount + indivCount}</span></h2>
          <div className="flex items-center gap-3 text-xs">
            {needAction > 0 && <span className="bg-amber-100 text-amber-800 font-bold px-2 py-1 rounded-md">⚡ {needAction} 처리 필요</span>}
            <span className="text-gray-400">{upgradedAll} upgraded</span>
            <span className="text-gray-400">{paidAll} paid</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Tabs */}
          <div className="flex rounded-md bg-gray-100 p-0.5 text-[11px]">
            {(["all", "school", "individual"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-2.5 py-1 rounded ${tab === t ? "bg-white text-gray-900 shadow-sm font-medium" : "text-gray-500"}`}>
                {t === "all" ? `전체 ${schoolCount + indivCount}` : t === "school" ? `🏫 ${schoolCount}` : `👤 ${indivCount}`}
              </button>
            ))}
          </div>
          <div className="h-5 w-px bg-gray-200" />
          <Input placeholder="검색..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-36 h-7 text-xs" />
          <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v ?? "all")}>
            <SelectTrigger className="w-24 h-7 text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">상태</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="upgraded">Upgraded</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterTeam} onValueChange={(v) => setFilterTeam(v ?? "all")}>
            <SelectTrigger className="w-24 h-7 text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">팀</SelectItem>
              {allTeams.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={selectAll} className="text-[11px] h-7 px-2">
            {filteredSchools.flatMap((s) => s.teachers).every((t) => selected.has(t.id)) && schoolCount > 0 ? "해제" : "전체"}
          </Button>
          <Button variant="outline" size="sm" onClick={downloadCSV} className="text-[11px] h-7 px-2">CSV</Button>
        </div>
      </div>

      {/* Sticky action bar */}
      {selected.size > 0 && (
        <div className="bg-blue-600 text-white rounded-lg px-4 py-2.5 flex items-center gap-2 sticky top-14 z-10 shadow-lg text-sm">
          <b>{selected.size}</b>명
          <div className="h-4 w-px bg-blue-400" />
          <button onClick={sendSelected} disabled={sending} className="bg-white text-blue-700 px-3 py-1 rounded font-semibold text-xs hover:bg-blue-50 disabled:opacity-50">
            {sending ? "..." : "📧 Jon 발송"}
          </button>
          <button onClick={() => markStatus("upgraded")} className="bg-emerald-500 text-white px-3 py-1 rounded font-semibold text-xs hover:bg-emerald-600">
            ✅ Upgraded
          </button>
          <button onClick={() => markStatus("sent")} className="text-blue-200 hover:text-white text-xs px-2 py-1">Sent</button>
          <button onClick={() => markStatus("pending")} className="text-blue-200 hover:text-white text-xs px-2 py-1">Pending</button>
          <button onClick={() => setSelected(new Set())} className="text-blue-300 hover:text-white text-xs ml-auto">✕</button>
          {message && <span className="text-xs text-green-300">{message}</span>}
        </div>
      )}

      {/* ===== 단체구매 ===== */}
      {(tab === "all" || tab === "school") && filteredSchools.length > 0 && (
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          {tab === "all" && (
            <div className="px-3 py-1.5 bg-gray-50 border-b text-[11px] font-semibold text-gray-500">🏫 단체구매 · {schoolCount}명</div>
          )}
          {filteredSchools.map((school) => {
            const isCollapsed = collapsed.has(school.id);
            const allChecked = school.teachers.every((t) => selected.has(t.id));
            const someChecked = school.teachers.some((t) => selected.has(t.id));
            const counts = { p: 0, s: 0, u: 0 };
            school.teachers.forEach((t) => { if (t.status === "pending") counts.p++; else if (t.status === "sent") counts.s++; else counts.u++; });

            return (
              <div key={school.id} className="border-b last:border-b-0">
                {/* School row - compact */}
                <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50/60 hover:bg-gray-100/60 cursor-pointer"
                  onClick={() => toggleCollapse(school.id)}>
                  <input type="checkbox" checked={allChecked}
                    ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked; }}
                    onChange={(e) => { e.stopPropagation(); toggleSchool(school); }}
                    onClick={(e) => e.stopPropagation()} className="w-3.5 h-3.5 rounded" />
                  <svg className={`w-3 h-3 text-gray-400 transition-transform ${isCollapsed ? "" : "rotate-90"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  <span className="font-semibold text-sm text-gray-900">{school.name}</span>
                  {school.nameEn && <span className="text-[10px] text-gray-400 hidden lg:inline">{school.nameEn}</span>}
                  {school.team && <span className={`text-[9px] text-white px-1 py-0 rounded ${teamColors[school.team] || "bg-gray-400"}`}>{school.team}</span>}
                  <span className="ml-auto flex items-center gap-1.5 text-[10px]">
                    {counts.p > 0 && <span className="text-amber-600 font-bold">{counts.p}⏳</span>}
                    {counts.s > 0 && <span className="text-blue-600 font-medium">{counts.s}📧</span>}
                    <span className="text-gray-400">{school.teachers.length}</span>
                  </span>
                </div>
                {/* Teacher rows - ultra compact */}
                {!isCollapsed && (
                  <div>
                    {school.teachers.map((t) => (
                      <label key={t.id}
                        className={`flex items-center gap-2 px-3 pl-9 py-[5px] text-xs cursor-pointer hover:bg-blue-50/40 border-t border-gray-50 ${selected.has(t.id) ? "bg-blue-50/60" : ""}`}>
                        <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleTeacher(t.id)} className="w-3.5 h-3.5 rounded" />
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot[t.status] || "bg-gray-300"}`} />
                        <span className="font-mono text-gray-800 flex-1 truncate">{t.email}</span>
                        {t.subject && <span className="text-[10px] text-gray-400">{t.subject}</span>}
                        <span className={`text-[10px] ${t.status === "upgraded" ? "text-emerald-500" : t.status === "pending" ? "text-amber-600 font-bold" : t.status === "sent" ? "text-blue-500" : "text-gray-400"}`}>
                          {t.status === "upgraded" ? "✓" : t.status}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ===== 개별구매 ===== */}
      {(tab === "all" || tab === "individual") && individualBySchool.length > 0 && (
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <div className="px-3 py-1.5 bg-violet-50 border-b text-[11px] font-semibold text-violet-600">👤 개별구매 · {individualTeachers.length}명</div>
          {individualBySchool.map(([schoolName, teachers]) => (
            <div key={schoolName} className="border-b last:border-b-0">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-violet-50/30">
                <span className="font-semibold text-sm text-gray-900">{schoolName}</span>
                <span className="text-[10px] text-violet-500">{teachers.length}명</span>
              </div>
              {teachers.map((t) => (
                <div key={`${t.requestId}-${t.email}`} className="flex items-center gap-2 px-3 pl-6 py-[5px] text-xs border-t border-gray-50">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot[t.status] || "bg-gray-300"}`} />
                  <span className="font-mono text-gray-800 flex-1 truncate">{t.email}</span>
                  <span className={`text-[10px] ${t.status === "paid" ? "text-purple-500" : "text-gray-400"}`}>
                    {t.status === "paid" ? "💳 paid" : t.status}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {filteredSchools.length === 0 && individualBySchool.length === 0 && (
        <div className="text-center py-12 text-gray-400 text-sm">검색 결과 없음</div>
      )}
    </div>
  );
}
