"use client";

import { useEffect, useState, useMemo } from "react";

interface Teacher {
  id: number;
  schoolId: number;
  name: string;
  email: string;
  subject: string | null;
  status: string;
  createdAt: string;
}

interface School {
  id: number;
  name: string;
  nameEn: string | null;
  code: string;
  region: string | null;
  team: string | null;
  teachers: Teacher[];
  counts: { total: number; pending: number; sent: number; upgraded: number };
}

type Tab = "action" | "schools" | "recent";

const SUBJECT_EN: Record<string, string> = {
  "수학": "Math", "국어": "Korean", "영어": "English", "과학": "Science",
  "역사": "History", "사회": "Social Studies", "미술": "Art", "음악": "Music",
  "체육": "PE", "기술": "Technology", "생명과학": "Biology", "제2외국어": "2nd Language",
  "담임": "Homeroom", "상담": "Counseling", "사서": "Librarian", "환경": "Environment",
  "물리": "Physics", "화학": "Chemistry", "지리": "Geography", "도덕": "Ethics",
  "정보": "IT", "가정": "Home Ec", "일본어": "Japanese", "중국어": "Chinese",
};

// English labels for team names
const TEAM_EN: Record<string, string> = {
  "서울1팀": "Seoul Team 1",
  "서울4팀": "Seoul Team 4",
  "경기2팀": "Gyeonggi Team 2",
  "경기3팀": "Gyeonggi Team 3",
  "경기5팀": "Gyeonggi Team 5",
};

function teamLabel(team: string | null): string {
  if (!team || team === "미배정") return "Unassigned";
  if (TEAM_EN[team]) return TEAM_EN[team];
  if (team.includes("개별")) return "Individual";
  return team;
}

function isGroupPurchaseTeam(team: string | null): boolean {
  if (!team) return false;
  return !team.includes("개별") && team !== "미배정";
}

export default function PartnerDashboard() {
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<"jon" | "jeff" | null>(null);
  const [tab, setTab] = useState<Tab>("action");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [upgrading, setUpgrading] = useState(false);
  const [msg, setMsg] = useState("");
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());
  const [expandedSchools, setExpandedSchools] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/partner/auth").then((r) => r.json()),
      fetch("/api/partner").then((r) => r.json()),
    ]).then(([auth, data]) => {
      setRole(auth.role || null);
      setSchools(data);
      setLoading(false);
    });
  }, []);

  const isJon = role === "jon";

  const stats = useMemo(() => {
    const all = schools.flatMap((s) => s.teachers);
    return {
      schools: schools.filter((s) => s.counts.total > 0).length,
      teachers: all.length,
      pending: all.filter((t) => t.status === "pending").length,
      sent: all.filter((t) => t.status === "sent").length,
      upgraded: all.filter((t) => t.status === "upgraded").length,
      individual: all.filter((t) => t.status === "individual").length,
    };
  }, [schools]);

  const needAction = stats.pending + stats.sent;

  // Group schools by team for action view
  const actionByTeam = useMemo(() => {
    const teamMap = new Map<string, { teamKey: string; label: string; isGroup: boolean; schools: School[] }>();

    for (const s of schools) {
      const actionTeachers = s.teachers.filter(t => t.status === "pending" || t.status === "sent");
      if (actionTeachers.length === 0) continue;

      const isGroup = isGroupPurchaseTeam(s.team);
      const key = isGroup ? (s.team || "Unassigned") : "__individual__";

      if (!teamMap.has(key)) {
        teamMap.set(key, {
          teamKey: key,
          label: isGroup ? teamLabel(s.team) : "Individual Schools",
          isGroup,
          schools: [],
        });
      }
      teamMap.get(key)!.schools.push(s);
    }

    // Sort: group purchase teams first (alphabetical), then individual
    return Array.from(teamMap.values()).sort((a, b) => {
      if (a.isGroup && !b.isGroup) return -1;
      if (!a.isGroup && b.isGroup) return 1;
      return a.label.localeCompare(b.label);
    });
  }, [schools]);

  // Group ALL schools by team for schools tab
  const schoolsByTeam = useMemo(() => {
    const teamMap = new Map<string, { label: string; isGroup: boolean; schools: School[]; totalTeachers: number; upgradedTeachers: number }>();

    for (const s of schools) {
      if (s.counts.total === 0) continue;
      const isGroup = isGroupPurchaseTeam(s.team);
      const key = isGroup ? (s.team || "Unassigned") : (s.team || "Unassigned");

      if (!teamMap.has(key)) {
        teamMap.set(key, { label: teamLabel(s.team), isGroup, schools: [], totalTeachers: 0, upgradedTeachers: 0 });
      }
      const group = teamMap.get(key)!;
      group.schools.push(s);
      group.totalTeachers += s.counts.total;
      group.upgradedTeachers += s.counts.upgraded;
    }

    // Sort schools within each group by teacher count desc
    for (const group of teamMap.values()) {
      group.schools.sort((a, b) => b.counts.total - a.counts.total);
    }

    return Array.from(teamMap.entries()).sort(([, a], [, b]) => {
      if (a.isGroup && !b.isGroup) return -1;
      if (!a.isGroup && b.isGroup) return 1;
      return a.label.localeCompare(b.label);
    });
  }, [schools]);

  const recentTeachers = useMemo(
    () => schools
      .flatMap((s) => s.teachers.map((t) => ({ ...t, schoolName: s.nameEn || s.name, team: s.team })))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 30),
    [schools]
  );

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectTeamAction(teamSchools: School[]) {
    const ids = teamSchools.flatMap(s => s.teachers.filter(t => t.status === "pending" || t.status === "sent").map(t => t.id));
    const allSelected = ids.every(id => selected.has(id));
    setSelected(prev => {
      const next = new Set(prev);
      ids.forEach(id => { if (allSelected) next.delete(id); else next.add(id); });
      return next;
    });
  }

  function selectAllAction() {
    const allIds = actionByTeam.flatMap(g => g.schools.flatMap(s => s.teachers.filter(t => t.status === "pending" || t.status === "sent").map(t => t.id)));
    if (allIds.every(id => selected.has(id))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allIds));
    }
  }

  function copyEmails(emails: string[], label: string) {
    navigator.clipboard.writeText(emails.join("\n"));
    setCopied(label);
    setTimeout(() => setCopied(""), 2500);
  }

  function toggleTeam(key: string) {
    setExpandedTeams(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function toggleSchool(id: number) {
    setExpandedSchools((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function confirmUpgrades() {
    if (selected.size === 0) return;
    setUpgrading(true);
    setMsg("");
    try {
      const res = await fetch("/api/partner", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      const data = await res.json();
      if (data.success) {
        setMsg(`${data.upgraded} teacher(s) marked as upgraded`);
        setSelected(new Set());
        const fresh = await fetch("/api/partner").then((r) => r.json());
        setSchools(fresh);
      } else {
        setMsg("Failed: " + (data.error || "Unknown error"));
      }
    } catch {
      setMsg("Connection error");
    } finally {
      setUpgrading(false);
      setTimeout(() => setMsg(""), 4000);
    }
  }

  if (loading) {
    return <div className="py-20 text-center text-slate-400 text-lg">Loading dashboard...</div>;
  }

  const greeting = isJon ? "Hi Jon" : "Hi Jeff";
  const confirmedTotal = stats.upgraded + stats.individual;
  const confirmRate = stats.teachers > 0 ? Math.round((confirmedTotal / stats.teachers) * 100) : 0;

  const tabs: { key: Tab; label: string; badge?: number }[] = isJon
    ? [
        { key: "action", label: "Action Needed", badge: needAction || undefined },
        { key: "schools", label: "All Schools" },
        { key: "recent", label: "Recent" },
      ]
    : [
        { key: "action", label: "Overview" },
        { key: "schools", label: "All Schools" },
        { key: "recent", label: "Recent" },
      ];

  return (
    <div className="space-y-5 pb-20 md:pb-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div>
          <div className="text-sm text-slate-500">{greeting} 👋</div>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500 sm:ml-auto">
          <span><strong className="text-slate-900 text-sm">{stats.schools}</strong> schools</span>
          <span className="text-slate-200">|</span>
          <span><strong className="text-slate-900 text-sm">{stats.teachers}</strong> teachers</span>
          <span className="text-slate-200">|</span>
          <span className="text-emerald-600 font-medium">{confirmRate}% upgraded</span>
          {needAction > 0 && (
            <>
              <span className="text-slate-200">|</span>
              <span className="text-amber-600 font-medium">{needAction} pending</span>
            </>
          )}
        </div>
      </div>

      {/* Status banner */}
      {needAction === 0 && stats.teachers > 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 flex items-center gap-3">
          <span className="text-2xl">✅</span>
          <div>
            <p className="font-bold text-emerald-900">All teachers are upgraded!</p>
            <p className="text-sm text-emerald-700">{confirmedTotal} teachers across {stats.schools} schools are active on Snorkl Premium.</p>
          </div>
        </div>
      )}

      {needAction > 0 && !isJon && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 flex items-center gap-3">
          <span className="text-2xl">⏳</span>
          <div>
            <p className="font-bold text-amber-900">{needAction} teacher(s) awaiting upgrade</p>
            <p className="text-sm text-amber-700">{stats.pending} pending, {stats.sent} sent to Jon for processing.</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === t.key
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
            {t.badge && (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-amber-500 text-white text-[11px] font-bold">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ===== Action Tab (Jon): Grouped by Team ===== */}
      {tab === "action" && isJon && (
        <div className="space-y-4">
          {actionByTeam.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <div className="text-4xl mb-3">🎉</div>
              <p className="text-lg font-medium">No pending upgrades</p>
              <p className="text-sm">All teachers have been upgraded. Nice work!</p>
            </div>
          ) : (
            <>
              {/* Top controls */}
              <div className="flex items-center justify-between px-1 flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <button onClick={selectAllAction} className="text-sm font-medium text-blue-600 hover:text-blue-800">
                    {actionByTeam.flatMap(g => g.schools.flatMap(s => s.teachers.filter(t => t.status === "pending" || t.status === "sent"))).every(t => selected.has(t.id))
                      ? "Deselect All" : "Select All"}
                  </button>
                  <button onClick={() => {
                    const emails = actionByTeam.flatMap(g => g.schools.flatMap(s => s.teachers.filter(t => t.status === "pending" || t.status === "sent").map(t => t.email)));
                    copyEmails(emails, `${emails.length} emails copied`);
                  }} className="text-sm font-medium text-slate-500 hover:text-slate-700 flex items-center gap-1">
                    📋 Copy All Emails
                  </button>
                </div>
                <span className="text-sm text-slate-500">{selected.size} selected</span>
              </div>

              {/* Team groups */}
              {actionByTeam.map((group) => {
                const teamTeachers = group.schools.flatMap(s => s.teachers.filter(t => t.status === "pending" || t.status === "sent"));
                const teamPending = teamTeachers.filter(t => t.status === "pending").length;
                const teamSent = teamTeachers.filter(t => t.status === "sent").length;
                const allTeamSelected = teamTeachers.every(t => selected.has(t.id));

                return (
                  <div key={group.teamKey} className="space-y-2">
                    {/* Team header */}
                    <div className="flex items-center gap-3 px-1">
                      <div className={`w-1 h-5 rounded-full ${group.isGroup ? "bg-blue-500" : "bg-slate-300"}`} />
                      <h3 className="text-sm font-bold text-slate-900">{group.label}</h3>
                      <span className="text-xs text-slate-400">
                        {group.schools.length} school{group.schools.length > 1 ? "s" : ""} · {teamTeachers.length} teacher{teamTeachers.length > 1 ? "s" : ""}
                      </span>
                      {teamPending > 0 && <span className="text-[10px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">{teamPending} pending</span>}
                      {teamSent > 0 && <span className="text-[10px] font-medium text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">{teamSent} sent</span>}
                      <div className="flex-1" />
                      <button onClick={() => selectTeamAction(group.schools)}
                        className="text-[11px] text-blue-600 hover:text-blue-800 font-medium">
                        {allTeamSelected ? "Deselect" : "Select"} team
                      </button>
                      <button onClick={() => {
                        const emails = teamTeachers.map(t => t.email);
                        copyEmails(emails, `${group.label}: ${emails.length} copied`);
                      }} className="text-[11px] text-slate-400 hover:text-slate-600">📋</button>
                    </div>

                    {/* Schools in this team */}
                    {group.schools.map((school) => {
                      const needTeachers = school.teachers.filter((t) => t.status === "pending" || t.status === "sent");
                      return (
                        <div key={school.id} className="bg-white rounded-xl border overflow-hidden">
                          <div className="px-4 py-2.5 bg-slate-50/80 border-b flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm text-slate-900">{school.nameEn || school.name}</span>
                            {school.nameEn && <span className="text-[10px] text-slate-400 hidden sm:inline">{school.name}</span>}
                            <span className="text-xs text-slate-400">({needTeachers.length})</span>
                            <div className="flex-1" />
                            <button onClick={() => {
                              const emails = needTeachers.map(t => t.email);
                              copyEmails(emails, `${school.nameEn || school.name}: ${emails.length} copied`);
                            }} className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-500 hover:bg-slate-200 font-medium">📋 Copy</button>
                          </div>
                          <div className="divide-y divide-slate-50">
                            {needTeachers.map((t) => (
                              <label key={t.id} className={`flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 cursor-pointer transition-colors ${selected.has(t.id) ? "bg-blue-50/60" : "hover:bg-blue-50/30"}`}>
                                <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)}
                                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 shrink-0" />
                                <span className="font-mono text-sm text-slate-800 flex-1 truncate min-w-0">{t.email}</span>
                                {t.subject && <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded hidden sm:inline">{SUBJECT_EN[t.subject] || t.subject}</span>}
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${
                                  t.status === "pending" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"
                                }`}>{t.status}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              {/* Sticky upgrade button */}
              {selected.size > 0 && (
                <div className="sticky bottom-4">
                  <button onClick={confirmUpgrades} disabled={upgrading}
                    className="w-full py-4 rounded-xl text-white font-bold text-lg shadow-lg disabled:opacity-50 bg-blue-600 hover:bg-blue-700 active:bg-blue-800">
                    {upgrading ? "Upgrading..." : `✅ Mark ${selected.size} as Upgraded`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ===== Overview Tab (Jeff): team breakdown ===== */}
      {tab === "action" && !isJon && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {schoolsByTeam.map(([key, data]) => {
            const pct = data.totalTeachers > 0 ? Math.round((data.upgradedTeachers / data.totalTeachers) * 100) : 0;
            return (
              <div key={key} className={`bg-white rounded-xl border p-4 ${data.isGroup ? "border-l-2 border-l-blue-400" : ""}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900">{data.label}</span>
                    {data.isGroup && <span className="text-[9px] font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">Group</span>}
                  </div>
                  <span className="text-xs text-slate-400">{data.schools.length} school{data.schools.length > 1 ? "s" : ""}</span>
                </div>
                {data.isGroup && (
                  <div className="text-[10px] text-slate-400 mb-2">
                    {data.schools.map(s => s.nameEn || s.name).join(", ")}
                  </div>
                )}
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs font-medium text-slate-600 w-10 text-right">{pct}%</span>
                </div>
                <div className="flex gap-3 text-xs">
                  <span className="text-slate-600"><b>{data.totalTeachers}</b> total</span>
                  <span className="text-emerald-600"><b>{data.upgradedTeachers}</b> done</span>
                  {data.totalTeachers - data.upgradedTeachers > 0 && (
                    <span className="text-amber-600"><b>{data.totalTeachers - data.upgradedTeachers}</b> pending</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ===== All Schools Tab: Grouped by Team ===== */}
      {tab === "schools" && (
        <div className="space-y-4">
          {schoolsByTeam.map(([key, group]) => {
            const pct = group.totalTeachers > 0 ? Math.round((group.upgradedTeachers / group.totalTeachers) * 100) : 0;
            const isTeamOpen = expandedTeams.has(key);

            return (
              <div key={key}>
                {/* Team header */}
                <button onClick={() => toggleTeam(key)}
                  className="w-full flex items-center gap-3 px-1 mb-2 text-left">
                  <div className={`w-1 h-5 rounded-full ${group.isGroup ? "bg-blue-500" : "bg-slate-300"}`} />
                  <h3 className="text-sm font-bold text-slate-900">{group.label}</h3>
                  {group.isGroup && <span className="text-[9px] font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">Group Purchase</span>}
                  <span className="text-xs text-slate-400">{group.schools.length} school{group.schools.length > 1 ? "s" : ""} · {group.totalTeachers} teachers</span>
                  <div className="flex items-center gap-2 ml-auto">
                    <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden hidden sm:block">
                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-slate-500">{pct}%</span>
                    <svg className={`w-4 h-4 text-slate-300 transition-transform ${isTeamOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>

                {/* Schools in team */}
                {isTeamOpen && (
                  <div className="space-y-2 ml-3">
                    {group.schools.map((school) => {
                      const expanded = expandedSchools.has(school.id);
                      const sPct = school.counts.total > 0 ? Math.round((school.counts.upgraded / school.counts.total) * 100) : 0;
                      return (
                        <div key={school.id} className="bg-white rounded-xl border overflow-hidden">
                          <button onClick={() => toggleSchool(school.id)}
                            className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50 transition-colors text-left">
                            <div className={`w-2 h-2 rounded-full shrink-0 ${sPct === 100 ? "bg-emerald-400" : school.counts.pending > 0 ? "bg-amber-400" : "bg-blue-400"}`} />
                            <div className="flex-1 min-w-0">
                              <span className="font-medium text-sm text-slate-900 truncate">{school.nameEn || school.name}</span>
                              {school.nameEn && <span className="text-xs text-slate-400 ml-2 hidden sm:inline">{school.name}</span>}
                            </div>
                            <div className="flex items-center gap-2 text-xs shrink-0">
                              <span className="text-slate-600 font-medium">{school.counts.total}</span>
                              {school.counts.pending > 0 && <span className="text-amber-600">{school.counts.pending}P</span>}
                              {school.counts.sent > 0 && <span className="text-blue-600">{school.counts.sent}S</span>}
                              <span className="text-emerald-600">{school.counts.upgraded}✓</span>
                            </div>
                            <svg className={`w-4 h-4 text-slate-300 transition-transform shrink-0 ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                          {expanded && (
                            <div className="border-t divide-y divide-slate-50">
                              {school.teachers.map((t) => (
                                <div key={t.id} className="flex items-center gap-2 sm:gap-3 px-4 py-2 pl-8 text-sm">
                                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                    t.status === "upgraded" ? "bg-emerald-400" : t.status === "sent" ? "bg-blue-400" : t.status === "individual" ? "bg-violet-400" : "bg-amber-400"
                                  }`} />
                                  <span className="font-mono text-slate-700 flex-1 truncate min-w-0">{t.email}</span>
                                  {t.subject && <span className="text-[10px] text-slate-400 hidden sm:inline">{SUBJECT_EN[t.subject] || t.subject}</span>}
                                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${
                                    t.status === "upgraded" ? "bg-emerald-100 text-emerald-700" :
                                    t.status === "individual" ? "bg-violet-100 text-violet-700" :
                                    t.status === "sent" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
                                  }`}>{t.status === "upgraded" ? "done" : t.status === "individual" ? "individual" : t.status}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ===== Recent Tab ===== */}
      {tab === "recent" && (
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="hidden sm:grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-4 py-2.5 bg-slate-50 border-b text-[11px] text-slate-400 font-medium uppercase tracking-wider">
            <span>Email</span>
            <span className="w-32">School</span>
            <span className="w-20">Team</span>
            <span className="w-16 text-center">Status</span>
            <span className="w-20 text-right">Date</span>
          </div>
          {recentTeachers.map((t) => (
            <div key={t.id} className="border-b last:border-0">
              {/* Desktop */}
              <div className="hidden sm:grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-4 py-2.5 items-center text-sm hover:bg-slate-50/50">
                <span className="font-mono text-slate-800 truncate">{t.email}</span>
                <span className="text-xs text-slate-500 w-32 truncate text-right">{t.schoolName}</span>
                <span className="text-[10px] text-slate-400 w-20 truncate">{teamLabel(t.team)}</span>
                <span className={`w-16 text-center text-[11px] px-2 py-0.5 rounded-full font-medium ${
                  t.status === "upgraded" ? "bg-emerald-100 text-emerald-700" :
                  t.status === "individual" ? "bg-violet-100 text-violet-700" :
                  t.status === "sent" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
                }`}>{t.status === "upgraded" ? "done" : t.status}</span>
                <span className="text-[11px] text-slate-400 w-20 text-right">
                  {new Date(t.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              </div>
              {/* Mobile */}
              <div className="sm:hidden px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-slate-800 truncate flex-1">{t.email}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${
                    t.status === "upgraded" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                  }`}>{t.status === "upgraded" ? "done" : t.status}</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">{t.schoolName} · {teamLabel(t.team)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Toast */}
      {msg && (
        <div className={`fixed bottom-4 right-4 px-5 py-3 rounded-xl text-sm font-medium shadow-lg z-50 ${
          msg.includes("upgraded") ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
        }`}>{msg}</div>
      )}
      {copied && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 px-5 py-3 rounded-xl text-sm font-medium shadow-lg z-50 bg-slate-800 text-white">
          ✅ {copied}
        </div>
      )}
    </div>
  );
}
