import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
test('destroying many native duels releases their callback closures',()=>{
  const result=JSON.parse(execFileSync(process.execPath,['--expose-gc','scripts/check-runtime-memory.mjs'],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:30000}));
  assert.equal(result.createdAndDestroyed,120);assert.equal(result.retainedCallbacks,0);
});
