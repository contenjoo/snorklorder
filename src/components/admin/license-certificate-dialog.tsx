"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import LicenseCertificate from "@/components/license-certificate";
import { buildLicenseDraft, licenseFilename, validateLicenseDraft, type LicenseDraft, type LicenseRequestSource } from "@/lib/license-certificate";

export default function LicenseCertificateDialog({ request, onClose }: {
  request: LicenseRequestSource;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => buildLicenseDraft(request));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const certificateRef = useRef<HTMLDivElement>(null);
  const printFrame = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => () => { printFrame.current?.remove(); }, []);
  const validation = validateLicenseDraft(draft);
  function update<K extends keyof LicenseDraft>(key: K, value: LicenseDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setError("");
  }

  async function output(mode: "pdf" | "print") {
    if (busy || validation || !certificateRef.current) return;
    setBusy(true);
    setError("");
    try {
      await document.fonts.ready;
      await Promise.all(Array.from(certificateRef.current.querySelectorAll("img")).map((img) => img.decode()));
      if (mode === "pdf") {
        const { generatePDF } = await import("@/lib/license-pdf");
        await generatePDF({ element: certificateRef.current, filename: licenseFilename(draft.schoolName) });
      } else {
        printFrame.current?.remove();
        const frame = document.createElement("iframe");
        frame.title = "라이선스 확인서 인쇄";
        frame.style.cssText = "position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0";
        document.body.appendChild(frame);
        printFrame.current = frame;
        const doc = frame.contentDocument;
        const win = frame.contentWindow;
        if (!doc || !win) throw new Error("인쇄 창을 열지 못했습니다.");
        doc.title = licenseFilename(draft.schoolName).replace(/\.pdf$/, "");
        doc.documentElement.lang = "ko";
        const style = doc.createElement("style");
        style.textContent = "@page{size:A4;margin:10mm}body{margin:0}*{box-sizing:border-box}p,h1{margin:0}table{break-inside:auto}tr{break-inside:avoid}thead{display:table-header-group}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}";
        doc.head.appendChild(style);
        doc.body.appendChild(doc.importNode(certificateRef.current, true));
        await doc.fonts.ready;
        await Promise.all(Array.from(doc.images).map((img) => img.decode()));
        win.addEventListener("afterprint", () => { frame.remove(); if (printFrame.current === frame) printFrame.current = null; }, { once: true });
        win.focus();
        win.print();
      }
    } catch (cause) {
      console.error("라이선스 확인서 출력 오류:", cause);
      printFrame.current?.remove();
      printFrame.current = null;
      setError("문서를 만들지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-5xl max-h-[90dvh] overflow-y-auto" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>라이선스 확인서 발급</DialogTitle>
          <DialogDescription>계정 발급 여부와 실제 사용기간을 확인한 뒤 출력해 주세요. 수정한 내용은 이 문서에만 반영돼요.</DialogDescription>
        </DialogHeader>
        <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 disabled:opacity-60">
          <label className="space-y-1 text-xs">사용기관<Input value={draft.schoolName} maxLength={120} onChange={(e) => update("schoolName", e.target.value)} /></label>
          <label className="space-y-1 text-xs">담당자 (선택)<Input value={draft.contactName} maxLength={60} onChange={(e) => update("contactName", e.target.value)} /></label>
          <label className="space-y-1 text-xs">발급일<Input type="date" value={draft.issuedAt} onChange={(e) => update("issuedAt", e.target.value)} /></label>
          <label className="space-y-1 text-xs">제품명<Input value={draft.row.productName} maxLength={120} onChange={(e) => update("row", { ...draft.row, productName: e.target.value })} /></label>
          <label className="space-y-1 text-xs">라이선스 종류<Input value={draft.row.planText} maxLength={120} onChange={(e) => update("row", { ...draft.row, planText: e.target.value })} /></label>
          <label className="space-y-1 text-xs">수량<Input value={draft.row.quantityText} maxLength={60} onChange={(e) => update("row", { ...draft.row, quantityText: e.target.value })} /></label>
          <label className="space-y-1 text-xs">사용 시작일<Input type="date" value={draft.period.start} onChange={(e) => update("period", { ...draft.period, start: e.target.value })} /></label>
          <label className="space-y-1 text-xs">사용 종료일<Input type="date" min={draft.period.start || undefined} value={draft.period.end} onChange={(e) => update("period", { ...draft.period, end: e.target.value })} /></label>
          <div className="space-y-1 text-xs">
            <label className="flex items-center gap-2"><input type="checkbox" checked={draft.showAmount} onChange={(e) => update("showAmount", e.target.checked)} />공급금액 표시 (VAT 포함)</label>
            {draft.showAmount && <><Input aria-label="공급금액 (원)" type="number" min="0" step="1" placeholder="원" value={draft.amount} onChange={(e) => update("amount", e.target.value)} /><p className="text-slate-500">학교에 공급한 원화 금액을 입력해 주세요.</p></>}
          </div>
          <label className="space-y-1 text-xs sm:col-span-2 lg:col-span-3">비고 (선택)<Textarea value={draft.note} maxLength={1500} rows={2} onChange={(e) => update("note", e.target.value)} /></label>
        </fieldset>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy || !!validation} onClick={() => output("pdf")}>{busy ? "문서 준비 중…" : "PDF 다운로드"}</Button>
          <Button variant="outline" disabled={busy || !!validation} onClick={() => output("print")}>인쇄</Button>
          {validation && <p className="text-xs text-slate-600" role="status">{validation}</p>}
          {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
        </div>
        <div className="overflow-x-auto rounded border bg-slate-100 p-2 sm:p-4" aria-label="라이선스 확인서 미리보기">
          <div ref={certificateRef} style={{ width: "794px", backgroundColor: "#fff", color: "#000", margin: "0 auto" }}>
            <LicenseCertificate snapshot={{ slug: `SNORKL-${String(request.id).padStart(6, "0")}`, formData: { schoolName: draft.schoolName, contactName: draft.contactName }, total: Number(draft.amount) || 0 }} rows={[draft.row]} period={draft.period} issuedAt={draft.issuedAt} note={draft.note} showAmount={draft.showAmount} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
