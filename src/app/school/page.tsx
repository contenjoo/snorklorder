"use client";

import { useCallback, useEffect, useState } from "react";

type Teacher = {
  id: number;
  schoolId: number;
  name: string;
  email: string;
  subject: string | null;
  status: string;
  verificationStatus: string;
  emailVerifiedAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  rejectedReason: string | null;
  escalatedAt: string | null;
  createdAt: string;
};

type AccountRequest = {
  id: number;
  schoolName: string;
  schoolNameEn: string | null;
  emails: string | null;
  status: string;
  quantity: number | null;
  type: string | null;
  createdAt: string;
};

type Summary = {
  school: {
    id: number;
    name: string;
    nameEn: string | null;
    code: string;
    team: string | null;
    domain: string | null;
    allowedDomains: string | null;
  };
  teachers: Teacher[];
  counts: {
    total: number;
    unverified: number;
    emailVerified: number;
    approved: number;
    rejected: number;
    pending: number;
    sent: number;
    upgraded: number;
  };
  queue: Teacher[];
  accountRequests: AccountRequest[];
};

function fmtDate(s: string | null) {
  if (!s) return "-";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function VerificationBadge({ value }: { value: string }) {
  const map: Record<string, string> = {
    approved: "bg-green-100 text-green-800",
    email_verified: "bg-amber-100 text-amber-800",
    rejected: "bg-red-100 text-red-800",
    unverified: "bg-gray-100 text-gray-700",
  };
  const cls = map[value] ?? "bg-gray-100 text-gray-700";
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {value}
    </span>
  );
}

function StatusBadge({ value }: { value: string }) {
  return (
    <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
      {value}
    </span>
  );
}

export default function SchoolDashboardPage() {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [addInput, setAddInput] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addMsg, setAddMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/school/summary");
    if (res.status === 401) {
      window.location.href = "/school/login";
      return;
    }
    const json = (await res.json()) as Summary;
    setData(json);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const addTeachers = useCallback(async () => {
    setAddBusy(true);
    setAddMsg(null);
    try {
      const res = await fetch("/api/school/teachers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: addInput }),
      });
      if (res.status === 401) {
        window.location.href = "/school/login";
        return;
      }
      if (!res.ok) {
        let msg = "추가에 실패했습니다";
        try {
          const err = (await res.json()) as { error?: string };
          if (err?.error) msg = err.error;
        } catch {
          /* ignore parse error */
        }
        setAddMsg(msg);
        return;
      }
      const json = (await res.json()) as {
        success: boolean;
        added: number;
        duplicates: number;
      };
      setAddInput("");
      setAddMsg(
        `${json.added}명 추가됨${
          json.duplicates ? `, ${json.duplicates}명 중복 제외` : ""
        }`
      );
      await load();
    } finally {
      setAddBusy(false);
    }
  }, [addInput, load]);

  const act = useCallback(
    async (id: number, action: "approve" | "reject") => {
      let reason: string | null = null;
      if (action === "reject") {
        reason = window.prompt("거절 사유 / Rejection reason (선택)") ?? "";
      }
      setBusyId(id);
      try {
        await fetch(`/api/school/teachers/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            action === "reject" ? { action, reason } : { action }
          ),
        });
        await load();
      } finally {
        setBusyId(null);
      }
    },
    [load]
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-500">
        불러오는 중...
      </div>
    );
  }

  if (!data) return null;

  const { school, counts, queue, teachers, accountRequests } = data;
  const schoolTitle = school.nameEn
    ? `${school.nameEn} (${school.name})`
    : school.name;

  const cards: { label: string; value: number; accent: string }[] = [
    { label: "총 등록", value: counts.total, accent: "text-slate-900" },
    { label: "승인", value: counts.approved, accent: "text-green-700" },
    { label: "승인 대기", value: counts.emailVerified, accent: "text-amber-700" },
    { label: "거절", value: counts.rejected, accent: "text-red-700" },
    { label: "업그레이드", value: counts.upgraded, accent: "text-indigo-700" },
  ];

  return (
    <div className="mx-auto max-w-5xl p-6">
      {/* Header */}
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">{schoolTitle}</h1>
        <div className="mt-2 flex items-center gap-2 text-sm text-slate-600">
          <span className="rounded bg-slate-100 px-2 py-0.5 font-mono">
            {school.code}
          </span>
          {school.team && (
            <span className="rounded bg-blue-100 px-2 py-0.5 font-medium text-blue-800">
              {school.team}
            </span>
          )}
        </div>
      </header>

      {/* Summary cards */}
      <section className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="text-xs font-medium text-slate-500">{c.label}</div>
            <div className={`mt-1 text-3xl font-bold ${c.accent}`}>
              {c.value}
            </div>
          </div>
        ))}
      </section>

      {/* Add teachers (admin bulk add — auto-approved) */}
      <section className="mb-10">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-1 text-lg font-semibold text-slate-900">
            교사 일괄 추가 / Add teachers
          </h2>
          <p className="mb-4 text-sm text-slate-500">
            참여 교사 이메일을 붙여넣으면 바로 등록·승인됩니다. (관리자가 직접
            올리는 경우 — 교사 본인이 등록하는 경우는 별도 인증을 거칩니다.)
          </p>
          <textarea
            value={addInput}
            onChange={(e) => setAddInput(e.target.value)}
            placeholder="이메일을 줄바꿈 또는 쉼표로 구분해 붙여넣기"
            rows={4}
            className="w-full rounded-md border border-slate-300 p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300"
          />
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={addTeachers}
              disabled={addBusy || addInput.trim().length === 0}
              className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {addBusy ? "추가 중..." : "추가 / Add"}
            </button>
            {addMsg && (
              <span className="text-sm text-slate-600">{addMsg}</span>
            )}
          </div>
        </div>
      </section>

      {/* Pending approval queue */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">
          승인 대기 큐 / Pending approval
        </h2>
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          {queue.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">
              대기 중인 등록이 없습니다
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium">Subject</th>
                  <th className="px-4 py-2 font-medium">등록일</th>
                  <th className="px-4 py-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {queue.map((t) => (
                  <tr key={t.id}>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {t.email}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {t.subject ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {fmtDate(t.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          disabled={busyId === t.id}
                          onClick={() => act(t.id, "approve")}
                          className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                        >
                          승인
                        </button>
                        <button
                          disabled={busyId === t.id}
                          onClick={() => act(t.id, "reject")}
                          className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          거절
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* All teachers */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">
          전체 교사 / All teachers
        </h2>
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          {teachers.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">
              등록된 교사가 없습니다
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium">Subject</th>
                  <th className="px-4 py-2 font-medium">Verification</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {teachers.map((t) => (
                  <tr key={t.id}>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {t.email}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {t.subject ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      <VerificationBadge value={t.verificationStatus} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge value={t.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Group purchase billing */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">
          공동구매 정산 현황 / Group purchase billing
        </h2>
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          {accountRequests.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">
              공동구매 내역이 없습니다
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Quantity</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">생성일</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {accountRequests.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3">
                      <StatusBadge value={r.status} />
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {r.quantity ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {r.type ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {fmtDate(r.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
