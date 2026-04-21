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
}

const TYPE_LABELS: Record<string, string> = {
  upgrade: "Account Upgrade",
  email_change: "Email Change",
  type_change: "Account Type Change",
  extension: "Account Extension",
};

export default function AccountConfirmPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [req, setReq] = useState<AccountRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`/api/account-confirm/${token}`)
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
      const res = await fetch(`/api/account-confirm/${token}`, { method: "POST" });
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

        {req.notes && (
          <div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-1">Notes</div>
            <div className="text-sm text-gray-700 whitespace-pre-wrap">{req.notes}</div>
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
