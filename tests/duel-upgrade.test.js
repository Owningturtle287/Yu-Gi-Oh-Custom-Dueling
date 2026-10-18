import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeCard} from '../src/core.js';
import {loadNativeRules} from '../src/duel/native-loader.js';
import {createNativeBackend} from '../src/duel/native-engine.js';
import {describeNative} from '../src/duel/native-prompts.js';
import {readDuelSaves,saveDuel,deleteDuelSave} from '../src/duel/saves.js';
import {damageDuel,advanceBattle,command,selectCard} from './battle-fixtures.js';
const rules=await loadNativeRules({fetchImpl:async u=>new Response(await readFile(u)),wasmBinary:await readFile(new URL('../vendor/ocgcore/lib/ocgcore.sync.wasm',import.meta.url))});
const cards=JSON.parse(await readFile(new URL('./rules-fixtures.json',import.meta.url))).data.map(normalizeCard);
for(const [id,type,desc] of [[9076207,'Flip Effect Monster','Required Flip effect: reveal the target; destroy it if it is a Spell.'],[94773007,'Effect Monster','Call the coin when attacking. A wrong call costs half your LP.'],[60082869,'Trap Card','Destroy an opposing Spell/Trap, then optionally Set a Spell/Trap from your hand.'],[19159413,'Spell Card','Reveal a Set target. Destroy it only if it is a Spell.'],[93920745,'Flip Effect Monster','FLIP: You can return up to two monsters to their hands.']]){
  const r=rules.records.get(id);cards.push({id,name:r.name,type,desc,atk:r.attack,def:r.defense,level:r.level,race:type.includes('Monster')?'Warrior':'Normal',card_images:[]});
}
const get=name=>cards.find(c=>c.name===name),backend=()=>createNativeBackend({rules:()=>rules}),decks=()=>[0,1].map(()=>({name:'Upgrade regression',main:Array(40).fill(get('Mystical Elf')),extra:[]}));
test('native description IDs decode the pinned 20-bit layout and standard coin choices',()=>{
  assert.equal(describeNative(rules.records,(60082869n<<20n)), 'Set 1 Card?');
  assert.equal(describeNative(rules.records,(94773007n<<20n)), 'Coin toss');
  assert.equal(describeNative(rules.records,60),'Heads');assert.equal(describeNative(rules.records,61),'Tails');
});
test('De-Spell reveals a Set Trap without destroying or activating it',async()=>{
  const e=backend();let s=await e.createMatch(decks(),{cards,seed:73,openingHands:[[get('De-Spell')],[]],initialFields:[{},{spells:[{card:get('Mirror Force'),faceUp:false}]}]});try{
    const trap=s.players[1].spells.find(Boolean).uid;s=command(e,s,'ACTIVATE',0,'De-Spell');s=selectCard(e,s,trap);
    s=advanceBattle(e,s,x=>x.log.some(l=>l.effectNotice?.stage==='reveal'));
    assert.equal(s.players[1].spells.find(c=>c?.uid===trap).faceUp,false);assert.ok(!s.players[1].grave.some(c=>c.uid===trap));
    const notice=s.log.find(l=>l.effectNotice?.stage==='reveal').effectNotice;assert.equal(notice.card.name,'Mirror Force');assert.match(notice.text,/not destroyed.*stays Set/);
  }finally{e.destroyMatch(s);}
});
test('Armed Ninja is required after a battle reveal, but its Set Trap target survives',async()=>{
  const e=backend();let s=await damageDuel(e,cards,{defender:'Armed Ninja',traps:['Mirror Force']});try{
    s=advanceBattle(e,s,x=>x.choice?.side===0&&x.actions[0].some(a=>a.target===x.players[0].spells.find(Boolean)?.uid));
    assert.equal(s.choice.optionalResponse,undefined);assert.match(s.choice.instructions,/Required Flip effect/);
    const trap=s.players[0].spells.find(Boolean).uid;s=selectCard(e,s,trap);s=advanceBattle(e,s,x=>x.log.some(l=>l.effectNotice?.stage==='reveal'));
    assert.equal(s.players[0].spells.find(c=>c?.uid===trap).faceUp,false);assert.equal(s.log.filter(l=>l.kind==='activate'&&/Armed Ninja/.test(l.message)).length,1);
  }finally{e.destroyMatch(s);}
});
test('a genuinely optional Penguin Soldier Flip can be declined after battle flips it',async()=>{
  const e=backend();let s=await damageDuel(e,cards,{defender:'Penguin Soldier',traps:[]});try{
    s=advanceBattle(e,s,x=>x.actions[0].some(a=>(a.type==='ACTIVATE'&&e.findCard(x,a.uid)?.card.name==='Penguin Soldier')||a.yes===false));
    assert.ok(!s.window?.forced);const pass=s.actions[0].find(a=>a.type==='PASS'||a.yes===false);assert.ok(pass);s=e.applyAction(s,pass,0);
    assert.ok(!s.log.some(l=>l.kind==='activate'&&/Penguin Soldier/.test(l.message)));
  }finally{e.destroyMatch(s);}
});
test('Jirai Gumo has named coin calls, actual toss results, and a replayable saved decision',async()=>{
  const e=backend();let s=await damageDuel(e,cards,{defendingSide:1,attacker:'Jirai Gumo',traps:[]}),restored;
  try{
    s=advanceBattle(e,s,x=>x.choice?.selectionType==='select_option');assert.deepEqual(s.actions[0].map(a=>a.label),['Heads','Tails']);assert.match(s.choice.instructions,/half.*LP/);
    const saved=e.exportMatch(s);restored=await e.restoreMatch(JSON.parse(JSON.stringify(saved)),{cards});assert.deepEqual(restored.actions[0].map(a=>a.label),['Heads','Tails']);
    s=e.applyAction(s,s.actions[0].find(a=>a.coinCall==='Heads'),0);restored=e.applyAction(restored,restored.actions[0].find(a=>a.coinCall==='Heads'),0);
    const toss=s.log.find(l=>l.coinNotice)?.coinNotice;assert.ok(toss);assert.equal(toss.called,'Heads');assert.equal(s.players[0].lp,toss.results[0]==='Heads'?8000:4000);assert.equal(restored.players[0].lp,s.players[0].lp);assert.deepEqual(e.exportMatch(restored).checkpoint,e.exportMatch(s).checkpoint);
    const bad={...saved,checkpoint:'corrupted'};await assert.rejects(()=>e.restoreMatch(bad,{cards}),/verification failed/);
  }finally{e.destroyMatch(s);e.destroyMatch(restored);}
});
test('duel saves update by identity, delete reliably, and report failed writes',()=>{
  let raw=null;const storage={getItem:()=>raw,setItem:(_,value)=>{raw=value;}};
  saveDuel(storage,{id:'one',replay:{version:1},turn:1});saveDuel(storage,{id:'one',replay:{version:1},turn:3});assert.equal(readDuelSaves(storage).length,1);assert.equal(readDuelSaves(storage)[0].turn,3);
  assert.equal(deleteDuelSave(storage,'one').length,0);assert.throws(()=>saveDuel({getItem:()=>raw,setItem(){throw Error('quota');}},{id:'two',replay:{version:1}}),/current duel is still open/);
  for(let i=0;i<5;i++)saveDuel(storage,{id:'slot'+i,replay:{version:1}});const before=raw;assert.throws(()=>saveDuel(storage,{id:'sixth',replay:{version:1}}),/free a slot/);assert.equal(raw,before,'Saving a sixth duel cannot silently delete an existing checkpoint');
});
test('Dust Tornado explains its optional Set step and either branch preserves the completed destruction',async()=>{
  for(const yes of [true,false]){
    const e=backend();let s=await damageDuel(e,cards,{traps:['Dust Tornado'],opponentTraps:['Mirror Force'],hand:['Mystical Space Typhoon']});try{
      s=command(e,s,'ACTIVATE',0,'Dust Tornado');s=selectCard(e,s,s.players[1].spells.find(Boolean).uid);
      s=advanceBattle(e,s,x=>x.choice?.selectionType==='select_yesno');assert.match(s.choice.title,/Dust Tornado.*Set a card/);assert.match(s.choice.instructions,/destroyed.*Set 1 Spell\/Trap/);assert.deepEqual(s.actions[0].map(a=>a.label),['Set a Spell/Trap','Finish without Setting']);
      s=e.applyAction(s,s.actions[0].find(a=>a.yes===yes),0);
      if(yes)s=selectCard(e,s,s.players[0].hand.find(c=>c.card.name==='Mystical Space Typhoon').uid);
      assert.ok(s.players[1].grave.some(c=>c.card.name==='Mirror Force'));assert.equal(s.players[0].spells.some(c=>c?.card.name==='Mystical Space Typhoon'),yes);assert.equal(s.players[0].hand.some(c=>c.card.name==='Mystical Space Typhoon'),!yes);
    }finally{e.destroyMatch(s);}
  }
});
