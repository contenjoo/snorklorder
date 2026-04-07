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

  useEffect(() => {
    fetch(`/api/confirm/${token}`)
      .then((response) => response.json())
      .then((result) => {
        if (result.error) {
          setError(result.error);
          return;
        }

        setData(result);
        if (result.confirmedIds?.length) {
          setSelected(new Set(result.confirmedIds));
        }
        if (result.batch.status === "confirmed") {
          setDone(true);
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
      return;
    }
    setSelected(new Set(data.teachers.map((teacher) => teacher.id)));
  };

  const handleSubmit = async () => {
    if (selected.size === 0) return;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/confirm/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmedTeacherIds: Array.from(selected) }),
      });
      const result = await response.json();
      if (result.success) {
        setDone(true);
      } else if (result.error) {
        alert(result.error);
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

  const bySchool = new Map<string, Teacher[]>();
  for (const teacher of data.teachers) {
    if (!bySchool.has(teacher.schoolName)) bySchool.set(teacher.schoolName, []);
    bySchool.get(teacher.schoolName)!.push(teacher);
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md text-center">
          <div className="text-5xl mb-4">✅</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Confirmed!</h1>
          <p className="text-gray-500 mb-1">{selected.size} teacher(s) marked as upgraded.</p>
          <p className="text-gray-400 text-sm">Thank you, Jon! You can close this page.</p>
        </div>
      </div>
    );
  }

  const stats = data.stats;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
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

        <p className="text-gray-600 text-sm mb-4 px-1">
          Hi Jon! Please check the teachers you&apos;ve upgraded, then click <b>Confirm</b>.
        </p>

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
              {schoolTeachers.map((teacher) => (
                <label
                  key={teacher.id}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-blue-50 cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(teacher.id)}
                    onChange={() => toggle(teacher.id)}
                    className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 truncate">{teacher.email}</span>
                      {teacher.subject && (
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                          {teacher.subject}
                        </span>
                      )}
                    </div>
                    {teacher.name && teacher.name !== teacher.email.split("@")[0] && (
                      <div className="text-sm text-gray-500">{teacher.name}</div>
                    )}
                  </div>
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${
                      teacher.status === "upgraded"
                        ? "bg-green-100 text-green-700"
                        : teacher.status === "sent"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {teacher.status}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}

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
      </div>
    </div>
  );
}
