import pg from 'pg';
import { readFileSync } from 'node:fs';
import { loadProcessingSettings } from './processing-mail-env.mjs';
const args=process.argv.slice(2), envIndex=args.indexOf('--env-file');
if(envIndex>=0)loadProcessingSettings(args[envIndex+1]);
const apply=args.includes('--apply');
if(!process.env.DATABASE_URL || (apply && process.env.PROCESSING_MAIL_MIGRATION_APPLY!=='confirmed'))throw new Error('Explicit database and migration authorization required');
const client=new pg.Client({connectionString:process.env.DATABASE_URL});
try {
 await client.connect();
 const expected=await client.query("SELECT to_regclass('public.account_requests') IS NOT NULL AS valid");
 if(!expected.rows[0].valid)throw new Error('Unexpected database');
 if(apply){await client.query('BEGIN');await client.query(readFileSync(new URL('../drizzle/0020_processing_mail_sync.sql',import.meta.url),'utf8'));await client.query('COMMIT');}
 const result=await client.query("SELECT to_regclass('public.processing_mail_evidence') IS NOT NULL AS evidence,to_regclass('public.processing_mail_outbox') IS NOT NULL AS outbox,to_regclass('public.processing_mail_cursor') IS NOT NULL AS cursor");
 console.log({applied:apply,...result.rows[0]});
} catch {await client.query('ROLLBACK').catch(()=>{});console.error('Processing mail migration failed; credentials omitted');process.exitCode=1;} finally {await client.end();}
