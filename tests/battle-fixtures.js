import assert from 'node:assert/strict';

export function command(engine,state,type,side=state.active,name){
  const action=state.actions[side].find(a=>a.type===type&&(!name||engine.findCard(state,a.uid)?.card.name===name));
  assert.ok(action,`Legal ${type} ${name||''} for side ${side}`);
  return engine.applyAction(state,action,side);
}
export function advanceBattle(engine,state,until){
  for(let n=0;n<120;n++){
    if(until(state))return state;
    assert.equal(state.winner,null,'The duel must still be in progress');
    const side=state.actions[0].length?0:1,actions=state.actions[side];
    const action=actions.find(a=>a.type==='PASS')||(state.choice?engine.chooseAIAction(state,side,'hard'):actions.find(a=>a.type==='END'));
    assert.ok(action,`Can advance ${state.phase} / ${state.battleStep}`);state=engine.applyAction(state,action,side);
  }
  assert.fail('Battle checkpoint did not arrive');
}
export function selectCard(engine,state,uid){
  const side=state.choice.side,action=state.actions[side].find(a=>a.target===uid);
  assert.ok(action,`Card ${uid} is a legal choice`);state=engine.applyAction(state,action,side);
  const finish=state.actions[side].find(a=>a.finish);assert.ok(finish,'Selection can be confirmed');
  return engine.applyAction(state,finish,side);
}
export async function damageDuel(engine,cards,{defender='Mystical Elf',attacker='Dark Magician',defendingSide=0,faceDown=true,defense=true,traps=['Castle Walls','Mystical Space Typhoon','Mirror Force'],opponentTraps=[],hand=[],seed=73,randomVersion}={}){
  const get=name=>{const c=cards.find(c=>c.name===name);assert.ok(c,name);return c;},attackingSide=1-defendingSide;
  const fields=[{},{}],hands=[[],[]];hands[defendingSide]=hand.map(get);
  fields[defendingSide]={monsters:[{card:get(defender),defense,faceUp:!faceDown}],spells:traps.map(name=>({card:get(name),faceUp:false}))};
  fields[attackingSide]={monsters:[{card:get(attacker)}],spells:opponentTraps.map(name=>({card:get(name),faceUp:false}))};
  let state=await engine.createMatch([0,1].map(()=>({name:'Damage Step regression',main:Array(40).fill(get('Mystical Elf')),extra:[]})),{first:defendingSide,seed,randomVersion,cards,openingHands:hands,initialFields:fields});
  state=advanceBattle(engine,state,s=>s.active===attackingSide&&s.phase==='main1'&&!s.window&&!s.choice);
  state=command(engine,state,'NEXT',attackingSide);
  state=advanceBattle(engine,state,s=>s.actions[attackingSide].some(a=>a.type==='ATTACK'));
  state=command(engine,state,'ATTACK',attackingSide);
  state=advanceBattle(engine,state,s=>s.pending?.kind==='attack');
  return state;
}
