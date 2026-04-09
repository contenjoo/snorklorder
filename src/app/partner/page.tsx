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

export default function PartnerDashboard() {
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<"jon" | "jeff" | null>(null);
  const [tab, setTab] = useState<Tab>("action");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [upgrading, setUpgrading] = useState(false);
  const [msg, setMsg] = useState("");
  const [expandedSchools, setExpandedSchools] = useState<Set<number>>(new Set());

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
    };
  }, [schools]);

  const needAction = stats.pending + stats.sent;

  const actionSchools = useMemo(
    () => schools
      .filter((s) => s.counts.pending > 0 || s.counts.sent > 0)
      .sort((a, b) => (b.counts.pending + b.counts.sent) - (a.counts.pending + a.counts.sent)),
    [schools]
  );

  const actionTeachers = useMemo(
    () => actionSchools.flatMap((s) =>
      s.teachers.filter((t) => t.status === "pending" || t.status === "sent")
    ),
    [actionSchools]
  );

  // Team summary for overview
  const teamSummary = useMemo(() => {
    const map = new Map<string, { schools: number; teachers: number; pending: number; sent: number; upgraded: number }>();
    for (const s of schools) {
      if (s.counts.total === 0) continue;
      const key = s.team || "Unassigned";
      if (!map.has(key)) map.set(key, { schools: 0, teachers: 0, pending: 0, sent: 0, upgraded: 0 });
      const t = map.get(key)!;
      t.schools++;
      t.teachers += s.counts.total;
      t.pending += s.counts.pending;
      t.sent += s.counts.sent;
      t.upgraded += s.counts.upgraded;
    }
    return Array.from(map.entries()).sort(([a], [b]) => a === "Unassigned" ? 1 : b === "Unassigned" ? -1 : a.localeCompare(b));
  }, [schools]);

  const recentTeachers = useMemo(
    () => schools
      .flatMap((s) => s.teachers.map((t) => ({ ...t, schoolName: s.nameEn || s.name })))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 20),
    [schools]
  );

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectAllAction() {
    if (selected.size === actionTeachers.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(actionTeachers.map((t) => t.id)));
    }
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
        // Reload
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
    <div className="space-y-5">
      {/* Greeting */}
      <div className="text-sm text-slate-500">{greeting} 👋</div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: "Schools", value: stats.schools, bg: "bg-white", color: "text-slate-900" },
          { label: "Teachers", value: stats.teachers, bg: "bg-white", color: "text-slate-900" },
          { label: "Pending", value: stats.pending, bg: stats.pending > 0 ? "bg-amber-50 border-amber-200" : "bg-white", color: "text-amber-700" },
          { label: "Sent", value: stats.sent, bg: stats.sent > 0 ? "bg-blue-50 border-blue-200" : "bg-white", color: "text-blue-700" },
          { label: "Upgraded", value: stats.upgraded, bg: "bg-emerald-50 border-emerald-200", color: "text-emerald-700" },
        ].map((s) => (
          <div key={s.label} className={`${s.bg} rounded-xl border p-4`}>
            <div className="text-xs font-medium text-slate-500">{s.label}</div>
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Status banner */}
      {needAction === 0 && stats.teachers > 0 && (
        <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 px-5 py-4 flex items-center gap-3">
          <span className="text-2xl">✅</span>
          <div>
            <p className="font-bold text-emerald-900">All teachers are upgraded!</p>
            <p className="text-sm text-emerald-700">{stats.upgraded} teachers across {stats.schools} schools are active on Snorkl Premium.</p>
          </div>
        </div>
      )}

      {needAction > 0 && !isJon && (
        <div className="rounded-xl border-2 border-amber-200 bg-amber-50 px-5 py-4 flex items-center gap-3">
          <span className="text-2xl">⏳</span>
          <div>
            <p className="font-bold text-amber-900">{needAction} teacher(s) awaiting upgrade</p>
            <p className="text-sm text-amber-700">{stats.pending} pending, {stats.sent} sent to Jon for processing.</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
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

      {/* Action / Overview Tab */}
      {tab === "action" && isJon && (
        <div className="space-y-3">
          {actionSchools.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <div className="text-4xl mb-3">🎉</div>
              <p className="text-lg font-medium">No pending upgrades</p>
              <p className="text-sm">All teachers have been upgraded. Nice work!</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between px-1">
                <button onClick={selectAllAction} className="text-sm font-medium text-blue-600 hover:text-blue-800">
                  {selected.size === actionTeachers.length ? "Deselect All" : "Select All"}
                </button>
                <span className="text-sm text-slate-500">{selected.size} / {actionTeachers.length} selected</span>
              </div>

              {actionSchools.map((school) => {
                const needTeachers = school.teachers.filter((t) => t.status === "pending" || t.status === "sent");
                return (
                  <div key={school.id} className="bg-white rounded-xl border shadow-sm overflow-hidden">
                    <div className="px-4 py-3 bg-slate-50 border-b flex items-center justify-between">
                      <div>
                        <span className="font-semibold text-slate-900">{school.nameEn || school.name}</span>
                        {school.nameEn && <span className="ml-2 text-xs text-slate-400">{school.name}</span>}
                        {school.team && (
                          <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">{school.team}</span>
                        )}
                        <span className="ml-2 text-sm text-slate-500">({needTeachers.length})</span>
                      </div>
                      <div className="flex gap-1.5">
                        {school.counts.pending > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">{school.counts.pending} pending</span>}
                        {school.counts.sent > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">{school.counts.sent} sent</span>}
                        {school.counts.upgraded > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">{school.counts.upgraded} done</span>}
                      </div>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {needTeachers.map((t) => (
                        <label key={t.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-blue-50/50 cursor-pointer transition-colors">
                          <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)}
                            className="w-4.5 h-4.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                          <span className="font-mono text-sm text-slate-800 flex-1">{t.email}</span>
                          {t.subject && <span className="text-[11px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded">{t.subject}</span>}
                          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                            t.status === "pending" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"
                          }`}>{t.status}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}

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

      {/* Jeff's Overview: team breakdown */}
      {tab === "action" && !isJon && (
        <div className="grid grid-cols-2 gap-3">
          {teamSummary.map(([team, data]) => {
            const pct = data.teachers > 0 ? Math.round((data.upgraded / data.teachers) * 100) : 0;
            return (
              <div key={team} className="bg-white rounded-xl border p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-slate-900">{team}</span>
                  <span className="text-xs text-slate-400">{data.schools} school(s)</span>
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs font-medium text-slate-600 w-10 text-right">{pct}%</span>
                </div>
                <div className="flex gap-3 text-xs">
                  <span className="text-slate-600"><b>{data.teachers}</b> total</span>
                  {data.pending > 0 && <span className="text-amber-600"><b>{data.pending}</b> pending</span>}
                  {data.sent > 0 && <span className="text-blue-600"><b>{data.sent}</b> sent</span>}
                  <span className="text-emerald-600"><b>{data.upgraded}</b> done</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* All Schools Tab */}
      {tab === "schools" && (
        <div className="space-y-2">
          {schools
            .filter((s) => s.counts.total > 0)
            .sort((a, b) => b.counts.total - a.counts.total)
            .map((school) => {
              const expanded = expandedSchools.has(school.id);
              const pct = school.counts.total > 0 ? Math.round((school.counts.upgraded / school.counts.total) * 100) : 0;
              return (
                <div key={school.id} className="bg-white rounded-xl border shadow-sm overflow-hidden">
                  <button onClick={() => toggleSchool(school.id)}
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors text-left">
                    <span className="text-slate-400 text-xs w-4">{expanded ? "▼" : "▶"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900 truncate">{school.nameEn || school.name}</span>
                        {school.nameEn && <span className="text-xs text-slate-400 truncate">{school.name}</span>}
                        {school.team && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600 font-medium shrink-0">{school.team}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[11px] text-slate-500 w-8 text-right">{pct}%</span>
                      </div>
                    </div>
                    <div className="flex gap-2 text-xs shrink-0">
                      <span className="text-slate-600 font-medium">{school.counts.total}</span>
                      {school.counts.pending > 0 && <span className="text-amber-600">{school.counts.pending}P</span>}
                      {school.counts.sent > 0 && <span className="text-blue-600">{school.counts.sent}S</span>}
                      <span className="text-emerald-600">{school.counts.upgraded}✓</span>
                    </div>
                  </button>
                  {expanded && (
                    <div className="border-t divide-y divide-slate-100">
                      {school.teachers.map((t) => (
                        <div key={t.id} className="flex items-center gap-3 px-4 py-2 pl-11 text-sm">
                          <div className={`w-2 h-2 rounded-full shrink-0 ${
                            t.status === "upgraded" ? "bg-emerald-500" : t.status === "sent" ? "bg-blue-500" : "bg-amber-500"
                          }`} />
                          <span className="font-mono text-slate-700 flex-1 truncate">{t.email}</span>
                          {t.subject && <span className="text-[11px] text-slate-400">{t.subject}</span>}
                          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                            t.status === "upgraded" ? "bg-emerald-100 text-emerald-700" :
                            t.status === "sent" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
                          }`}>{t.status === "upgraded" ? "done" : t.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      )}

      {/* Recent Tab */}
      {tab === "recent" && (
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b text-[11px] text-slate-400 font-medium uppercase tracking-wider grid grid-cols-[1fr_auto_auto_auto] gap-3">
            <span>Email</span>
            <span className="w-28">School</span>
            <span className="w-16 text-center">Status</span>
            <span className="w-20 text-right">Date</span>
          </div>
          {recentTeachers.map((t) => (
            <div key={t.id} className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-4 py-2.5 border-b last:border-0 items-center text-sm hover:bg-slate-50/50">
              <span className="font-mono text-slate-800 truncate">{t.email}</span>
              <span className="text-xs text-slate-500 w-28 truncate text-right">{t.schoolName}</span>
              <span className={`w-16 text-center text-[11px] px-2 py-0.5 rounded-full font-medium ${
                t.status === "upgraded" ? "bg-emerald-100 text-emerald-700" :
                t.status === "sent" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
              }`}>{t.status === "upgraded" ? "done" : t.status}</span>
              <span className="text-[11px] text-slate-400 w-20 text-right">
                {new Date(t.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
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
    </div>
  );
}
