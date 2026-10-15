import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
await mkdir('vendor/ocgcore/dist', { recursive:true });
await mkdir('vendor/ocgcore/lib', { recursive:true });
for (const name of await readdir('node_modules/ocgcore-wasm/dist')) {
  if (name.endsWith('.js')) await cp('node_modules/ocgcore-wasm/dist/'+name,'vendor/ocgcore/dist/'+name);
}
// ocgcore-wasm 0.1.2 prefixes sort replies with a length; this core expects
// only the permutation bytes. Keep the pinned correction reproducible.
const indexPath='vendor/ocgcore/dist/index.js';
let runtime=await readFile(indexPath,'utf8');
if(!runtime.includes('t.i8(e.order.length);'))throw new Error('Pinned sort response patch no longer matches.');
runtime=runtime.replace('t.i8(e.order.length);','');
// SUM uses mandatory cards first and complete location records; set shuffles
// use a byte count followed by separate source/destination arrays.
const sum=/case 23:return\{type:t,player:e.u8\(\),select_max:[\s\S]*?(?=;case 24:)/;
if(!sum.test(runtime))throw new Error('Pinned SUM protocol patch no longer matches.');
runtime=runtime.replace(sum,'case 23:return{type:t,player:e.u8(),select_max:e.u8(),amount:e.u32(),min:e.u32(),max:e.u32(),selects_must:Array.from({length:e.u32()},()=>({code:e.u32(),...p(e),amount:e.u32()})),selects:Array.from({length:e.u32()},()=>({code:e.u32(),...p(e),amount:e.u32()}))}');
const shuffle='case 36:return{type:t,location:e.u8(),cards:Array.from({length:e.u32()},()=>({from:p(e),to:p(e)}))}';
if(!runtime.includes(shuffle))throw new Error('Pinned set shuffle protocol patch no longer matches.');
runtime=runtime.replace(shuffle,'case 36:{let location=e.u8(),count=e.u8(),from=Array.from({length:count},()=>p(e)),to=Array.from({length:count},()=>p(e));return{type:t,location,cards:from.map((f,i)=>({from:f,to:to[i]}))}}');
// MOVE ends in a reason bitmask (core-field.cpp / core-operations.cpp).
// Upstream drops it, which loses the distinction between costs and effects.
const move='case 50:return{type:t,card:e.u32(),from:p(e),to:p(e)}';
if(!runtime.includes(move))throw new Error('Pinned MOVE reason patch no longer matches.');
runtime=runtime.replace(move,'case 50:return{type:t,card:e.u32(),from:p(e),to:p(e),reason:e.u32()}');
await writeFile(indexPath,runtime);
for (const name of ['ocgcore.sync.mjs','ocgcore.sync.wasm']) await cp('node_modules/ocgcore-wasm/lib/'+name,'vendor/ocgcore/lib/'+name);
const manifest=JSON.parse(await readFile('assets/rules/manifest.json'));
const paths=['src/duel/native-loader.js','src/duel/native-engine.js','src/duel/rules-manifest.js','assets/rules/manifest.json','assets/rules/AGPL-3.0.txt','assets/rules/CardScripts-README.md','assets/rules/THIRD_PARTY_NOTICES.md','assets/rules/CORE-LICENSE.txt','assets/rules/LUA-COPYRIGHT.txt','assets/rules/runtime-sources.json',...manifest.files.map(f=>'assets/rules/'+f.path),...(await readdir('vendor/ocgcore/dist')).filter(f=>f.endsWith('.js')).map(f=>'vendor/ocgcore/dist/'+f),'vendor/ocgcore/lib/ocgcore.sync.mjs','vendor/ocgcore/lib/ocgcore.sync.wasm'];
let worker=await readFile('sw.js','utf8');
worker=worker.split('\n').filter(line=>!line.startsWith('const RULES = ')&&line!=='SHELL.push(...RULES);').join('\n').replace(/\n{3,}/g,'\n\n');
worker=worker.replace('const shellURLs','const RULES = '+JSON.stringify(paths.map(p=>'./'+p))+';\nSHELL.push(...RULES);\nconst shellURLs');
await writeFile('sw.js',worker);
console.log('Pinned synchronous WebAssembly runtime prepared.');
