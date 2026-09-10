/** Deterministic, conservative completion matching. Quoted history is never completion evidence. */
export interface SentRequestSnapshot {
  id: number; emails: string; type: string; accountType?: string | null;
  quantity?: number | null; extensionDate?: string | null;
}
export interface ProcessingReply {
  messageId: string; parentId: string; receivedAt: string; sender: string;
  authenticated: boolean; text: string; parentText: string;
  snapshots: SentRequestSnapshot[]; sourceVerified: boolean;
  gmailId?: string; incomplete?: boolean;
}
export interface CompletionPlan {
  selected: number[]; related: number[]; reason: string; evidence: string;
}
export function authoredText(text: string): string {
  const lines = text.replace(/\r/g, '').split('\n');
  const end = lines.findIndex(l => /^\s*>/.test(l) || /^\s*On .+wrote:\s*$/i.test(l)
    || /^\s*\d{4}년 .*작성/.test(l) || /^\s*-{2,}\s*(?:Original Message|Forwarded message)?/i.test(l)
    || /^\s*(?:From:|Sent:|Begin forwarded message:)/i.test(l));
  return lines.slice(0, end < 0 ? undefined : end).join('\n').trim();
}
export function emailSet(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || []))].sort();
}
export function sameEmails(a: string, b: string): boolean {
  return JSON.stringify(emailSet(a)) === JSON.stringify(emailSet(b));
}
/** Historical mapping uses real SENT messages, not the reply's editable quoted copy. */
export function historicalSnapshots(text: string): SentRequestSnapshot[] {
  const own = authoredText(text);
  const blocks = [...own.matchAll(/\[#(\d+)\]([^]*?)(?=\[#\d+\]|$)/g)];
  return blocks.flatMap(m => {
    const block = m[2].split(/Once done, confirm:/i)[0];
    const type = /Account Extension Request/i.test(block) ? 'extension' : /(?:Teacher|Student) Upgrade Request/i.test(block) ? 'upgrade' : '';
    const emails = emailSet(block);
    if (!type || !emails.length) return [];
    return [{ id: Number(m[1]), type, accountType: /Student Upgrade/i.test(block) ? 'student' : 'teacher',
      emails: emails.join(', '), quantity: emails.length,
      extensionDate: type === 'extension' ? block.match(/through\s+(\d{4}-\d{2}-\d{2})/i)?.[1] || null : null }];
  });
}
export function planProcessingReply(reply: ProcessingReply): CompletionPlan {
  const own = authoredText(reply.text);
  const related = [...new Set(reply.snapshots.map(s => s.id))];
  const reject = (reason: string): CompletionPlan => ({ selected: [], related, reason, evidence: own.slice(0, 1200) });
  if (!reply.authenticated || reply.sender.toLowerCase() !== 'jon@snorkl.app') return reject('발신 인증 실패');
  if (!reply.sourceVerified || reply.incomplete) return reject('실제 보낸메일 또는 답장 연결 확인 필요');
  // Only complete, recognized statements qualify. Unknown prose (including negations,
  // future tense and qualifications) stays in review rather than being keyword-matched.
  const statement = own.replace(/^Hi [^,\n]+,?\s*/i, '')
    .replace(/^Sorry for (?:my|the) delay[.!]\s*/i, '').trim();
  const match = statement.match(/^(Both accounts|All accounts|The account|This account|These accounts) (?:have been|has been|are|is|were|was) (activated|upgraded|extended)[.!\s✅]*$/i);
  if (!match) return reject('명확한 전체 완료 문장 확인 필요');
  // Restrict context to explicitly listed accounts in the direct parent BEFORE signature/quotes.
  const parent = authoredText(reply.parentText).split(/\n\s*(?:Thanks[!,]?|Thank you[.!]?|Banghyun|Click to schedule)/i)[0];
  const parentEmails = emailSet(parent);
  if (!parentEmails.length) return reject('직접 답장 대상 계정 없음');
  if (/^Both/i.test(match[1]) && parentEmails.length !== 2) return reject('두 계정이라는 답장과 대상 수 불일치');
  if (/^(The|This) account$/i.test(match[1]) && parentEmails.length !== 1) return reject('단일 계정 답장의 대상 불명확');
  const candidates = reply.snapshots.filter(s => emailSet(s.emails).some(e => parentEmails.includes(e)));
  if (!candidates.length) return reject('요청 번호와 계정 연결 없음');
  for (const s of candidates) {
    const addresses = emailSet(s.emails);
    if (addresses.length !== s.quantity || addresses.some(e => !parentEmails.includes(e))) return reject('요청의 일부 계정만 완료되었거나 수량 불일치');
    if ((s.type === 'extension') !== (match[2].toLowerCase() === 'extended')) return reject('요청 유형과 완료 표현 불일치');
    if (s.type === 'extension' && !s.extensionDate) return reject('연장 기간 확인 필요');
  }
  if (parentEmails.some(e => candidates.filter(s => emailSet(s.emails).includes(e)).length !== 1)) return reject('계정이 여러 요청에 연결되거나 매칭 누락');
  return { selected: candidates.map(s => s.id), related, reason: '인증된 직접 답장과 전체 계정 일치', evidence: own.slice(0, 1200) };
}
