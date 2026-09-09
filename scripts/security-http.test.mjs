import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import pg from 'pg';
const enabled=process.env.SECURITY_HTTP_TEST==='local';
test('local HTTP: registration, batch, CSRF, replay, DTO, rotation and shared limits',{skip:!enabled},async()=>{
 const base='http://localhost:3319';const suffix=Date.now();
 const db=new pg.Client('postgresql://contenjoo@127.0.0.1:55439/postgres');await db.connect();
 const post=(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',origin:base,...headers},body:JSON.stringify(body)});
 try{
 assert.equal((await post('/api/register',{schoolId:1,name:42,email:'bad'})).status,400);
 assert.equal((await post('/api/register/batch',{schoolId:1,emails:[42]})).status,400);
 const emails=[`batch${suffix}@school.test`,`queue${suffix}@external.test`];
 const response=await post('/api/register/batch',{schoolId:1,emails});assert.equal(response.status,200);
 const data=await response.json();assert.equal(data.approved,0);assert.equal(data.results.length,2);
 assert.ok((await db.query('SELECT verification_status,email_verified_at FROM teachers WHERE email=ANY($1)',[emails])).rows.every(r=>r.verification_status==='unverified'&&r.email_verified_at===null));
 const mails=fs.readFileSync('/private/tmp/snorkl-security-baseline/mock-mail.jsonl','utf8').trim().split('\n').map(JSON.parse);
 for(const email of emails){const m=mails.findLast(m=>m.to===email);const token=m.html.match(/register\/verify\/([a-f0-9]+)/)[1];
 assert.equal((await post('/api/register/verify',{token},{origin:'https://attacker.test'})).status,403);
 const verified=await post('/api/register/verify',{token});assert.equal(verified.status,200);assert.equal((await verified.json()).status,email.endsWith('@school.test')?'approved':'email_verified');
 assert.equal((await post('/api/register/verify',{token})).status,410);
 }
 const search=await (await fetch(base+'/api/schools/search?q='+encodeURIComponent('보안'))).json();assert.ok(search.length);assert.ok(search.every(s=>!('code'in s)));
 assert.deepEqual(await(await fetch(base+'/api/schools/search?q=%25%25')).json(),[]);
 const login=await post('/api/auth',{password:'security-test-password'});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
 const batch=await db.query("INSERT INTO upgrade_batches(token,teacher_ids,status) VALUES($1,'[]','pending') RETURNING id",['token'+suffix]);
 const rotated=await post('/api/admin/confirmation-links',{kind:'batch',id:batch.rows[0].id},{cookie});assert.equal(rotated.status,200);const fresh=await rotated.json();
 assert.equal((await fetch(base+'/api/confirm/token'+suffix)).status,404);
 assert.equal((await fetch(fresh.url.replace('/confirm/','/api/confirm/'))).status,200);
 // A different User-Agent never creates a new IP bucket.
 for(let i=0;i<10;i++){const r=await post('/api/auth',{password:'wrong'},{'user-agent':'variation-'+i});if(i<9)assert.equal(r.status,401);else assert.equal(r.status,429);}
 await db.query('ALTER TABLE security_rate_limits RENAME TO security_rate_limits_offline');
 try{assert.equal((await post('/api/auth',{password:'wrong'})).status,503);}finally{await db.query('ALTER TABLE security_rate_limits_offline RENAME TO security_rate_limits');}
 }finally{await db.end();}
});
