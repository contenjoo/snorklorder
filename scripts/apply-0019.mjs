import {Client,neonConfig} from '@neondatabase/serverless';
import {readFileSync} from 'node:fs';
neonConfig.webSocketConstructor=globalThis.WebSocket;
const apply=process.argv.includes('--apply');
if(!process.env.DATABASE_URL||(apply&&process.env.SECURITY_MIGRATION_APPLY!=='confirmed'))throw new Error('Explicit database and migration authorization required');
const client=new Client(process.env.DATABASE_URL);
try{
 await client.connect();
 const before=await client.query("SELECT to_regclass('public.upgrade_batches') IS NOT NULL AS expected_schema");
 if(!before.rows[0].expected_schema)throw new Error('Unexpected database');
 if(apply){await client.query('BEGIN');await client.query(readFileSync(new URL('../drizzle/0019_security_boundaries.sql',import.meta.url),'utf8'));await client.query('COMMIT');}
 const r=await client.query("SELECT to_regprocedure('public.confirm_teacher_batch(text,integer[])') IS NOT NULL AS confirm_function,to_regprocedure('public.verify_teacher_email(text)') IS NOT NULL AS email_function");
 console.log({applied:apply,...r.rows[0]});
}catch{await client.query('ROLLBACK').catch(()=>{});console.error('Security migration failed; credentials omitted');process.exitCode=1;}finally{await client.end();}
