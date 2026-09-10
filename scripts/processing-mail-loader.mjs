import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
const root=path.resolve(import.meta.dirname,'..'), native=createRequire(import.meta.url);
export function moduleLoader(mocks={}) {
 const cache=new Map();
 function load(spec,parent=path.join(root,'entry.ts')) {
  if(Object.hasOwn(mocks,spec))return mocks[spec];
  if(!spec.startsWith('.')&&!spec.startsWith('@/'))return native(spec);
  let file=spec.startsWith('@/')?path.join(root,'src',spec.slice(2)):path.resolve(path.dirname(parent),spec);
  if(!path.extname(file))file=existsSync(file+'.ts')?file+'.ts':path.join(file,'index.ts');
  if(cache.has(file))return cache.get(file).exports;
  const mod={exports:{}};cache.set(file,mod);
  const source=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  vm.runInNewContext(source,{exports:mod.exports,module:mod,require:s=>load(s,file),process,console,Date,Buffer,URL,Request,Response,setTimeout,clearTimeout},{filename:file});return mod.exports;
 }
 return load;
}
