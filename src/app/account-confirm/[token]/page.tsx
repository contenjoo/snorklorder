"use client";

import { use, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface AccountRequest {
  id: number;
  applicantType: string;
  type: string;
  schoolName: string;
  schoolNameEn: string | null;
  emails: string;
  accountType: string | null;
  quantity: number | null;
  oldEmail: string | null;
  fromType: string | null;
  extensionDate: string | null;
  notes: string | null;
  status: string;
  confirmedAt: string | null;
  channel: string;
  teacherName: string | null;
  subject: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  upgrade: "Account Upgrade",
  email_change: "Email Change",
  type_change: "Account Type Change",
  extension: "Account Extension",
};

interface SiblingRequest {
  id: number;
  type: string;
  applicantType: string;
  emails: string;
  accountType: string | null;
  quantity: number | null;
  status: string;
  notes: string | null;
  createdAt: string;
  teacherName: string | null;
  subject: string | null;
}

export default function AccountConfirmPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [req, setReq] = useState<AccountRequest | null>(null);
  const [siblings, setSiblings] = useState<SiblingRequest[]>([]);
  const [includeSiblings, setIncludeSiblings] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`/api/account-confirm/${token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else {
          setReq(data.request);
          setSiblings(data.siblings || []);
          setIncludeSiblings(new Set((data.siblings || []).map((s: SiblingRequest) => s.id)));
        }
      })
      .catch(() => setError("Failed to load request"))
      .finally(() => setLoading(false));
  }, [token]);

  async function confirm() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/account-confirm/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alsoConfirmIds: Array.from(includeSiblings) }),
      });
      const data = await res.json();
      if (data.success) {
        setDone(true);
        if (req) setReq({ ...req, status: "processed" });
      } else {
        setError(data.error || "Failed to confirm");
      }
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="p-8 text-center text-gray-400">Loading...</div>;
  if (error) return <div className="p-8 text-center text-red-600">{error}</div>;
  if (!req) return null;

  const alreadyConfirmed = req.status === "processed" || req.status === "invoiced" || req.status === "paid" || !!req.confirmedAt;
  const emails = req.emails.split(/[,;\n]+/).map((e) => e.trim()).filter(Boolean);
  const displayName = req.schoolNameEn || req.schoolName;

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-xl mx-auto bg-white rounded-2xl shadow-sm border p-6 space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center">
            <span className="text-white text-xs font-bold">S</span>
          </div>
          <h1 className="text-lg font-bold">Snorkl — Upgrade Confirmation</h1>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-gray-400 uppercase tracking-wider font-medium">
            {req.applicantType === "individual" ? "Individual" : "School"}
          </div>
          <div className="text-xl font-bold text-gray-900">{displayName}</div>
          {req.schoolNameEn && req.schoolName !== req.schoolNameEn && (
            <div className="text-sm text-gray-500">{req.schoolName}</div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-0.5">Request</div>
            <div className="text-gray-900">{TYPE_LABELS[req.type] || req.type}</div>
          </div>
          {req.type === "upgrade" && (
            <>
              <div>
                <div className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-0.5">Account Type</div>
                <div className="text-gray-900">{req.accountType}</div>
              </div>
              <div>
                <div className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-0.5">Quantity</div>
                <div className="text-gray-900">{req.quantity || 1}</div>
              </div>
            </>
          )}
          {req.type === "extension" && req.extensionDate && (
            <div className="col-span-2">
              <div className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-0.5">Extend Until</div>
              <div className="text-gray-900">{req.extensionDate}</div>
            </div>
          )}
          {req.type === "email_change" && req.oldEmail && (
            <div className="col-span-2">
              <div className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-0.5">Old Email</div>
              <div className="text-gray-900 font-mono text-xs">{req.oldEmail}</div>
            </div>
          )}
        </div>

        <div>
          <div className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-1">
            {req.type === "email_change" ? "New Email" : "Email(s)"} ({emails.length})
          </div>
          <div className="bg-gray-50 rounded-lg p-3 font-mono text-xs space-y-0.5 max-h-48 overflow-y-auto">
            {emails.map((e, i) => <div key={i}>{e}</div>)}
          </div>
        </div>

        {req.channel === 'partner' && (
          <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-sm">
            <div className="font-semibold text-cyan-900">Sales partner request</div>
            <div className="mt-1 text-cyan-800">Teacher: {req.teacherName || '—'}</div>
            <div className="text-cyan-800">Subject: {req.subject || '—'}</div>
          </div>
        )}

        {req.notes && (
          <div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-1">Notes</div>
            <div className="text-sm text-gray-700 whitespace-pre-wrap">{req.notes}</div>
          </div>
        )}

        {siblings.length > 0 && !done && !alreadyConfirmed && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-amber-600">📦</span>
              <div className="text-sm font-semibold text-amber-900">{siblings.length}건의 다른 처리 대기 요청 ({displayName})</div>
            </div>
            <p className="text-xs text-amber-800">동시에 처리하실 거면 체크 유지하세요. 함께 status=processed 됩니다.</p>
            <div className="space-y-1.5">
              {siblings.map((s) => (
                <label key={s.id} className="flex items-start gap-2 p-2 rounded bg-white border border-amber-100 cursor-pointer hover:bg-amber-50/50">
                  <input
                    type="checkbox"
                    checked={includeSiblings.has(s.id)}
                    onChange={() => {
                      setIncludeSiblings((prev) => {
                        const next = new Set(prev);
                        if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
                        return next;
                      });
                    }}
                    className="mt-0.5 accent-amber-600"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-gray-700">{TYPE_LABELS[s.type] || s.type} · {s.applicantType === "individual" ? "개인" : "학교"} · {s.status}</div>
                    <div className="text-[11px] font-mono text-gray-500 truncate">{s.emails}</div>
                    {req.channel === 'partner' && (
                      <div className="text-[11px] text-gray-500">{s.teacherName || '—'} · {s.subject || '—'}</div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="pt-2 border-t">
          {done || alreadyConfirmed ? (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
              <span className="text-emerald-600 text-xl">✓</span>
              <div>
                <div className="font-semibold text-emerald-900">
                  {done ? "Confirmed — Thank you!" : `Already confirmed (${req.status})`}
                </div>
                <div className="text-xs text-emerald-700">
                  The admin dashboard has been updated.
                </div>
              </div>
            </div>
          ) : (
            <Button onClick={confirm} disabled={submitting} className="w-full h-11 bg-blue-600 hover:bg-blue-700">
              {submitting ? "Submitting..." : "✓ Mark Upgrade as Done"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
