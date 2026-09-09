// Test-only worker: executes the real limiter SQL against an isolated local PostgreSQL.
import pg from 'pg';import ts from 'typescript';import fs from 'node:fs';import {createRequire} from 'node:module';import {PgDialect} from 'drizzle-orm/pg-core';
if(process.env.SECURITY_TEST_DATABASE_URL!=='postgresql://contenjoo@127.0.0.1:55439/postgres')throw new Error('Local test database required');
const native=createRequire(import.meta.url);const pool=new pg.Pool({connectionString:process.env.SECURITY_TEST_DATABASE_URL});
const db={execute:async query=>{const q=new PgDialect().sqlToQuery(query);return pool.query(q.sql,q.params);}};
const mod={exports:{}};const code=ts.transpileModule(fs.readFileSync(new URL('../src/lib/security.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
new Function('require','module','exports',code)(name=>name==='@/db'?{db}:native(name),mod,mod.exports);
process.env.VERCEL='1';
const result=await mod.exports.checkRateLimit({request:new Request('http://localhost/',{headers:{'user-agent':process.argv[3],'x-vercel-forwarded-for':'192.0.2.1'}}),key:process.argv[2],limit:3,windowMs:60000});
console.log(JSON.stringify(result));await pool.end();
