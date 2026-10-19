"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { partnerOrderLocked, partnerOrderVersion, type PartnerOrderRow } from "@/lib/partner-order-admin";

export default function PartnerOrderDialog({ rows, onClose, onSaved }: {
  rows: (PartnerOrderRow & { partnerRequestId: string | null; billingCycleId: number | null })[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [schoolName, setSchoolName] = useState(rows[0].schoolName);
  const [schoolNameEn, setSchoolNameEn] = useState(rows[0].schoolNameEn || "");
  const [items, setItems] = useState(rows.map((row) => ({ id: row.id, teacherName: row.teacherName || "", subject: row.subject || "", emails: row.emails })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const locked = partnerOrderLocked(rows) || rows.some((row) => row.billingCycleId);
  async function submit(deleting: boolean) {
    if (busy || locked) return;
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/admin/partner-orders/${encodeURIComponent(rows[0].partnerRequestId!)}`, {
        method: deleting ? "DELETE" : "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: partnerOrderVersion(rows), schoolName, schoolNameEn, items }),
      });
      const result = await res.json();
      if (!res.ok) { setError(result.error || "주문 변경에 실패했습니다."); return; }
      onSaved(deleting ? "✓ 협력사 주문 삭제 완료" : "✓ 협력사 주문 수정 완료");
    } catch { setError("연결을 확인한 뒤 다시 시도해 주세요."); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={(value) => { if (!value && !busy) onClose(); }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>협력사 주문 수정·삭제</DialogTitle>
        <DialogDescription>이 서비스의 신청 정보를 수정합니다. 삭제한 신청은 목록과 본사 처리 대상에서 제외되며 이력은 보존됩니다. Market의 주문 정보는 변경되지 않습니다.</DialogDescription>
      </DialogHeader>
      {locked && <p role="alert" className="text-sm text-amber-800">본사 발송 또는 청구가 시작된 주문은 수정·삭제할 수 없습니다. 처리 이력을 먼저 확인해 주세요.</p>}
      <fieldset disabled={busy || Boolean(locked)} className="space-y-3">
        <label className="block text-sm">학교명<Input value={schoolName} onChange={(e) => setSchoolName(e.target.value)} maxLength={200} /></label>
        <label className="block text-sm">영문 학교명<Input value={schoolNameEn} onChange={(e) => setSchoolNameEn(e.target.value)} maxLength={200} /></label>
        {items.map((item, index) => <div key={item.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
          {([['teacherName', '교사명'], ['subject', '과목'], ['emails', '계정 이메일']] as const).map(([key, label]) =>
            <label key={key} className={`text-sm ${key === "emails" ? "sm:col-span-2" : ""}`}>{label}
              <Input type={key === "emails" ? "email" : "text"} value={item[key]} onChange={(e) => setItems((prev) => prev.map((row, i) => i === index ? { ...row, [key]: e.target.value } : row))} />
            </label>)}
        </div>)}
      </fieldset>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {confirmDelete && <p role="alert" className="text-sm text-red-700">{rows[0].schoolName}의 신청 {rows.length}명을 모두 삭제할까요?</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" disabled={busy} onClick={onClose}>닫기</Button>
        <Button variant="outline" disabled={busy || Boolean(locked)} onClick={() => confirmDelete ? submit(true) : setConfirmDelete(true)} className="text-red-700">{confirmDelete ? "주문 전체 삭제 확인" : "주문 삭제"}</Button>
        <Button disabled={busy || Boolean(locked) || confirmDelete} onClick={() => submit(false)}>{busy ? "처리 중…" : "수정 저장"}</Button>
        {confirmDelete && <Button variant="outline" disabled={busy} onClick={() => setConfirmDelete(false)}>삭제 취소</Button>}
      </div>
    </DialogContent>
  </Dialog>;
}
