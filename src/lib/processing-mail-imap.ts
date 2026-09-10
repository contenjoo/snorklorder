import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { authenticateBillingMail } from './billing-mail-auth';
import { historicalSnapshots, type ProcessingReply, type SentRequestSnapshot } from './processing-mail';

const singleId = (value: unknown): string => typeof value === 'string' && /^<[^<>\s]+>$/.test(value.trim()) ? value.trim() : '';
const parentId = (mail: ParsedMail) => singleId(mail.inReplyTo) || singleId(Array.isArray(mail.references) ? mail.references.at(-1) : mail.references);
export async function fetchProcessingReplies(options: { newerThanDays?: number; maxPerKind?: number; messageId?: string } = {}) {
  const user = process.env.GMAIL_USER?.trim(), pass = process.env.GMAIL_APP_PASSWORD?.trim();
  if (!user || !pass) throw new Error('Gmail configuration missing');
  const started = Date.now();
  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user, pass }, logger: false, socketTimeout: 20000 });
  const trace = (stage:string) => { if(process.env.PROCESSING_MAIL_DIAGNOSTICS === 'true') console.info('[processing-mail]',stage); };
  trace('connecting');
  await client.connect();
  trace('connected');
  try {
    const boxes = await client.list();
    trace('listed mailboxes');
    const all = boxes.find(b => b.specialUse === '\\All');
    if (!all) throw new Error('Gmail All Mail unavailable');
    const lock = await client.getMailboxLock(all.path, { readOnly: true });
    try {
      const validity = String(client.mailbox && client.mailbox.uidValidity);
      const mailbox = `${user.toLowerCase()}:${all.path}`;
      const cursor = await db.execute(sql`SELECT last_uid FROM processing_mail_cursor WHERE mailbox=${mailbox} AND uid_validity=${validity}`);
      const lastUid = Number(cursor.rows[0]?.last_uid || 0);
      const since = new Date(Date.now() - Math.min(90, Math.max(1, options.newerThanDays || 14)) * 86400000);
      const limit = Math.min(40, Math.max(1, options.maxPerKind || 10));
      const uids = ((await client.search(options.messageId ? {header:{'message-id':options.messageId}} : { since, from: 'jon@snorkl.app' }, { uid: true })) || []).filter(n => options.messageId || n > lastUid).sort((a,b) => a-b);
      const selected = uids.slice(0, limit);
      trace(`found ${uids.length}, reading ${selected.length}`);
      // Persistently retry missing ancestors independently of the forward cursor.
      const retry = await db.execute(sql`SELECT message_id FROM processing_mail_evidence WHERE (incomplete=true OR EXISTS (SELECT 1 FROM processing_mail_decisions d WHERE d.message_id=processing_mail_evidence.message_id AND d.outcome='review' AND selected_ids @> jsonb_build_array(d.request_id))) AND received_at>=${since.toISOString()}::timestamptz ORDER BY updated_at LIMIT 5`);
      const read = async (uid: number) => {
        const meta = await client.fetchOne(String(uid), { size: true }, { uid: true });
        if (!meta || !meta.size || meta.size > 2_000_000) return null;
        const f = await client.fetchOne(String(uid), { source: true, labels: true, internalDate: true }, { uid: true });
        if (!f || !f.source) return null;
        return { mail: await simpleParser(f.source), sent: f.labels?.has('\\Sent') === true, receivedAt: new Date(f.internalDate || 0).toISOString() };
      };
      const cache = new Map<string, Awaited<ReturnType<typeof read>>>();
      const byId = async (id: string) => {
        if (cache.has(id)) return cache.get(id)!;
        const found = (await client.search({ header: { 'message-id': id } }, { uid: true })) || [];
        const value = found.length === 1 ? await read(found[0]) : null;
        const exact = value?.mail.messageId?.trim() === id ? value : null;
        cache.set(id, exact); return exact;
      };
      const incoming = []; const readUids:number[] = [];
      for (const uid of selected) {
        if(Date.now()-started>45000) break;
        incoming.push(await read(uid)); readUids.push(uid); trace(`read ${incoming.length}`);
      }
      if(!options.messageId) for (const r of retry.rows) incoming.push(await byId(String(r.message_id)));
      let checkpointUid=lastUid, budgetExceeded=readUids.length<selected.length;
      const replies: ProcessingReply[] = [];
      for (const [index,item] of incoming.entries()) {
        if(Date.now()-started>90000) {budgetExceeded=true;break;}
        if (!item) {budgetExceeded=true;break;}
        const m = item.mail, id = singleId(m.messageId);
        if (!id) {budgetExceeded=true;break;}
        if (replies.some(r => r.messageId === id)) continue;
        const sender = m.from?.value.length === 1 ? m.from.value[0].address?.toLowerCase() || '' : '';
        const authenticated = sender === 'jon@snorkl.app' && authenticateBillingMail(m, 'invoice');
        const pId = parentId(m);
        const reply: ProcessingReply = { messageId: id, parentId: pId, sender, authenticated, receivedAt: item.receivedAt,
          text: m.text || '', parentText: '', snapshots: [], sourceVerified: false, incomplete: false };
        if (authenticated && pId) {
          let next = pId; const visited = new Set<string>(); const snapshots = new Map<number, SentRequestSnapshot>();
          for (let depth = 0; next && depth < 8; depth++) {
            if(Date.now()-started>90000) {reply.incomplete=true;budgetExceeded=true;break;}
            if (visited.has(next)) { reply.incomplete = true; break; }
            visited.add(next);
            const ancestor = await byId(next);
            if (!ancestor) { reply.incomplete = true; break; }
            const a = ancestor.mail;
            const to = (Array.isArray(a.to) ? a.to : a.to ? [a.to] : []).flatMap(v => v.value);
            if (!ancestor.sent || a.from?.value.length !== 1 || a.from.value[0].address?.toLowerCase() !== user.toLowerCase() || !to.some(v => v.address?.toLowerCase() === 'jon@snorkl.app')) {
              reply.incomplete = true; break;
            }
            if (depth === 0) { reply.parentText = a.text || ''; reply.sourceVerified = true; }
            const saved = await db.execute(sql`SELECT snapshots FROM processing_mail_outbox WHERE message_id=${next} AND state='sent'`);
            const mapped = saved.rows[0]?.snapshots as SentRequestSnapshot[] | undefined;
            for (const snapshot of mapped || historicalSnapshots(a.text || '')) {
              const existing = snapshots.get(snapshot.id);
              if (existing && JSON.stringify(existing) !== JSON.stringify(snapshot)) { reply.incomplete = true; }
              else snapshots.set(snapshot.id, snapshot);
            }
            // A real generated request mail anchors the conversation. Never traverse its old quoted history.
            if (snapshots.size) { next = ''; break; }
            next = parentId(a);
            if (depth === 7 && next) reply.incomplete = true;
          }
          reply.snapshots = [...snapshots.values()];
          if (!reply.snapshots.length) reply.incomplete = true;
        }
        replies.push(reply);
        if(index<readUids.length)checkpointUid=readUids[index];
      }
      return { replies, incomplete: budgetExceeded || uids.length > selected.length || incoming.some(v => !v) || replies.some(r => r.incomplete),
        checkpoint: { mailbox, validity, lastUid: checkpointUid } };
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => undefined); }
}
