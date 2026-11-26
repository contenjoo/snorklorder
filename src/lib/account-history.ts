import { parseEmailList } from "./email-list.ts";

export interface AccountHistory {
  email: string;
  pending: boolean;
  expiry: string | null;
  schoolWide: boolean;
}

export interface HistoryTarget {
  id: number;
  emails: string | string[];
  createdAt?: Date | string;
}

interface PastRequest extends HistoryTarget {
  emails: string;
  createdAt: Date;
  oldEmail: string | null;
  type: string;
  accountType: string | null;
  status: string;
  confirmedAt: Date | null;
  extensionDate: string | null;
}

export function historyEmails(target: HistoryTarget) {
  return parseEmailList(Array.isArray(target.emails) ? target.emails.join(",") : target.emails);
}

function validExpiry(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function matchAccountHistory(
  targets: HistoryTarget[],
  requests: PastRequest[],
  registrations: { email: string; createdAt: Date }[],
) {
  const byEmail = new Map<string, PastRequest[]>();
  for (const row of requests) {
    for (const email of parseEmailList([row.emails, row.oldEmail].filter(Boolean).join(","))) {
      const matches = byEmail.get(email);
      if (matches) matches.push(row);
      else byEmail.set(email, [row]);
    }
  }
  const registeredAt = new Map<string, number>();
  for (const row of registrations) {
    const email = row.email.trim().toLowerCase();
    registeredAt.set(email, Math.min(registeredAt.get(email) ?? Infinity, row.createdAt.getTime()));
  }

  return targets.map(target => {
    const history: AccountHistory[] = [];
    const cutoff = target.createdAt ? new Date(target.createdAt).getTime() : Infinity;
    for (const email of historyEmails(target)) {
      const previous = (byEmail.get(email) ?? []).filter(row => row.id < target.id);
      const registration = registeredAt.get(email);
      if (!previous.length && (registration === undefined || registration > cutoff)) continue;
      let renewal: PastRequest | undefined;
      let pending = false;
      for (const row of previous) {
        if (!row.confirmedAt && row.status !== "processed") {
          pending = true;
        } else if (row.type === "extension" && validExpiry(row.extensionDate)) {
          const time = (row.confirmedAt ?? row.createdAt).getTime();
          const lastTime = renewal ? (renewal.confirmedAt ?? renewal.createdAt).getTime() : -Infinity;
          if (time > lastTime || (time === lastTime && row.id > (renewal?.id ?? 0))) renewal = row;
        }
      }
      history.push({ email, pending, expiry: renewal?.extensionDate ?? null, schoolWide: renewal?.accountType === "school" });
    }
    return history;
  });
}

export function historyMessage(item: AccountHistory, language: "ko" | "en") {
  if (language === "en") {
    const date = item.expiry
      ? `Previous ${item.schoolWide ? "school-wide " : ""}extension through ${item.expiry}.`
      : "Previous record found. Verify the current expiry.";
    return item.pending ? `${date} Another request has no processing confirmation.` : date;
  }
  const date = item.expiry
    ? `처리된 ${item.schoolWide ? "학교 단체 " : ""}연장 기록 · 종료일 ${item.expiry}`
    : "이전 기록 있음 · 만료일 확인 필요";
  return item.pending ? `${date} · 처리 완료가 확인되지 않은 이전 요청 있음` : date;
}
