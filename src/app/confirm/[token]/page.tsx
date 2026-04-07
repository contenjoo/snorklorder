"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface Teacher {
  id: number;
  name: string;
  email: string;
  subject: string | null;
  status: string;
  schoolName: string;
}

interface SchoolSummary {
  id: number;
  name: string;
  nameEn: string | null;
  code: string;
  region: string | null;
  team: string | null;
  total: number;
  pending: number;
  sent: number;
  upgraded: number;
}

interface Stats {
  totalSchools: number;
  totalTeachers: number;
  pending: number;
  sent: number;
  upgraded: number;
}

interface BatchData {
  batch: { id: number; status: string; createdAt: string; confirmedAt: string | null };
  teachers: Teacher[];
  confirmedIds: number[];
  schoolSummary: SchoolSummary[];
  stats: Stats;
}

export default function ConfirmPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<BatchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [tab, setTab] = useState<"upgrade" | "schools">("upgrade");

  useEffect(() => {
    fetch(`/api/confirm/${token}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(d.error);
        } else {
          setData(d);
          if (d.confirmedIds?.length) {
            setSelected(new Set(d.confirmedIds));
          }
          if (d.batch.status === "confirmed") {
            setDone(true);
          }
        }
      })
      .catch(() => setError("Failed to load"))
      .finally(() => setLoading(false));
  }, [token]);

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (!data) return;
    if (selected.size === data.teachers.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(data.teachers.map((t) => t.id)));
    }
  };

  const handleSubmit = async () => {
    if (selected.size === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/confirm/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmedTeacherIds: Array.from(selected) }),
      });
      const result = await res.json();
      if (result.success) {
        setDone(true);
      }
    } catch {
      alert("Failed to confirm. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500 text-lg">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md text-center">
          <div className="text-5xl mb-4">❌</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Invalid Link</h1>
          <p className="text-gray-500">This confirmation link is invalid or has expired.</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  // Group batch teachers by school
  const bySchool = new Map<string, Teacher[]>();
  for (const t of data.teachers) {
    if (!bySchool.has(t.schoolName)) bySchool.set(t.schoolName, []);
    bySchool.get(t.schoolName)!.push(t);
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md text-center">
          <div className="text-5xl mb-4">✅</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Confirmed!</h1>
          <p className="text-gray-500 mb-1">
            {selected.size} teacher(s) marked as upgraded.
          </p>
          <p className="text-gray-400 text-sm">Thank you, Jon! You can close this page.</p>
        </div>
      </div>
    );
  }

  const stats = data.stats;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center text-xl">
              🐳
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Snorkl Upgrade Portal</h1>
              <p className="text-sm text-gray-500">
                Sent on {new Date(data.batch.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
              </p>
            </div>
          </div>

          {/* Stats bar */}
          <div className="grid grid-cols-4 gap-3 mt-4">
            <div className="text-center p-2 bg-gray-50 rounded-lg">
              <div className="text-lg font-bold text-gray-900">{stats.totalSchools}</div>
              <div className="text-[11px] text-gray-500">Schools</div>
            </div>
            <div className="text-center p-2 bg-yellow-50 rounded-lg">
              <div className="text-lg font-bold text-yellow-700">{stats.pending}</div>
              <div className="text-[11px] text-yellow-600">Pending</div>
            </div>
            <div className="text-center p-2 bg-blue-50 rounded-lg">
              <div className="text-lg font-bold text-blue-700">{stats.sent}</div>
              <div className="text-[11px] text-blue-600">Sent</div>
            </div>
            <div className="text-center p-2 bg-green-50 rounded-lg">
              <div className="text-lg font-bold text-green-700">{stats.upgraded}</div>
              <div className="text-[11px] text-green-600">Upgraded</div>
            </div>
          </div>
        </div>

        {/* Tab navigation */}
        <div className="flex gap-1 mb-4 bg-white rounded-lg p-1 shadow-sm border">
          <button
            onClick={() => setTab("upgrade")}
            className={`flex-1 py-2.5 px-4 rounded-md text-sm font-medium transition-colors ${
              tab === "upgrade"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            ✅ Upgrade Request ({data.teachers.length})
          </button>
          <button
            onClick={() => setTab("schools")}
            className={`flex-1 py-2.5 px-4 rounded-md text-sm font-medium transition-colors ${
              tab === "schools"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            🏫 All Schools ({stats.totalSchools})
          </button>
        </div>

        {/* ========= UPGRADE TAB ========= */}
        {tab === "upgrade" && (
          <>
            <p className="text-gray-600 text-sm mb-4 px-1">
              Hi Jon! Please check the teachers you&apos;ve upgraded, then click <b>Confirm</b>.
            </p>

            {/* Select All */}
            <div className="flex items-center justify-between mb-3 px-1">
              <button
                onClick={selectAll}
                className="text-sm font-medium text-blue-600 hover:text-blue-800"
              >
                {selected.size === data.teachers.length ? "Deselect All" : "Select All"}
              </button>
              <span className="text-sm text-gray-500">
                {selected.size} / {data.teachers.length} selected
              </span>
            </div>

            {/* Teacher List by School */}
            {Array.from(bySchool.entries()).map(([schoolName, schoolTeachers]) => (
              <div key={schoolName} className="bg-white rounded-xl shadow-sm border mb-4 overflow-hidden">
                <div className="bg-gray-50 px-4 py-3 border-b">
                  <h2 className="font-semibold text-gray-900">
                    {schoolName}
                    <span className="ml-2 text-sm font-normal text-gray-500">
                      ({schoolTeachers.length})
                    </span>
                  </h2>
                </div>
                <div className="divide-y">
                  {schoolTeachers.map((t) => (
                    <label
                      key={t.id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-blue-50 cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(t.id)}
                        onChange={() => toggle(t.id)}
                        className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900 truncate">{t.email}</span>
                          {t.subject && (
                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                              {t.subject}
                            </span>
                          )}
                        </div>
                        {t.name && t.name !== t.email.split("@")[0] && (
                          <div className="text-sm text-gray-500">{t.name}</div>
                        )}
                      </div>
                      <span
                        className={`text-xs px-2 py-1 rounded-full ${
                          t.status === "upgraded"
                            ? "bg-green-100 text-green-700"
                            : t.status === "sent"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {t.status}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}

            {/* Submit Button */}
            <div className="sticky bottom-4 mt-6">
              <button
                onClick={handleSubmit}
                disabled={selected.size === 0 || submitting}
                className="w-full py-4 rounded-xl text-white font-bold text-lg shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-blue-600 hover:bg-blue-700 active:bg-blue-800"
              >
                {submitting
                  ? "Confirming..."
                  : `✅ Confirm ${selected.size} Upgrade${selected.size !== 1 ? "s" : ""}`}
              </button>
            </div>
          </>
        )}

        {/* ========= SCHOOLS TAB ========= */}
        {tab === "schools" && (
          <>
            <p className="text-gray-600 text-sm mb-4 px-1">
              Overview of all schools and their teacher upgrade status.
            </p>

            {/* School list */}
            <div className="space-y-3">
              {data.schoolSummary
                .sort((a, b) => b.total - a.total)
                .map((school) => {
                  const pct = school.total > 0 ? Math.round((school.upgraded / school.total) * 100) : 0;
                  return (
                    <div key={school.id} className="bg-white rounded-xl shadow-sm border overflow-hidden">
                      <div className="px-4 py-3">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <span className="font-semibold text-gray-900">{school.name}</span>
                            {school.nameEn && (
                              <span className="text-xs text-gray-400 ml-2">{school.nameEn}</span>
                            )}
                            {school.team && (
                              <span className="ml-2 text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full">
                                {school.team}
                              </span>
                            )}
                          </div>
                          <span className="text-sm font-bold text-gray-700">
                            {school.total} teacher{school.total !== 1 ? "s" : ""}
                          </span>
                        </div>

                        {/* Progress bar */}
                        <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden mb-2">
                          <div className="h-full flex">
                            {school.upgraded > 0 && (
                              <div
                                className="bg-green-500 h-full"
                                style={{ width: `${(school.upgraded / school.total) * 100}%` }}
                              />
                            )}
                            {school.sent > 0 && (
                              <div
                                className="bg-blue-400 h-full"
                                style={{ width: `${(school.sent / school.total) * 100}%` }}
                              />
                            )}
                            {school.pending > 0 && (
                              <div
                                className="bg-yellow-400 h-full"
                                style={{ width: `${(school.pending / school.total) * 100}%` }}
                              />
                            )}
                          </div>
                        </div>

                        {/* Status counts */}
                        <div className="flex items-center gap-3 text-xs">
                          {school.upgraded > 0 && (
                            <span className="text-green-600">✅ {school.upgraded} upgraded</span>
                          )}
                          {school.sent > 0 && (
                            <span className="text-blue-600">📧 {school.sent} sent</span>
                          )}
                          {school.pending > 0 && (
                            <span className="text-yellow-600">⏳ {school.pending} pending</span>
                          )}
                          <span className="ml-auto text-gray-400 font-medium">{pct}% complete</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>

            {data.schoolSummary.length === 0 && (
              <div className="text-center py-12 text-gray-400">No schools found.</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
