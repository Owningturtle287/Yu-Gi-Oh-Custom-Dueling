// Offline-only weight comparison. Never trains on the player's hidden cards
// or silently changes production weights. Review held-out results first.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile} from 'node:fs/promises';
import {PLANNING_WEIGHTS} from '../src/duel/ai-guidance.js';
const run=promisify(execFile);
const profiles=[
  {name:'balanced',weights:PLANNING_WEIGHTS},
  {name:'pressure',weights:{...PLANNING_WEIGHTS,damage:.4,reply:.5}},
  {name:'patient',weights:{...PLANNING_WEIGHTS,hand:.6,reply:.8}}
];
async function evaluate(profile,start){
  const {stdout}=await run(process.execPath,['scripts/bench-ai.mjs'],{env:{...process.env,AI_BENCH_SEEDS:process.env.AI_TUNE_SEEDS||'4',AI_BENCH_SEED_START:String(start),AI_WEIGHTS:JSON.stringify(profile.weights)},maxBuffer:4e6});
  const r=JSON.parse(stdout);return {matches:r.matches,wins:r.wins,losses:r.losses,draws:r.draws,winRate:r.winRate,maxDecisionMs:r.maxDecisionMs};
}
const training=[];
for(const profile of profiles){const result=await evaluate(profile,1);training.push({...profile,training:result});console.error(`${profile.name}: ${result.wins}/${result.matches}`);}
// Keep the current balanced profile on a strength tie; timing noise is not
// evidence that different strategic weights are better.
training.sort((a,b)=>b.training.winRate-a.training.winRate);
const selected=training[0],validation=await evaluate(selected,101);
const report={baseline:'v027',training,selected:selected.name,heldOut:validation,note:'Development comparison only; held-out seeds are disjoint. No production file was changed.'};
if(process.env.AI_TUNE_REPORT)await writeFile(process.env.AI_TUNE_REPORT,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
