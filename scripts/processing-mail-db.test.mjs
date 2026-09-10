import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { moduleLoader } from './processing-mail-loader.mjs';
const url=process.env.JON_TEST_DATABASE_URL;
// This opt-in integration suite can only use a disposable localhost database.
test('processing mail transaction, concurrency, review and replay against isolated PostgreSQL',{skip:!url},async t=>{
 const u=new URL(url);assert.ok(['localhost','127.0.0.1'].includes(u.hostname));assert.equal(u.port,'55449');
 const schema=`jon_test_${Date.now()}`;
 const admin=new pg.Client({connectionString:url});await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`);
 const config={connectionString:url,options:`-c search_path=${schema} -c timezone=UTC`};
 const pool=new pg.Pool(config);const database=drizzle(pool);
 const mocks={'@/db':{db:database},'@/db/transaction':{createPartnerTransactionDb:()=>drizzle(new pg.Pool(config))},'./processing-mail-imap':{fetchProcessingReplies:()=>{throw new Error('No IMAP allowed in DB test');}}};
 const load=moduleLoader(mocks), table=load('@/db/schema').accountRequests;
 const columns=getTableConfig(table).columns.map(c=>`"${c.name}" ${c.getSQLType()}${c.name==='id'?' PRIMARY KEY':''}`).join(',');
 await pool.query(`CREATE TABLE account_requests (${columns})`);
 await pool.query(readFileSync(new URL('../drizzle/0020_processing_mail_sync.sql',import.meta.url),'utf8'));
 await pool.query(readFileSync(new URL('../drizzle/0020_processing_mail_sync.sql',import.meta.url),'utf8'));
 await pool.query(`CREATE FUNCTION claim_market_request_side_effects(ids integer[]) RETURNS boolean LANGUAGE sql AS $$ SELECT NOT EXISTS(SELECT 1 FROM account_requests WHERE id=ANY(ids) AND market_void_state IN ('prepared','voided')) $$`);
 const {recordProcessingReply,reviewProcessingMail}=load('@/lib/processing-mail-sync');
 const snapshot={id:222,type:'upgrade',accountType:'teacher',quantity:2,emails:'one@example.test, two@example.test'};
 const fixture=()=>({messageId:`<${Date.now()}-${Math.random()}@example.test>`,parentId:'<parent@example.test>',receivedAt:'2026-09-09T23:23:33Z',sender:'jon@snorkl.app',authenticated:true,sourceVerified:true,text:'Both accounts have been activated.',parentText:'one@example.test\ntwo@example.test',snapshots:[snapshot,{id:223,type:'extension',accountType:'teacher',quantity:1,emails:'other@example.test',extensionDate:'2027-09-11'}]});
 const seed=async(status='paid')=>{
  await pool.query(`INSERT INTO account_requests(id,school_name,emails,type,account_type,quantity,extension_date,status,confirmed_at,processing_email_sent_at,processing_email_send_started_at,partner_lifecycle_state,market_void_state,channel,notes,created_at,updated_at)
    VALUES (222,'Example High','one@example.test, two@example.test','upgrade','teacher',2,null,$1,null,now(),null,'active','active','school_store',null,now(),now()),(223,'Example Middle','other@example.test','extension','teacher',1,'2027-09-11','paid',null,now(),null,'active','active','school_store',null,now(),now())
    ON CONFLICT(id) DO UPDATE SET status=excluded.status,confirmed_at=null,market_void_state='active',processing_email_sent_at=now(),partner_lifecycle_state='active',quantity=excluded.quantity,updated_at=now()`,[status]);
 };
 process.env.PROCESSING_MAIL_SYNC_ENABLED='true';delete process.env.RECEIVER_FULFILLMENT_PAUSED;
 try {
  await t.test('dry run changes neither evidence nor requests',async()=>{await seed();const r=await recordProcessingReply(fixture(),{dryRun:true});assert.equal(r.items.find(x=>x.requestId===222).outcome,'would_apply');assert.equal((await pool.query('SELECT count(*) FROM processing_mail_evidence')).rows[0].count,'0');assert.equal((await pool.query('SELECT confirmed_at FROM account_requests WHERE id=222')).rows[0].confirmed_at,null);});
  await t.test('concurrent same message applies once and preserves paid; unrelated request stays pending',async()=>{await seed();const f=fixture();const results=await Promise.all([recordProcessingReply(f),recordProcessingReply(f)]);assert.equal(results.flatMap(r=>r.items).filter(x=>x.outcome==='applied').length,1);const rows=(await pool.query('SELECT id,status,confirmed_at FROM account_requests ORDER BY id')).rows;assert.equal(rows[0].status,'paid');assert.ok(rows[0].confirmed_at);assert.equal(rows[1].confirmed_at,null);assert.equal((await recordProcessingReply(f)).items.find(x=>x.requestId===222).outcome,'already_confirmed');});
  for(const status of ['sent','invoiced'])await t.test(`preserve billing state ${status}`,async()=>{await seed(status);await recordProcessingReply(fixture());assert.equal((await pool.query('SELECT status FROM account_requests WHERE id=222')).rows[0].status,status==='sent'?'processed':status);});
  await t.test('invalid mixed selection writes no completion',async()=>{await seed();const f=fixture();f.snapshots[0]={...snapshot,quantity:3};await recordProcessingReply(f);assert.equal((await pool.query('SELECT confirmed_at FROM account_requests WHERE id=222')).rows[0].confirmed_at,null);});
  for(const mutation of ["market_void_state='voided'","status='draft'","partner_lifecycle_state='cancelled'","processing_email_sent_at=null"]){await t.test(`blocked ${mutation}`,async()=>{await seed();await pool.query(`UPDATE account_requests SET ${mutation} WHERE id=222`);await recordProcessingReply(fixture());assert.equal((await pool.query('SELECT confirmed_at FROM account_requests WHERE id=222')).rows[0].confirmed_at,null);});}
  await t.test('pause prohibits changes; review cannot bypass it',async()=>{await seed();process.env.RECEIVER_FULFILLMENT_PAUSED='true';const f=fixture();await recordProcessingReply(f);assert.equal((await pool.query('SELECT confirmed_at FROM account_requests WHERE id=222')).rows[0].confirmed_at,null);await assert.rejects(()=>reviewProcessingMail(f.messageId,222,'confirm','test proof'));delete process.env.RECEIVER_FULFILLMENT_PAUSED;});
  await t.test('manual review is scoped and idempotent',async()=>{await seed();const f=fixture();f.text='Please check the result.';await recordProcessingReply(f);await assert.rejects(()=>reviewProcessingMail(f.messageId,999,'confirm','proof'));await reviewProcessingMail(f.messageId,222,'confirm','Verified matching account completion');assert.ok((await pool.query('SELECT confirmed_at FROM account_requests WHERE id=222')).rows[0].confirmed_at);await assert.rejects(()=>reviewProcessingMail(f.messageId,222,'confirm','duplicate'));});
  await t.test('SMTP wrapper writes snapshot before send and records stable Message-ID',async()=>{const {sendTrackedProcessingMail}=load('@/lib/processing-mail-outbox');let id;await sendTrackedProcessingMail({sendMail:async m=>{id=m.messageId;assert.equal((await pool.query('SELECT state FROM processing_mail_outbox WHERE message_id=$1',[id])).rows[0].state,'prepared');}},{to:'jon@example.test',text:'test only'},[snapshot]);assert.equal((await pool.query('SELECT state FROM processing_mail_outbox WHERE message_id=$1',[id])).rows[0].state,'sent');await assert.rejects(()=>sendTrackedProcessingMail({sendMail:async()=>{throw new Error('mock SMTP failure');}},{text:'mock'},[snapshot]));assert.equal((await pool.query("SELECT count(*) FROM processing_mail_outbox WHERE state='prepared'")).rows[0].count,'1');});
 } finally {await pool.end();await admin.end();delete process.env.PROCESSING_MAIL_SYNC_ENABLED;delete process.env.RECEIVER_FULFILLMENT_PAUSED;}
});
