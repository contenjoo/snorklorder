import { historyMessage, type AccountHistory } from "@/lib/account-history";

export function AccountHistoryNotice({ items, language = "ko" }: {
  items?: AccountHistory[]; language?: "ko" | "en";
}) {
  if (!items?.length) return null;
  return <div className="my-1 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950">
    <strong>{language === "ko" ? "같은 이메일의 이전 기록" : "Check these accounts before processing"}</strong>
    <ul className="mt-1 space-y-1">
      {items.map(item => <li key={item.email} className="break-words">
        <span className="font-mono">{item.email}</span> — {historyMessage(item, language)}
      </li>)}
    </ul>
  </div>;
}
