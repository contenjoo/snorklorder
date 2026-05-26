"use client";

import { use, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface DomainRequest {
  id: number;
  schoolName: string;
  schoolNameEn: string | null;
  domain: string;
  team: string | null;
  note: string | null;
  status: string;
  confirmedAt: string | null;
}

export default function DomainConfirmPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [req, setReq] = useState<DomainRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`/api/domain-confirm/${token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setReq(data.request);
      })
      .catch(() => setError("Failed to load request"))
      .finally(() => setLoading(false));
  }, [token]);

  async function confirm() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/domain-confirm/${token}`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setDone(true);
        if (req) setReq({ ...req, status: "done" });
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

  const alreadyDone = req.status === "done" || !!req.confirmedAt;
  const display = req.schoolNameEn || req.schoolName;

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-xl mx-auto bg-white rounded-2xl shadow-sm border p-6 space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center">
            <span className="text-white text-xs font-bold">S</span>
          </div>
          <h1 className="text-lg font-bold">Snorkl — Paid Domain Request</h1>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-gray-400 uppercase tracking-wider font-medium">Domain</div>
          <div className="text-2xl font-bold text-blue-700 font-mono">@{req.domain}</div>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-gray-400 uppercase tracking-wider font-medium">School</div>
          <div className="text-base font-semibold text-gray-900">{display}</div>
          {req.schoolNameEn && req.schoolName !== req.schoolNameEn && (
            <div className="text-sm text-gray-500">{req.schoolName}</div>
          )}
          {req.team && <div className="text-xs text-gray-500 mt-1">Team: {req.team}</div>}
        </div>

        {req.note && (
          <div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-1">Note</div>
            <div className="text-sm text-gray-700 whitespace-pre-wrap">{req.note}</div>
          </div>
        )}

        <div className="pt-2 border-t">
          {done || alreadyDone ? (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
              <span className="text-emerald-600 text-xl">✓</span>
              <div>
                <div className="font-semibold text-emerald-900">
                  {done ? "Confirmed — Thank you!" : "Already confirmed"}
                </div>
                <div className="text-xs text-emerald-700">
                  Banghyun has been notified.
                </div>
              </div>
            </div>
          ) : (
            <Button onClick={confirm} disabled={submitting} className="w-full h-11 bg-blue-600 hover:bg-blue-700">
              {submitting ? "Submitting..." : "✓ Domain Enabled as Paid"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
