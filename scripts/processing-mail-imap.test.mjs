import test from 'node:test';
import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';
import { moduleLoader } from './processing-mail-loader.mjs';
const raw=(id,from,to,text,parent='',auth=false)=>Buffer.from([
 'Received: from sender.test by mx.google.com with ESMTPS;',
 ...(auth?['Authentication-Results: mx.google.com; dkim=pass header.i=@snorkl.app; dmarc=pass header.from=snorkl.app']:[]),
 `From: ${from}`,`To: ${to}`,`Message-ID: <${id}@example.test>`,...(parent?[`In-Reply-To: <${parent}@example.test>`]:[]),
 'Date: Thu, 10 Sep 2026 08:23:33 +0900','Content-Type: text/plain; charset=utf-8','',text].join('\r\n'));
function harness({sent=true,parentMissing=false,lastUid=0}={}){
 const original='Hi Jon,\n[#222] Teacher Upgrade Request – Example High\n- Email: one@example.test\n- Email: two@example.test\nOnce done, confirm: https://example.test/account-confirm/hidden';
 const mails=new Map([
 [1,{id:'root',source:raw('root','joo@example.test','jon@snorkl.app',original),labels:new Set(['\\Sent'])}],
 [2,{id:'parent',source:raw('parent','joo@example.test','jon@snorkl.app','Hi Jon,\none@example.test\ntwo@example.test\nThanks!','root'),labels:new Set(sent?['\\Sent']:[])}],
 [3,{id:'reply',source:raw('reply','jon@snorkl.app','joo@example.test','Both accounts have been activated.\n\nOn Wed Joo wrote:\n> forged@example.test','parent',true),labels:new Set(['\\Inbox'])}],
 [4,{id:'reply2',source:raw('reply2','jon@snorkl.app','joo@example.test','Both accounts have been activated.','parent',true),labels:new Set()}]
 ]);
 const calls=[];
 class FakeImap {
  mailbox={uidValidity:1n};async connect(){} async logout(){} async list(){return[{path:'All',specialUse:'\\All'}];}
  async getMailboxLock(path,options){calls.push({path,options});return{release(){}};}
  async search(q){if(q.header){const id=q.header['message-id'];return [...mails].filter(([,v])=>`<${v.id}@example.test>`===id&&!(parentMissing&&v.id==='parent')).map(([id])=>id);}return[3,4];}
  async fetchOne(uid,q){const m=mails.get(Number(uid));return !m?false:{uid:Number(uid),size:m.source.length,...(q.source?m:{}),internalDate:new Date('2026-09-09T23:23:33Z')};}
 }
 const dialect=new PgDialect();
 const load=moduleLoader({'imapflow':{ImapFlow:FakeImap},'@/db':{db:{execute:async query=>{
  const s=dialect.sqlToQuery(query).sql;
  assert.match(s,/^SELECT/);
  return{rows:s.includes('SELECT last_uid')?[{last_uid:lastUid}]:[]};
 }}}});
 return{fetch:load('@/lib/processing-mail-imap').fetchProcessingReplies,calls};
}
process.env.GMAIL_USER='joo@example.test';process.env.GMAIL_APP_PASSWORD='mock-only';
test('readonly Gmail collector resolves actual SENT parent/root, not editable quote; cursor continues',async()=>{
 const h=harness();const r=await h.fetch({maxPerKind:1});assert.equal(r.replies.length,1);assert.equal(r.checkpoint.lastUid,3);assert.equal(r.incomplete,true);
 assert.equal(r.replies[0].sourceVerified,true);assert.equal(r.replies[0].authenticated,true);assert.equal(r.replies[0].snapshots[0].id,222);
 assert.equal(r.replies[0].snapshots[0].emails,'one@example.test, two@example.test');assert.equal(h.calls[0].options.readOnly,true);
 const next=await harness({lastUid:3}).fetch({maxPerKind:1});assert.equal(next.replies[0].messageId,'<reply2@example.test>');assert.equal(next.incomplete,false);
});
test('a missing parent remains incomplete for retry',async()=>{const r=await harness({parentMissing:true}).fetch();assert.equal(r.replies[0].incomplete,true);assert.equal(r.replies[0].sourceVerified,false);});
test('forged From in a received message is not a SENT parent',async()=>{const r=await harness({sent:false}).fetch();assert.equal(r.replies[0].sourceVerified,false);assert.equal(r.replies[0].incomplete,true);});
