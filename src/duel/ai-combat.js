import {hiddenBeliefs} from './ai-memory.js';
import {locate,attack,defense,monsters,backrow,combatTraits,resourceValue} from './ai-knowledge.js';
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));

// A bounded combat search, not a second rules engine. Candidate declarations
// still come from the core. Replan after every response/stat change/attack.
export function battleOutcome(state,side,attacker,target){
  const at=combatTraits(attacker),dt=combatTraits(target),foe=state.players[1-side];
  let atk=attack(attacker),ownDamage=0,enemyDamage=0,ownLost=false,enemyLost=false;
  if(backrow(foe).some(c=>c.faceUp&&!c.disabled&&c.card.name==='Mirror Wall'))atk=Math.floor(atk/2);
  let uncertainty=0;
  if(!target)enemyDamage=atk;
  else{
    // Unknown face-downs all use the same prior, regardless of their real ID.
    const hidden=target.hidden,defending=target.position==='defense';
    const beliefs=hidden?hiddenBeliefs(state):null;
    const power=hidden?beliefs.reduce((n,r)=>n+(defending?r.def:r.atk)*r.probability,0):defending?defense(target):attack(target);
    const delta=atk-power;
    enemyLost=delta>0&&!dt.indestructible;
    ownLost=!defending&&(delta<0||delta===0&&!at.indestructible)&&!at.indestructible;
    if(!defending&&delta===0)enemyLost=!dt.indestructible;
    if(delta>0&&(!defending||at.pierce))enemyDamage=delta;
    if(delta<0)ownDamage=-delta;
    if(dt.reflect)ownDamage+=atk;
    if(dt.revenge&&enemyLost)ownLost=true;
    if(at.revenge&&ownLost)enemyLost=true;
    if(dt.bounce)ownLost=true; // lost tempo, conservatively valued as losing field material
    if(hidden){
      const wins=beliefs.reduce((n,r)=>n+((defending?r.def:r.atk)<atk?r.probability:0),0);
      enemyLost=wins>=.55;ownDamage=beliefs.reduce((n,r)=>n+Math.max(0,(defending?r.def:r.atk)-atk)*r.probability,0);
      uncertainty=80+resourceValue(state,side,attacker)*.10+(1-wins)*150;
      if(!defending)ownLost=wins<.5;
      // Expected material gain must not become certainty just because the
      // search uses a representative board for subsequent attacks.
      var hiddenGain=resourceValue(state,side,target)*wins;
    }
  }
  if(at.halfDamage)enemyDamage=Math.floor(enemyDamage/2);
  const protectedSide=who=>(state.turnEffects||[]).some(e=>e.side===who&&e.name==='Waboku');
  if(protectedSide(1-side)){enemyDamage=0;enemyLost=false;hiddenGain=0;}
  if(protectedSide(side)){ownDamage=0;ownLost=false;}
  let value=(target?.hidden?hiddenGain:enemyLost?resourceValue(state,side,target):0)-(ownLost?resourceValue(state,side,attacker):0);
  value+=enemyDamage*.38-ownDamage*.6-uncertainty;
  if(target&&!enemyLost&&!ownLost&&!enemyDamage&&!ownDamage)value-=35;
  return {ownDamage,enemyDamage,ownLost,enemyLost,uncertainty,value};
}
export function battlePlan(state,side,{first=null,targets=null,available=null,width=36,maxNodes=6000}={}){
  const p=state.players[side],foe=state.players[1-side];
  const options=available||state.battleOptions?.length&&state.battleOptions||monsters(p).filter(c=>c.faceUp&&c.position==='attack').map(c=>({uid:c.uid,canDirect:combatTraits(c).direct}));
  const fighters=options.map(o=>({card:locate(state,o.uid),direct:o.canDirect})).filter(o=>o.card&&o.card.position==='attack');
  const enemies=monsters(foe),enemyByUID=new Map(enemies.map(c=>[c.uid,c]));
  const maxDepth=Math.min(7,fighters.reduce((n,f)=>n+Math.min(2,combatTraits(f.card).attacks),0));
  const start={remaining:fighters.map(f=>({uid:f.card.uid,count:Math.max(1,Math.min(2,combatTraits(f.card).attacks)-(state.attacksUsed?.[f.card.uid]||0))})),enemies:enemies.map(c=>c.uid),lp:p.lp,enemyLP:foe.lp,score:0,uncertain:false,moves:[]};
  let frontier=[start],best=start,nodes=0;const roots=new Map(),outcomes=new Map();
  search:for(let depth=0;depth<maxDepth&&frontier.length;depth++){
    const candidates=[];
    for(const node of frontier){
      for(const fighter of fighters){
        const remaining=node.remaining.find(r=>r.uid===fighter.card.uid);if(!remaining?.count||depth===0&&first&&fighter.card.uid!==first)continue;
        const choices=node.enemies.map(uid=>enemyByUID.get(uid));if(!choices.length||fighter.direct)choices.push(null);
        for(const target of choices){
          if(depth===0&&targets&&!targets.has(target?.uid||null))continue;
          if(nodes>=maxNodes)break search;
          const outcomeKey=fighter.card.uid+':'+(target?.uid||'direct');
          if(!outcomes.has(outcomeKey))outcomes.set(outcomeKey,battleOutcome(state,side,fighter.card,target));
          const outcome=outcomes.get(outcomeKey),lp=node.lp-outcome.ownDamage,enemyLP=node.enemyLP-outcome.enemyDamage;
          let score=node.score+outcome.value;
          const uncertain=node.uncertain||!!target?.hidden;
          if(lp<=0)score-=1000000;else if(enemyLP<=0)score+=uncertain?15000:1000000;
          const move={uid:fighter.card.uid,target:target?.uid||null,outcome};
          const next={remaining:node.remaining.map(r=>r.uid===fighter.card.uid?{...r,count:outcome.ownLost?0:r.count-1}:r),enemies:outcome.enemyLost?node.enemies.filter(uid=>uid!==target.uid):node.enemies,lp,enemyLP,score,uncertain,moves:[...node.moves,move]};
          nodes++;
          const root=next.moves[0],key=root.uid+':'+(root.target||'direct');
          if(!roots.has(key)||roots.get(key).score<score)roots.set(key,next);
          if(score>best.score||score===best.score&&next.moves.length<best.moves.length)best=next;
          // Negative sacrifices may be worthwhile if they open a lethal follow-up.
          if(lp>0&&enemyLP>0&&score>-3000)candidates.push(next);
        }
      }
    }
    // Collapse equivalent boards so a different order doesn't consume the beam.
    const unique=new Map();for(const node of candidates){const key=node.remaining.map(r=>r.uid+':'+r.count).join(',')+'|'+node.enemies.join(',')+'|'+node.lp+'|'+node.enemyLP;const old=unique.get(key);if(!old||node.score>old.score)unique.set(key,node);}
    frontier=[...unique.values()].sort((a,b)=>b.score-a.score).slice(0,width);
  }
  return {score:best.score,moves:best.moves,first:best.moves[0]||null,roots,nodes};
}
export function incomingDamage(state,side){
  const p=state.players[side],foe=state.players[1-side],ours=monsters(p),theirs=monsters(foe).filter(c=>c.faceUp);
  if(!ours.length)return theirs.reduce((n,c)=>n+attack(c),0);
  return theirs.reduce((n,c)=>n+Math.max(0,...ours.map(target=>{
    const o=battleOutcome(state,1-side,c,target);return o.enemyDamage;
  })),0);
}
