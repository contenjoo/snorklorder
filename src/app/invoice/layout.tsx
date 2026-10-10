import type { Metadata } from "next";

// 본사(Jon·Cailie)가 보는 화면 — 브라우저 탭 제목도 영어로.
export const metadata: Metadata = { title: "Snorkl Invoice Ledger" };

export default function InvoiceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
