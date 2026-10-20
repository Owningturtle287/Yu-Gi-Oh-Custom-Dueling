// Run with node --expose-gc. Weak references verify callback release directly,
// rather than relying on platform-specific heap-size or timing thresholds.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setImmediate} from 'node:timers/promises';
import {loadNativeRules} from '../src/duel/native-loader.js';
assert.ok(globalThis.gc,'Run this check with node --expose-gc.');
const {lib,module:m,records,scripts}=await loadNativeRules({fetchImpl:async url=>new Response(await readFile(url)),wasmBinary:await readFile(new URL('../vendor/ocgcore/lib/ocgcore.sync.wasm',import.meta.url))});
function match(){
  const reader=code=>records.get(code),reference=new WeakRef(reader);
  const handle=lib.createDuel({flags:m.OcgDuelMode.MODE_MR5,seed:[1n,2n,3n,4n],team1:{startingLP:8000,startingDrawCount:0,drawCountPerTurn:1},team2:{startingLP:8000,startingDrawCount:0,drawCountPerTurn:1},cardReader:reader,scriptReader:name=>scripts[name]||null,errorHandler:()=>{}});
  assert.ok(handle);lib.destroyDuel(handle);return reference;
}
const references=Array.from({length:120},match);
for(let i=0;i<4;i++){await setImmediate();globalThis.gc();}
const retained=references.filter(reference=>reference.deref()).length;
assert.equal(retained,0,'Destroyed matches must not retain native callback closures');
console.log(JSON.stringify({createdAndDestroyed:references.length,retainedCallbacks:retained}));
