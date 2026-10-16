// Paired, reproducible matches against the frozen v0.2.6 hard policy. This is a
// development benchmark; the product exposes only one AI policy.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadCards} from '../src/cards.js';
import {normalizeCard} from '../src/core.js';
import {loadNativeRules} from '../src/duel/native-loader.js';
import {createNativeBackend} from '../src/duel/native-engine.js';
import {baselineAI} from '../tests/ai-v026-baseline.js';
import {generateDeck,expandDeck,defaultSide} from '../src/duel/decks.js';
const cards=process.env.DUEL_CARD_SNAPSHOT?JSON.parse(await readFile(process.env.DUEL_CARD_SNAPSHOT,'utf8')).data.map(normalizeCard):(await loadCards()).cards;
const get=name=>{const c=cards.find(c=>c.name===name);assert.ok(c,name);return c;};
const rules=await loadNativeRules({fetchImpl:async u=>new Response(await readFile(u)),wasmBinary:await readFile(new URL('../vendor/ocgcore/lib/ocgcore.sync.wasm',import.meta.url))});
const engine=createNativeBackend({rules:()=>rules});
const names={'Gemini Elf':3,Mechanicalchaser:3,'Goblin Attack Force':3,'Spear Dragon':2,'Blade Knight':2,'D.D. Warrior Lady':2,'Exiled Force':1,'Breaker the Magical Warrior':2,Jinzo:1,'Black Luster Soldier - Envoy of the Beginning':1,'Pot of Greed':3,Raigeki:2,'Dark Hole':1,'Change of Heart':2,'Snatch Steal':1,'Monster Reborn':2,'Mystical Space Typhoon':2,'Graceful Charity':1,'Mirror Force':2,'Sakuretsu Armor':2,'Torrential Tribute':1,'Call of the Haunted':1};
const main=Object.entries(names).flatMap(([n,q])=>Array(q).fill(get(n)));assert.equal(main.length,40);
let wins=0,losses=0,draws=0,steps=0,maxDecisionMs=0;const results=[];
for(const pool of ['constructed','random'])for(let seed=Number(process.env.AI_BENCH_SEED_START||1);seed<Number(process.env.AI_BENCH_SEED_START||1)+Number(process.env.AI_BENCH_SEEDS||20);seed++)for(const newSide of [0,1]){
  const decks=pool==='constructed'?[0,1].map(()=>({name:'Equal benchmark decks',main,extra:[]})):[0,1].map(n=>expandDeck(generateDeck(cards,defaultSide(),[],seed*97+n),cards));
  let s=await engine.createMatch(decks,{seed,first:seed%2,cards}),count=0;
  try{
    while(s.winner===null&&count++<2500){
      const side=s.actions[0].length?0:1,start=performance.now(),action=side===newSide?engine.chooseAIAction(s,side):baselineAI(s,side);
      if(side===newSide)maxDecisionMs=Math.max(maxDecisionMs,performance.now()-start);

      assert.ok(action,JSON.stringify({pool,seed,newSide,phase:s.phase,choice:s.choice?.title}));s=engine.applyAction(s,action,side);
    }
    assert.notEqual(s.winner,null,JSON.stringify({pool,seed,newSide,stalled:true,choice:s.choice?.title}));
    if(s.winner==='draw')draws++;else if(s.winner===newSide)wins++;else losses++;
    steps+=count;results.push({pool,seed,newSide,winner:s.winner,turn:s.turn,actions:count});
  }finally{engine.destroyMatch(s);}
}
console.log(JSON.stringify({matches:results.length,wins,losses,draws,winRate:wins/results.length,actions:steps,maxDecisionMs:Math.round(maxDecisionMs*100)/100,results},null,2));
