import test from 'node:test';
import assert from 'node:assert/strict';
import {authenticateBillingMail} from '../src/lib/billing-mail-auth.ts';
import {signSchoolSession,verifySchoolSession,SCHOOL_SESSION_MAX_AGE} from '../src/lib/school-session.ts';
import {secretEquals} from '../src/lib/api-key.ts';
const good=()=>({from:{value:[{address:'cailie@snorkl.app'}]},headerLines:[{key:'received',line:'Received: from mail.sender.test by mx.google.com with ESMTPS;'},{key:'authentication-results',line:'Authentication-Results: mx.google.com; dkim=pass header.i=@snorkl.app; spf=pass smtp.mailfrom=cailie@snorkl.app; dmarc=pass header.from=snorkl.app'}]});
test('billing sender authentication rejects display-name tricks, foreign pass, forged extra blocks',()=>{
 assert.equal(authenticateBillingMail(good(),'invoice'),true);
 for(const mutate of [m=>m.from.value[0].address='snorkl.app@attacker.test',m=>m.headerLines[1].line=m.headerLines[1].line.replaceAll('snorkl.app','attacker.test'),m=>m.headerLines[1].line=m.headerLines[1].line.replace('dkim=pass','dkim=fail'),m=>m.headerLines[1].line=m.headerLines[1].line.replace('mx.google.com','attacker.test'),m=>m.headerLines.unshift(m.headerLines[0]),m=>m.headerLines.push(m.headerLines[1]),m=>m.headerLines.splice(0,1)]){const m=good();mutate(m);assert.equal(authenticateBillingMail(m,'invoice'),false);}
 const payment=good();payment.from.value[0].address='quickbooks@notification.intuit.com';payment.headerLines[1].line=payment.headerLines[1].line.replaceAll('snorkl.app','notification.intuit.com');assert.equal(authenticateBillingMail(payment,'payment'),true);
});
test('school session rejects legacy, tampered, expired and missing-secret tokens',()=>{
 const old=process.env.SCHOOL_SESSION_SECRET;
 try{process.env.SCHOOL_SESSION_SECRET='test-only-school-secret';const token=signSchoolSession(1,1800000000000);assert.equal(verifySchoolSession(token,1800000000000),1);assert.equal(verifySchoolSession('1.deadbeef'),null);assert.equal(verifySchoolSession(token+'a'),null);assert.equal(verifySchoolSession(token,1800000000000+SCHOOL_SESSION_MAX_AGE*1000),null);delete process.env.SCHOOL_SESSION_SECRET;assert.equal(verifySchoolSession(token),null);assert.throws(()=>signSchoolSession(1));}finally{if(old===undefined)delete process.env.SCHOOL_SESSION_SECRET;else process.env.SCHOOL_SESSION_SECRET=old;}
});
test('API-key equality rejects empty, wrong and variable-length secrets',()=>{assert.equal(secretEquals('abc','abc'),true);for(const v of [null,'','ab','abcd'])assert.equal(secretEquals(v,'abc'),false);assert.equal(secretEquals('abc',undefined),false);});
