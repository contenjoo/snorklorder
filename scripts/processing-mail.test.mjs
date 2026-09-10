import test from 'node:test';
import assert from 'node:assert/strict';
import { authoredText, historicalSnapshots, planProcessingReply } from '../src/lib/processing-mail.ts';
import { authenticateBillingMail } from '../src/lib/billing-mail-auth.ts';
const original = `Hi Jon,
NEW REQUESTS (2)
[#222] Teacher Upgrade Request – Example High School (2 teachers)
- Email: first@example.test
- Email: second@example.test
Once done, confirm: https://example.test/account-confirm/hidden
[#223] Account Extension Request – Example Middle School
Could you extend the third@example.test account through 2027-09-11?
Once done, confirm: https://example.test/account-confirm/hidden2
AWAITING CONFIRMATION (1)
[#196] Teacher Upgrade Request – Another School (1 teacher)
- Email: earlier@example.test
Once done, confirm: https://example.test/account-confirm/hidden3`;
export const replyFixture = () => ({messageId:'<reply@example.test>',parentId:'<followup@example.test>',sender:'jon@snorkl.app',authenticated:true,sourceVerified:true,receivedAt:'2026-09-09T23:23:33Z',
 text:'Hi Banghyun,\n\nSorry for my delay. Both accounts have been activated. ✅\n\nOn Wed, Sep 9, 2026 at 5:56 PM Joo wrote:\n> '+original,
 parentText:'Hi Jon,\nQuick update — could you let me know as soon as the two upgrades are done?\n- first@example.test\n- second@example.test\nThanks!\nBanghyun\n\n2026년 9월 9일 (수) 작성:\n> '+original,
 snapshots:historicalSnapshots(original)});
test('real conversation shape confirms only #222, never #223 or #196 in quoted history',()=>{
 const p=planProcessingReply(replyFixture());assert.deepEqual(p.selected,[222]);assert.deepEqual(p.related,[222,223,196]);
 assert.doesNotMatch(p.evidence,/third@|earlier@/);
});
test('historical snapshots keep request IDs, whole email set and extension date',()=>{
 const s=historicalSnapshots(original);assert.equal(s.length,3);assert.equal(s[1].extensionDate,'2027-09-11');assert.equal(s[0].quantity,2);
});
for(const text of ['Not yet activated.','Both accounts will be activated.','Both accounts have not been activated.','Both accounts have been activated, except the second one.','One account has been activated.','I will do it tomorrow.','Thanks!\nOn Wed Joo wrote:\n> Both accounts have been activated.']){
 test(`uncertain/quoted statement is review only: ${text}`,()=>{const r=replyFixture();r.text=text;assert.deepEqual(planProcessingReply(r).selected,[]);});
}
for(const mutate of [r=>r.authenticated=false,r=>r.sender='jon@snorkl.app.attacker.test',r=>r.sourceVerified=false,r=>r.incomplete=true,
 r=>r.parentText='first@example.test',r=>r.snapshots[0].quantity=3,r=>r.snapshots.push({...r.snapshots[0],id:999}),
 r=>r.parentText='first@example.test\nthird@example.test']){
 test('ambiguous sender, chain, scope or partial completion fails closed',()=>{const r=replyFixture();mutate(r);assert.deepEqual(planProcessingReply(r).selected,[]);});
}
test('extension requires matching completion type and a known requested date',()=>{
 const r=replyFixture();r.text='The account has been extended.';r.parentText='Could you extend third@example.test through 2027-09-11?';
 assert.deepEqual(planProcessingReply(r).selected,[223]);r.snapshots[1].extensionDate=null;assert.deepEqual(planProcessingReply(r).selected,[]);
});
test('display-name and authentication forgery fail independently of completion words',()=>{
 const headers=[{key:'received',line:'Received: from trusted by mx.google.com with ESMTPS;'},{key:'authentication-results',line:'Authentication-Results: mx.google.com; dkim=pass header.i=@snorkl.app; dmarc=pass header.from=snorkl.app'}];
 assert.equal(authenticateBillingMail({from:{value:[{address:'jon@snorkl.app'}]},headerLines:headers},'invoice'),true);
 assert.equal(authenticateBillingMail({from:{value:[{address:'jon@attacker.test'}]},headerLines:headers},'invoice'),false);
 assert.equal(authenticateBillingMail({from:{value:[{address:'jon@snorkl.app'}]},headerLines:headers.slice(1)},'invoice'),false);
});
test('authored body excludes English and Korean quote markers',()=>{assert.equal(authoredText('Done.\n\n2026년 9월 9일 작성:\n> earlier'),'Done.');});
