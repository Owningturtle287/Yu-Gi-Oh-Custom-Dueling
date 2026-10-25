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
// TYPE was omitted from the wrapper's query decoder. Consume its payload so
// querying live Trap Monster types cannot desynchronize the following fields.
const queryAlias='else if(s===u.ALIAS&&o===4)t.alias=e.u32();';
if(!runtime.includes(queryAlias))throw new Error('Pinned TYPE query patch no longer matches.');
runtime=runtime.replace(queryAlias,queryAlias+'else if(s===u.TYPE&&o===4)t.type=e.u32();');
// QUERY_COUNTERS packs the counter type in the low uint16, then its count.
// The wrapper reversed them, displaying counter IDs as enormous totals.
const counters='let c=e.u16(),a=e.u16();t.counters[a]=c';
if(!runtime.includes(counters))throw new Error('Pinned counter query patch no longer matches.');
runtime=runtime.replace(counters,'let c=e.u16(),a=e.u16();t.counters[c]=a');
// Unknown monster stats use negative int32 sentinels, not unsigned billions.
for(const [flag,property] of [['ATTACK','attack'],['DEFENSE','defense'],['BASE_ATTACK','baseAttack'],['BASE_DEFENSE','baseDefense']]){
  const unsigned=`s===u.${flag}&&o===4)t.${property}=e.u32()`;
  if(!runtime.includes(unsigned))throw new Error('Pinned signed-stat query patch no longer matches: '+flag);
  runtime=runtime.replace(unsigned,`s===u.${flag}&&o===4)t.${property}=e.i32()`);
}
// The synchronous wrapper retains every duel's callback closures in O even
// after destroying the core handle. Those closures retain the full match and
// archive. Release them on destruction and on failed creation as well.
const create='createDuel(E){let i=++r;O.set(i,{cardReader:E.cardReader,errorHandler:E.errorHandler,scriptReader:E.scriptReader});let T=c.stackSave(),R=c.stackAlloc(4),m=c.stackAlloc(104);if(Y(a(m),{...E,ptrSize:4,cardReader:0,cardReaderPayload:i,cardReaderDone:0,cardReaderDonePayload:0,errorHandler:0,errorHandlerPayload:i,scriptReader:0,scriptReaderPayload:i,enableUnsafeLibraries:!0}),c._ocgapiCreateDuel(R,m)!=0)return null;let h=c.getValue(R,"i32");return c.stackRestore(T),{[D]:h}}';
if(!runtime.includes(create))throw new Error('Pinned callback cleanup patch no longer matches.');
runtime=runtime.replace(create,'createDuel(E){let i=++r;O.set(i,{cardReader:E.cardReader,errorHandler:E.errorHandler,scriptReader:E.scriptReader});let T=c.stackSave(),R=c.stackAlloc(4),m=c.stackAlloc(104);try{Y(a(m),{...E,ptrSize:4,cardReader:0,cardReaderPayload:i,cardReaderDone:0,cardReaderDonePayload:0,errorHandler:0,errorHandlerPayload:i,scriptReader:0,scriptReaderPayload:i,enableUnsafeLibraries:!0});if(c._ocgapiCreateDuel(R,m)!=0){O.delete(i);return null}return{[D]:c.getValue(R,"i32"),atlasCallbackId:i}}catch(error){O.delete(i);throw error}finally{c.stackRestore(T)}},destroyDuel(E){try{c._ocgapiDestroyDuel(E[D])}finally{O.delete(E.atlasCallbackId)}}');
await writeFile(indexPath,runtime);
for (const name of ['ocgcore.sync.mjs','ocgcore.sync.wasm']) await cp('node_modules/ocgcore-wasm/lib/'+name,'vendor/ocgcore/lib/'+name);
const manifest=JSON.parse(await readFile('assets/rules/manifest.json'));
const paths=['src/duel/native-loader.js','src/duel/native-engine.js','src/duel/rules-manifest.js','assets/rules/manifest.json','assets/rules/AGPL-3.0.txt','assets/rules/CardScripts-README.md','assets/rules/THIRD_PARTY_NOTICES.md','assets/rules/CORE-LICENSE.txt','assets/rules/LUA-COPYRIGHT.txt','assets/rules/runtime-sources.json',...manifest.files.map(f=>'assets/rules/'+f.path),...(await readdir('vendor/ocgcore/dist')).filter(f=>f.endsWith('.js')).map(f=>'vendor/ocgcore/dist/'+f),'vendor/ocgcore/lib/ocgcore.sync.mjs','vendor/ocgcore/lib/ocgcore.sync.wasm'];
let worker=await readFile('sw.js','utf8');
worker=worker.split('\n').filter(line=>!line.startsWith('const RULES = ')&&line!=='SHELL.push(...RULES);').join('\n').replace(/\n{3,}/g,'\n\n');
worker=worker.replace('const shellURLs','const RULES = '+JSON.stringify(paths.map(p=>'./'+p))+';\nSHELL.push(...RULES);\nconst shellURLs');
await writeFile('sw.js',worker);
console.log('Pinned synchronous WebAssembly runtime prepared.');
