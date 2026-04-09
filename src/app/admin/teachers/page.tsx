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

const statusConfig: Record<string, { color: string; bg: string; label: string }> = {
  pending: { color: "text-amber-700", bg: "bg-amber-50", label: "Pending" },
  sent: { color: "text-blue-700", bg: "bg-blue-50", label: "Sent" },
  upgraded: { color: "text-emerald-700", bg: "bg-emerald-50", label: "Upgraded" },
  individual: { color: "text-purple-700", bg: "bg-purple-50", label: "Individual" },
  paid: { color: "text-purple-700", bg: "bg-purple-50", label: "Paid" },
  draft: { color: "text-gray-500", bg: "bg-gray-50", label: "Draft" },
  processed: { color: "text-blue-700", bg: "bg-blue-50", label: "Processed" },
  invoiced: { color: "text-indigo-700", bg: "bg-indigo-50", label: "Invoiced" },
};

const teamColorMap: Record<string, { bg: string; text: string }> = {
  "서울1팀": { bg: "bg-blue-50", text: "text-blue-700" },
  "서울4팀": { bg: "bg-blue-50", text: "text-blue-600" },
  "서울 (개별)": { bg: "bg-sky-50", text: "text-sky-700" },
  "경기2팀": { bg: "bg-emerald-50", text: "text-emerald-700" },
  "경기3팀": { bg: "bg-green-50", text: "text-green-700" },
  "경기5팀": { bg: "bg-teal-50", text: "text-teal-700" },
  "경기 (개별)": { bg: "bg-lime-50", text: "text-lime-700" },
  "인천 (개별)": { bg: "bg-violet-50", text: "text-violet-700" },
  "대전 (개별)": { bg: "bg-orange-50", text: "text-orange-700" },
  "대구 (개별)": { bg: "bg-red-50", text: "text-red-700" },
  "부산 (개별)": { bg: "bg-rose-50", text: "text-rose-700" },
  "울산 (개별)": { bg: "bg-amber-50", text: "text-amber-700" },
  "경남 (개별)": { bg: "bg-teal-50", text: "text-teal-700" },
};

type ViewTab = "all" | "school" | "individual";
type SortBy = "school" | "email" | "recent" | "status";

export default function TeachersPage() {
  const { schools, refresh: load } = useSchoolData();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterTeam, setFilterTeam] = useState("all");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<ViewTab>("all");
  const [sortBy, setSortBy] = useState<SortBy>("school");
  const [accountRequests, setAccountRequests] = useState<AccountRequest[]>([]);
  const [viewMode, setViewMode] = useState<"grouped" | "flat">("grouped");

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
    let result = schools
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

    if (sortBy === "school") result.sort((a, b) => (a.nameEn || a.name).localeCompare(b.nameEn || b.name));
    else if (sortBy === "recent") result.sort((a, b) => {
      const aMax = Math.max(...a.teachers.map(t => new Date(t.createdAt).getTime()), 0);
      const bMax = Math.max(...b.teachers.map(t => new Date(t.createdAt).getTime()), 0);
      return bMax - aMax;
    });
    else if (sortBy === "status") result.sort((a, b) => {
      const aPending = a.teachers.filter(t => t.status === "pending").length;
      const bPending = b.teachers.filter(t => t.status === "pending").length;
      return bPending - aPending;
    });

    return result;
  }, [schools, search, filterStatus, filterTeam, sortBy]);

  // Flat view: all teachers in a single list
  const flatTeachers = useMemo(() => {
    const list = filteredSchools.flatMap(s => s.teachers.map(t => ({ ...t, school: s })));
    if (sortBy === "email") list.sort((a, b) => a.email.localeCompare(b.email));
    else if (sortBy === "recent") list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    else if (sortBy === "status") {
      const order: Record<string, number> = { pending: 0, sent: 1, individual: 2, upgraded: 3 };
      list.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
    }
    return list;
  }, [filteredSchools, sortBy]);

  const schoolCount = filteredSchools.reduce((s, sc) => s + sc.teachers.length, 0);
  const indivCount = individualTeachers.length;
  const pendingAll = filteredSchools.reduce((s, sc) => s + sc.teachers.filter((t) => t.status === "pending").length, 0);
  const upgradedAll = filteredSchools.reduce((s, sc) => s + sc.teachers.filter((t) => t.status === "upgraded" || t.status === "individual").length, 0);

  // Status quick-filter chips
  const statusBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of schools) for (const t of s.teachers) counts[t.status] = (counts[t.status] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [schools]);

  function toggleTeacher(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleSchool(school: School) {
    const ids = school.teachers.map((t) => t.id);
    const all = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => { if (all) next.delete(id); else next.add(id); });
      return next;
    });
  }
  function selectAll() {
    const ids = filteredSchools.flatMap((s) => s.teachers.map((t) => t.id));
    setSelected(ids.every((id) => selected.has(id)) ? new Set() : new Set(ids));
  }

  async function sendSelected() {
    if (selected.size === 0) return;
    setSending(true); setMessage("");
    try {
      const res = await fetch("/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teacherIds: Array.from(selected) }) });
      const data = await res.json();
      setMessage(data.success ? `${selected.size} teachers sent` : "Failed");
      if (data.success) { setSelected(new Set()); load(); }
    } catch { setMessage("Error"); } finally { setSending(false); }
  }
  async function markStatus(status: string) {
    if (selected.size === 0) return;
    await fetch("/api/teachers", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(selected), status }) });
    setSelected(new Set()); load();
  }
  function downloadCSV() {
    const rows: string[] = [];
    for (const s of filteredSchools) for (const t of s.teachers) rows.push([s.name, s.nameEn || "", s.team || "", "School", t.email, t.subject || "", t.status].join(","));
    for (const t of individualTeachers) rows.push([t.schoolName, "", "", "Individual", t.email, "", t.status].join(","));
    const csv = ["School,School(EN),Team,Type,Email,Subject,Status", ...rows].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `snorkl-teachers-${new Date().toISOString().split("T")[0]}.csv`; a.click();
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Teachers</h1>
          <div className="flex items-center gap-3 mt-1.5">
            <span className="text-sm text-gray-500"><b className="text-gray-900">{schoolCount + indivCount}</b> total</span>
            <span className="w-1 h-1 rounded-full bg-gray-300" />
            {statusBreakdown.map(([status, count]) => (
              <button key={status} onClick={() => setFilterStatus(filterStatus === status ? "all" : status)}
                className={`text-xs px-2 py-0.5 rounded-full transition-all ${
                  filterStatus === status ? "bg-gray-900 text-white" : `${statusConfig[status]?.bg || "bg-gray-100"} ${statusConfig[status]?.color || "text-gray-600"} hover:opacity-80`
                }`}>
                {statusConfig[status]?.label || status} {count}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={downloadCSV} className="text-xs text-gray-500 hover:text-gray-900 px-3 py-2 rounded-lg border hover:bg-gray-50 transition-colors">
            <svg className="w-4 h-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            Export CSV
          </button>
          <button onClick={selectAll}
            className="text-xs text-gray-500 hover:text-gray-900 px-3 py-2 rounded-lg border hover:bg-gray-50 transition-colors">
            {filteredSchools.flatMap((s) => s.teachers).every((t) => selected.has(t.id)) && schoolCount > 0 ? "Deselect All" : "Select All"}
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Tab switcher */}
        <div className="flex items-center rounded-lg border bg-white p-0.5 gap-0.5">
          {([["all", `All ${schoolCount + indivCount}`], ["school", `School ${schoolCount}`], ["individual", `Individual ${indivCount}`]] as const).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t as ViewTab)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${tab === t ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-900"}`}>
              {label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
          <input placeholder="Search by name, email, or school..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 transition-all" />
        </div>

        {/* Team filter */}
        <select value={filterTeam} onChange={(e) => setFilterTeam(e.target.value)}
          className="text-xs border rounded-lg px-3 py-2 bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-200">
          <option value="all">All Teams</option>
          {allTeams.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>

        {/* Sort */}
        <div className="flex items-center rounded-lg border bg-white p-0.5 gap-0.5 ml-auto">
          {(["school", "email", "status", "recent"] as const).map(s => (
            <button key={s} onClick={() => setSortBy(s)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${sortBy === s ? "bg-gray-100 text-gray-900" : "text-gray-400 hover:text-gray-700"}`}>
              {s === "school" ? "By School" : s === "email" ? "A-Z" : s === "status" ? "Status" : "Recent"}
            </button>
          ))}
        </div>

        {/* View toggle */}
        <div className="flex items-center rounded-lg border bg-white p-0.5 gap-0.5">
          <button onClick={() => setViewMode("grouped")} className={`p-1.5 rounded-md transition-all ${viewMode === "grouped" ? "bg-gray-100" : "hover:bg-gray-50"}`}>
            <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM2.25 16.5c0-.621.504-1.125 1.125-1.125h6c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-2.25z" /></svg>
          </button>
          <button onClick={() => setViewMode("flat")} className={`p-1.5 rounded-md transition-all ${viewMode === "flat" ? "bg-gray-100" : "hover:bg-gray-50"}`}>
            <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" /></svg>
          </button>
        </div>
      </div>

      {/* Selection action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-blue-600 text-white rounded-xl sticky top-16 z-10 shadow-lg">
          <span className="font-bold">{selected.size}</span>
          <span className="text-blue-200 text-sm">selected</span>
          <div className="h-5 w-px bg-blue-400" />
          <button onClick={sendSelected} disabled={sending}
            className="bg-white text-blue-700 px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-blue-50 disabled:opacity-50 transition-colors">
            {sending ? "Sending..." : "Send to Jon"}
          </button>
          <button onClick={() => markStatus("upgraded")}
            className="bg-emerald-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-emerald-600 transition-colors">
            Mark Upgraded
          </button>
          <button onClick={() => markStatus("sent")} className="text-blue-200 hover:text-white text-xs px-2 py-1">Mark Sent</button>
          <button onClick={() => markStatus("pending")} className="text-blue-200 hover:text-white text-xs px-2 py-1">Mark Pending</button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-blue-200 hover:text-white text-sm">Clear</button>
          {message && <span className="text-sm text-green-300">{message}</span>}
        </div>
      )}

      {/* ===== School Purchase: Grouped View ===== */}
      {(tab === "all" || tab === "school") && viewMode === "grouped" && filteredSchools.length > 0 && (
        <div className="space-y-3">
          {tab === "all" && (
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">School Purchase</h2>
          )}
          {filteredSchools.map((school) => {
            const tc = teamColorMap[school.team || ""] || { bg: "bg-gray-50", text: "text-gray-600" };
            const allChecked = school.teachers.every((t) => selected.has(t.id));
            const someChecked = school.teachers.some((t) => selected.has(t.id));
            const pendingC = school.teachers.filter(t => t.status === "pending" || t.status === "sent").length;
            const upgC = school.teachers.filter(t => t.status === "upgraded" || t.status === "individual").length;

            return (
              <div key={school.id} className="bg-white rounded-xl border overflow-hidden">
                {/* School header */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <input type="checkbox" checked={allChecked}
                    ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked; }}
                    onChange={() => toggleSchool(school)} className="w-4 h-4 rounded" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900">{school.nameEn || school.name}</span>
                      {school.nameEn && <span className="text-xs text-gray-400 hidden sm:inline">{school.name}</span>}
                      {school.team && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${tc.bg} ${tc.text}`}>{school.team}</span>
                      )}
                      {pendingC > 0 && (
                        <span className="text-[10px] font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">{pendingC} pending</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {school.teachers.length > 0 && (
                      <div className="flex h-1.5 w-16 rounded-full overflow-hidden bg-gray-100">
                        {upgC > 0 && <div className="bg-emerald-400" style={{ width: `${(upgC / school.teachers.length) * 100}%` }} />}
                        {pendingC > 0 && <div className="bg-amber-400" style={{ width: `${(pendingC / school.teachers.length) * 100}%` }} />}
                      </div>
                    )}
                    <span className="text-sm font-semibold text-gray-900">{school.teachers.length}</span>
                  </div>
                </div>
                {/* Teacher rows */}
                <div className="border-t divide-y divide-gray-50">
                  {school.teachers.map((t) => {
                    const sc = statusConfig[t.status] || statusConfig.pending;
                    return (
                      <label key={t.id}
                        className={`flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-blue-50/40 transition-colors ${selected.has(t.id) ? "bg-blue-50/60" : ""}`}>
                        <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleTeacher(t.id)} className="w-3.5 h-3.5 rounded" />
                        <span className={`w-2 h-2 rounded-full shrink-0 ${
                          t.status === "upgraded" ? "bg-emerald-400" : t.status === "pending" ? "bg-amber-400" : t.status === "sent" ? "bg-blue-400" : t.status === "individual" ? "bg-purple-400" : "bg-gray-300"
                        }`} />
                        <span className="text-sm text-gray-600 w-20 truncate">{t.name}</span>
                        <span className="text-sm text-gray-700 font-mono truncate flex-1">{t.email}</span>
                        {t.subject && <span className="text-xs text-gray-400">{t.subject}</span>}
                        <span className={`text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full ${sc.bg} ${sc.color}`}>
                          {sc.label}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ===== School Purchase: Flat Table View ===== */}
      {(tab === "all" || tab === "school") && viewMode === "flat" && flatTeachers.length > 0 && (
        <div>
          {tab === "all" && (
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">School Purchase</h2>
          )}
          <div className="bg-white rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
                  <th className="px-4 py-3 w-8"><input type="checkbox" onChange={selectAll} className="rounded" /></th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">School</th>
                  <th className="px-4 py-3 font-medium">Team</th>
                  <th className="px-4 py-3 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {flatTeachers.map((t) => {
                  const sc = statusConfig[t.status] || statusConfig.pending;
                  const tc = teamColorMap[t.school.team || ""] || { bg: "bg-gray-50", text: "text-gray-600" };
                  return (
                    <tr key={t.id} className={`hover:bg-gray-50/80 transition-colors ${selected.has(t.id) ? "bg-blue-50/40" : ""}`}>
                      <td className="px-4 py-2.5">
                        <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleTeacher(t.id)} className="rounded" />
                      </td>
                      <td className="px-4 py-2.5 font-mono text-gray-700">{t.email}</td>
                      <td className="px-4 py-2.5 text-gray-600">{t.name}</td>
                      <td className="px-4 py-2.5">
                        <span className="text-gray-700">{t.school.nameEn || t.school.name}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        {t.school.team ? (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${tc.bg} ${tc.text}`}>{t.school.team}</span>
                        ) : <span className="text-gray-300">-</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={`text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full ${sc.bg} ${sc.color}`}>
                          {sc.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== Individual Purchase ===== */}
      {(tab === "all" || tab === "individual") && individualBySchool.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Individual Purchase</h2>
          <div className="bg-white rounded-xl border overflow-hidden">
            {individualBySchool.map(([schoolName, teachers], idx) => (
              <div key={schoolName} className={idx > 0 ? "border-t" : ""}>
                <div className="flex items-center gap-2 px-4 py-2.5 bg-purple-50/40">
                  <span className="font-semibold text-sm text-gray-900">{schoolName}</span>
                  <span className="text-xs text-purple-500 font-medium">{teachers.length}</span>
                </div>
                <div className="divide-y divide-gray-50">
                  {teachers.map((t) => {
                    const sc = statusConfig[t.status] || statusConfig.pending;
                    return (
                      <div key={`${t.requestId}-${t.email}`} className="flex items-center gap-3 px-4 pl-6 py-2 text-sm">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${
                          t.status === "paid" ? "bg-purple-400" : "bg-gray-300"
                        }`} />
                        <span className="font-mono text-gray-700 flex-1 truncate">{t.email}</span>
                        <span className={`text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full ${sc.bg} ${sc.color}`}>
                          {sc.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {filteredSchools.length === 0 && individualBySchool.length === 0 && (
        <div className="text-center py-20">
          <p className="text-gray-400 text-sm">No teachers found</p>
          {search && <p className="text-gray-300 text-xs mt-1">Try a different search term</p>}
        </div>
      )}
    </div>
  );
}
