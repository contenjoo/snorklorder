import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { moduleLoader } from './processing-mail-loader.mjs';
const {NextRequest,NextResponse}=createRequire(import.meta.url)('next/server');
function harness(authenticated=true){
 const calls=[];
 const load=moduleLoader({'next/server':{NextRequest,NextResponse},'@/lib/auth':{checkAuth:async()=>authenticated},'@/db':{db:{execute:async()=>({rows:[]})}},'@/lib/processing-mail-sync':{reviewProcessingMail:async(...args)=>{calls.push(args);return{ok:true};}}});
 return{route:load('@/app/api/admin/processing-mail/route'),calls};
}
test('review API authenticates both methods internally',async()=>{const h=harness(false);for(const method of ['GET','POST'])assert.equal((await h.route[method](new NextRequest('https://example.test/api/admin/processing-mail',{method}))).status,401);assert.equal(h.calls.length,0);});
test('review POST rejects missing origin and invalid input without mutation',async()=>{
 for(const [origin,body,status] of [[null,'{}',403],['https://attacker.test','{}',403],['https://example.test','{',400],['https://example.test','[]',400],['https://example.test','{"requestId":"222"}',400]]){
  const h=harness();const result=await h.route.POST(new NextRequest('https://example.test/api/admin/processing-mail',{method:'POST',headers:origin?{origin}:{},body}));assert.equal(result.status,status);assert.equal(h.calls.length,0);
 }
});
test('review POST passes exact target and note; GET validates pagination',async()=>{
 const h=harness();const result=await h.route.POST(new NextRequest('https://example.test/api/admin/processing-mail',{method:'POST',headers:{origin:'https://example.test'},body:JSON.stringify({messageId:'<reply@example.test>',requestId:222,action:'exclude',note:'Need further evidence'})}));assert.equal(result.status,200);assert.deepEqual(h.calls[0],['<reply@example.test>',222,'exclude','Need further evidence']);assert.equal((await h.route.GET(new NextRequest('https://example.test/api/admin/processing-mail?page=-1'))).status,400);
});
