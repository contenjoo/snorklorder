import test from 'node:test';import assert from 'node:assert/strict';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const run=promisify(execFile);
test('independent Node processes share the same IP limit despite different UA',{skip:!process.env.SECURITY_TEST_DATABASE_URL},async()=>{
 const key='process-test-'+Date.now();const results=await Promise.all(Array.from({length:6},(_,i)=>run(process.execPath,[new URL('./security-rate-worker.mjs',import.meta.url).pathname,key,'ua-'+i],{env:process.env})));
 assert.equal(results.filter(r=>JSON.parse(r.stdout).ok).length,3);
});
