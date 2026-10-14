import { defaultNativeRules } from './native-loader.js';
import { findCard, PHASES, PHASE_LABELS } from './engine.js';
export { findCard, PHASES, PHASE_LABELS };

const names=['deck','hand','monsters','spells','grave','banished','extra'];
const emptyPlayer=name=>({name,lp:8000,deck:[],hand:[],monsters:Array(5).fill(null),spells:Array(5).fill(null),field:null,grave:[],banished:[],extra:[]});
const who=side=>side===0?'You':'AI';
export const stats=(_state,card)=>card?.currentStats||{atk:Math.max(0,card?.card.atk||0),def:Math.max(0,card?.card.def||0)};
export const legalActions=(state,side)=>state.winner===null?(state.actions?.[side]||[]):[];
const cardsIn=state=>state.players.flatMap(p=>[...names.flatMap(zone=>p[zone].filter(Boolean)),...(p.field?[p.field]:[])]);

// The native engine owns all rules. This adapter translates its legal prompts,
// public events and field queries into the existing arena's presentation model.
export function createNativeBackend({rules=defaultNativeRules}={}) {
  const matches=new Map();let nextMatch=0;
  async function createMatch(decks,{seed=Date.now(),first=0,lp=8000,cards=[],openingHands=null,initialFields=null}={}) {
    const pack=await rules(),{module:m,lib,records,scripts}=pack;
    const api=new Map([...cards,...(openingHands||[]).flat(),...(initialFields||[]).flatMap(p=>Object.values(p).flat().filter(Boolean).map(c=>c.card)),...decks.flatMap(d=>[...d.main,...d.extra])].map(c=>[c.id,c]));
    const byName=new Map([...records.values()].map(r=>[r.name,r]));
    const canonical=new Map(),preferred=new Map();
    for(const card of api.values()){
      const record=records.get(card.id)||byName.get(card.name);
      canonical.set(card.id,record?.code||card.id);preferred.set(record?.code||card.id,card);
    }
    const cardReader=code=>{
      if(records.has(code))return records.get(code);
      const card=api.get(code);if(!card)return null;
      return {code,alias:0,setcodes:[],type:card.type==='Normal Monster'?17:card.type==='Spell Card'?2:card.type==='Trap Card'?4:33,level:card.level||0,attack:card.atk||0,defense:card.def||0,race:m.OcgRace[card.race?.toUpperCase().replace(/[^A-Z0-9]/g,'')]||1n,attribute:m.OcgAttribute[card.attribute]||0,lscale:0,rscale:0,link_marker:0};
    };
    const errors=[];
    const handle=lib.createDuel({flags:m.OcgDuelMode.MODE_MR5|m.OcgDuelMode.TCG_SEGOC_NONPUBLIC|m.OcgDuelMode.TCG_SEGOC_FIRSTTRIGGER,seed:[BigInt(seed>>>0||1),2n,3n,4n],team1:{startingLP:lp,startingDrawCount:openingHands?0:5,drawCountPerTurn:1},team2:{startingLP:lp,startingDrawCount:openingHands?0:5,drawCountPerTurn:1},cardReader,scriptReader:name=>scripts[name]||null,errorHandler:(_type,text)=>errors.push(text)});
    if(!handle)throw new Error('The duel rules engine could not start.');
    const id='native-'+(++nextMatch),r={id,...pack,handle,api,preferred,canonical,cardReader,first,errors,reply:new Map(),epoch:0,uid:0,prompt:null,selected:[],lastAttack:null,hint:'Choose cards',sourceUid:null};
    r.side=team=>team===0?first:1-first;r.team=side=>side===first?0:1;
    r.state={version:2,runtimeId:id,players:decks.map(d=>({...emptyPlayer(d.name),lp})),turn:0,active:first,phase:'draw',seed:seed>>>0,serial:0,log:[],lastEvent:null,winner:null,chain:[],window:null,pending:null,choice:null,actions:[[],[]],visualAction:null};
    try {
      for(const f of ['constant.lua','utility.lua'])if(!lib.loadScript(handle,f,scripts[f]))throw new Error('Could not initialize '+f);
      decks.forEach((deck,side)=>{
        for(const [zone,location] of [['main',m.OcgLocation.DECK],['extra',m.OcgLocation.EXTRA]])for(const card of deck[zone])lib.duelNewCard(handle,{team:r.team(side),controller:r.team(side),duelist:0,code:canonical.get(card.id)||card.id,location,sequence:2,position:m.OcgPosition.FACEDOWN_DEFENSE});
      });
      if(openingHands)openingHands.forEach((hand,side)=>hand.forEach(card=>lib.duelNewCard(handle,{team:r.team(side),controller:r.team(side),duelist:0,code:canonical.get(card.id)||card.id,location:m.OcgLocation.HAND,sequence:0,position:m.OcgPosition.FACEDOWN_DEFENSE})));
      if(initialFields)initialFields.forEach((fields,side)=>Object.entries(fields).forEach(([zone,cards])=>cards.forEach((item,sequence)=>{if(item)lib.duelNewCard(handle,{team:r.team(side),controller:r.team(side),duelist:0,code:canonical.get(item.card.id)||item.card.id,location:zone==='monsters'?m.OcgLocation.MZONE:zone==='grave'?m.OcgLocation.GRAVE:m.OcgLocation.SZONE,sequence,position:item.defense?(item.faceUp===false?8:4):item.faceUp===false?2:1});})));
      matches.set(id,r);lib.startDuel(handle);pump(r);return r.state;
    } catch(error){lib.destroyDuel(handle);matches.delete(id);throw error;}
  }
  function log(r,message,kind='action',uids=[],side=r.state.active){const s=r.state,entry={id:++s.serial,turn:s.turn||1,phase:s.phase,side,message,kind,uids};s.log.push(entry);s.log=s.log.slice(-500);s.lastEvent=entry;}
  function cardAt(r,loc){
    if(!loc)return null;const p=r.state.players[r.side(loc.controller)],L=r.module.OcgLocation;
    return loc.location===L.SZONE&&loc.sequence===5?p.field:(p[{[L.DECK]:'deck',[L.HAND]:'hand',[L.MZONE]:'monsters',[L.SZONE]:'spells',[L.GRAVE]:'grave',[L.REMOVED]:'banished',[L.EXTRA]:'extra'}[loc.location]]||[])[loc.sequence]||null;
  }
  function descriptor(r,code){
    if(r.preferred.has(code))return r.preferred.get(code);
    const d=r.records.get(code);if(!d)return {id:code||1,name:'Unknown card',type:'Token',desc:'',card_images:[]};
    const m=r.module;
    return {id:code,name:d.name,type:d.type&m.OcgType.MONSTER?(d.type&m.OcgType.TOKEN?'Token':d.type&m.OcgType.NORMAL?'Normal Monster':'Effect Monster'):d.type&m.OcgType.TRAP?'Trap Card':'Spell Card',atk:d.attack,def:d.defense,level:d.level,race:[...Object.entries(m.OcgRace)].find(([,value])=>value===d.race)?.[0]||'',desc:'',card_images:[]};
  }
  function sync(r){
    const {lib,handle,module:m}=r,L=m.OcgLocation,Q=m.OcgQueryFlags;
    const previous=r.state.players,pool=cardsIn(r.state),used=new Set();
    const flags=Q.CODE|Q.POSITION|Q.ATTACK|Q.DEFENSE|Q.OWNER|Q.LEVEL|Q.IS_PUBLIC;
    const field=lib.duelQueryField(handle),players=previous.map(p=>({...emptyPlayer(p.name),lp:p.lp}));
    for(const side of [0,1]){
      const controller=r.team(side);players[side].lp=field.players[controller].lp;
      for(const [zone,location] of [['deck',L.DECK],['hand',L.HAND],['monsters',L.MZONE],['spells',L.SZONE],['grave',L.GRAVE],['banished',L.REMOVED],['extra',L.EXTRA]]){
        const queries=lib.duelQueryLocation(handle,{controller,location,flags});
        queries.forEach((q,index)=>{
          if(!q?.code)return;
          if(zone==='monsters'&&index>=5||zone==='spells'&&index>5)return;
          const old=zone==='spells'&&index===5?previous[side].field:previous[side][zone][index];
          const same=old?.coreCode===q.code&&!used.has(old.uid)?old:pool.find(c=>c.coreCode===q.code&&!used.has(c.uid));
          const uid=same?.uid||`${r.id}-c${++r.uid}`;used.add(uid);
          const card={uid,coreCode:q.code,card:descriptor(r,q.code),owner:r.side(q.owner??controller),controller:side,public:!!q.isPublic,faceUp:!!(q.position&m.OcgPosition.FACEUP),position:q.position&m.OcgPosition.DEFENSE?'defense':'attack',currentStats:{atk:Math.max(0,q.attack||0),def:Math.max(0,q.defense||0)}};
          if(zone==='spells'&&index===5)players[side].field=card;
          else if(zone==='monsters'||zone==='spells')players[side][zone][index]=card;
          else players[side][zone].push(card);
        });
      }
    }
    r.state.players=players;
  }
  function describe(r,value){
    const id=BigInt(value||0),code=Number(id>>4n),index=Number(id&15n);
    return r.records.get(code)?.descriptions?.[index]||({30:'Activate this effect?',31:'Continue?',93:'Attack directly?',94:'Replay this attack?'}[Number(id)])||'Choose an effect option';
  }
  function event(r,msg){
    const m=r.module,T=m.OcgMessageType,s=r.state;
    const at=cardAt(r,msg.card||msg),target=cardAt(r,msg.target);
    switch(msg.type){
      case T.RETRY:throw new Error('The rules engine rejected that selection. No fallback ruling was applied.');
      case T.NEW_TURN:s.turn++;s.active=r.side(msg.player);s.pending=null;r.lastAttack=null;log(r,`${who(s.active)} ${s.active===0?'begin':'begins'} Turn ${s.turn}.`,'phase');break;
      case T.NEW_PHASE:{const phase={[m.OcgPhase.DRAW]:'draw',[m.OcgPhase.STANDBY]:'standby',[m.OcgPhase.MAIN1]:'main1',[m.OcgPhase.BATTLE_START]:'battle',[m.OcgPhase.BATTLE_STEP]:'battle',[m.OcgPhase.DAMAGE]:'battle',[m.OcgPhase.DAMAGE_CAL]:'battle',[m.OcgPhase.BATTLE]:'battle',[m.OcgPhase.MAIN2]:'main2',[m.OcgPhase.END]:'end'}[msg.phase];if(phase&&phase!==s.phase){s.phase=phase;log(r,PHASE_LABELS[phase]+' Phase.','phase');}break;}
      case T.SET:log(r,`${who(r.side(msg.controller))} Set ${msg.location===m.OcgLocation.MZONE?'a monster':'a Spell / Trap'}.`,'set',[],r.side(msg.controller));break;
      case T.DRAW:log(r,`${who(r.side(msg.player))} drew ${msg.drawn.length} card${msg.drawn.length===1?'':'s'}.`,'draw',[],r.side(msg.player));break;
      case T.HINT:if(msg.hint_type===3){const key=[...r.scripts['constant.lua'].matchAll(/HINTMSG_(\w+)\s*=\s*(\d+)/g)].find(x=>BigInt(x[2])===msg.hint)?.[1];r.hint=key?'Select '+key.toLowerCase().replaceAll('_',' '):'Choose cards';}break;
      case T.SUMMONING:case T.SPSUMMONING:case T.FLIPSUMMONING:{const name=descriptor(r,msg.code).name;log(r,`${who(r.side(msg.controller))} ${msg.type===T.SPSUMMONING?'Special Summoned':msg.type===T.FLIPSUMMONING?'Flip Summoned':'summoned'} ${name}.`,'summon',[cardAt(r,msg)?.uid].filter(Boolean),r.side(msg.controller));break;}
      case T.CHAINING:{const card=cardAt(r,msg);r.sourceUid=card?.uid;s.chain.push({uid:card?.uid,card:descriptor(r,msg.code),side:r.side(msg.triggering_controller),action:{},rule:{op:'native'}});log(r,`${who(r.side(msg.triggering_controller))} activated ${descriptor(r,msg.code).name}.`,'activate',[card?.uid].filter(Boolean),r.side(msg.triggering_controller));break;}
      case T.CHAIN_END:s.chain=[];r.sourceUid=null;break;
      case T.CHAIN_SOLVING:log(r,'Resolving chain link '+msg.chain_size+'.','effect',s.chain[msg.chain_size-1]?.uid?[s.chain[msg.chain_size-1].uid]:[]);break;
      case T.CHAIN_NEGATED:case T.CHAIN_DISABLED:log(r,'Chain link '+msg.chain_size+' was negated.','effect');break;
      case T.ATTACK_DISABLED:s.pending=null;r.lastAttack=null;log(r,'The attack was negated.','battle');break;
      case T.DAMAGE_STEP_END:s.pending=null;r.lastAttack=null;break;
      case T.CONFIRM_CARDS:for(const item of msg.cards){const card=cardAt(r,item);if(card){s.revealedUIDs??=[];s.revealedUIDs.push(card.uid);log(r,'Revealed '+card.card.name+'.','reveal',[card.uid],r.side(item.controller));}}break;
      case T.ATTACK:r.lastAttack={kind:'attack',uid:at?.uid,target:target?.uid||null,side:at?.controller??s.active};s.pending=r.lastAttack;s.visualAction={type:'ATTACK',uid:at?.uid,target:target?.uid||null};log(r,`${at?.card.name||'A monster'} attacked ${target?.card.name||'Life Points directly'}.`,'attack',[at?.uid,target?.uid].filter(Boolean));break;
      case T.BATTLE:log(r,`Battle: ATK ${msg.card.attack}${msg.target?` vs ${msg.target.position&m.OcgPosition.DEFENSE?'DEF '+msg.target.defense:'ATK '+msg.target.attack}`:' · direct attack'}.`,'battle',[r.lastAttack?.uid,r.lastAttack?.target].filter(Boolean));break;
      case T.DAMAGE:case T.PAY_LPCOST:case T.RECOVER:log(r,`${who(r.side(msg.player))} ${msg.type===T.RECOVER?'gained':msg.type===T.PAY_LPCOST?'paid':'lost'} ${msg.amount.toLocaleString()} LP.` ,msg.type===T.RECOVER?'heal':'damage',[r.lastAttack?.uid,r.lastAttack?.target].filter(Boolean),r.side(msg.player));break;
      case T.TOSS_COIN:case T.TOSS_DICE:log(r,(msg.type===T.TOSS_COIN?'Coin toss: ':'Dice roll: ')+(msg.results||[]).join(', ')+'.','effect');break;
      case T.POS_CHANGE:if(at)log(r,at.card.name+' changed battle position.','position',[at.uid]);break;
      case T.MOVE:{const L=m.OcgLocation;if(msg.to.location===L.GRAVE||msg.to.location===L.REMOVED){const card=cardAt(r,msg.from);log(r,`${descriptor(r,msg.card).name} ${msg.to.location===L.GRAVE?'went to the Graveyard':'was banished'}.`,'leave',[card?.uid].filter(Boolean),r.side(msg.to.controller));}break;}
      case T.WIN:s.winner=msg.player===2?'draw':r.side(msg.player);log(r,s.winner==='draw'?'The duel is a draw.':who(s.winner)+' won the duel!','victory');break;
    }
  }
  function places(r,msg){const L=r.module.OcgLocation,options=[];for(const relative of [0,1])for(const [location,start] of [[L.MZONE,0],[L.SZONE,8]])for(const sequence of [2,1,3,0,4,5,6,7])if(((msg.field_mask>>>(relative*16+start+sequence))&1)===0)options.push({player:relative?1-msg.player:msg.player,location,sequence});return options;}
  function pump(r){
    const {lib,handle,module:m}=r,T=m.OcgMessageType;
    r.state.visualAction=null;r.state.window=null;r.state.choice=null;r.state.revealedUIDs=[];r.selected=[];r.sumPlan=undefined;
    for(let step=0;step<3000;step++){
      const status=lib.duelProcess(handle),messages=lib.duelGetMessage(handle);let prompt=null;
      for(const msg of messages){event(r,msg);if(selectionTypes(m).has(msg.type))prompt=msg;}
      if(r.errors.length)throw new Error('Card script error: '+r.errors.splice(0).join(' ').slice(0,240));
      if(r.state.winner!==null||status===m.OcgProcessResult.END){sync(r);r.prompt=null;actions(r);return;}
      if(status!==m.OcgProcessResult.WAITING)continue;
      if(!prompt)throw new Error('The engine requested an unknown response.');
      if(prompt.type===T.SELECT_CHAIN&&!prompt.selects.length){lib.duelSetResponse(handle,{type:m.OcgResponseType.SELECT_CHAIN,index:null});continue;}
      if(prompt.type===T.SELECT_PLACE){lib.duelSetResponse(handle,{type:m.OcgResponseType.SELECT_PLACE,places:places(r,prompt).slice(0,prompt.count)});continue;}
      if(prompt.type===T.SELECT_POSITION&&[1,2,4,8].includes(prompt.positions)){lib.duelSetResponse(handle,{type:m.OcgResponseType.SELECT_POSITION,position:prompt.positions});continue;}
      if(prompt.type===T.SELECT_COUNTER&&prompt.cards.length===1&&prompt.cards[0].count>=prompt.count){lib.duelSetResponse(handle,{type:m.OcgResponseType.SELECT_COUNTER,counters:[prompt.count]});continue;}
      r.prompt=prompt;sync(r);actions(r);return;
    }
    throw new Error('The engine exceeded its processing limit.');
  }
  function sumValues(selected){let values=new Set([0]);for(const card of selected){const a=card.amount&65535,b=card.amount>>>16;values=new Set([...values].flatMap(n=>[n+a,...(b?[n+b]:[])]));}return values;}
  function finishable(r,p,selected=r.selected){
    const T=r.module.OcgMessageType,n=selected.length;
    if(p.type===T.SELECT_SUM){const chosen=[...p.selects_must,...selected.map(i=>p.selects[i])];if(!p.select_max&&(n<p.min||n>p.max))return false;const values=sumValues(chosen);if(!p.select_max)return values.has(p.amount);const ranges=chosen.map(c=>{const a=c.amount&65535,b=c.amount>>>16;return [b?Math.min(a,b):a,Math.max(a,b)];});return ranges.reduce((n,c)=>n+c[1],0)>=p.amount&&ranges.reduce((n,c)=>n+c[0],0)-Math.min(...ranges.map(c=>c[0]))<p.amount;}
    if(p.type===T.SELECT_TRIBUTE){const total=r.selected.reduce((n,i)=>n+p.selects[i].release_param,0);return total>=p.min&&n<=p.max;}
    if(p.type===T.SELECT_COUNTER)return n===p.count;
    if(p.type===T.SELECT_DISFIELD)return n===p.count;
    if(p.type===T.SORT_CARD||p.type===T.SORT_CHAIN)return n===p.cards.length;
    return n>=p.min&&n<=p.max;
  }
  function sumPlan(r,p){
    const candidates=p.selects.map((_,i)=>i).sort((a,b)=>{const one=cardAt(r,p.selects[a]),two=cardAt(r,p.selects[b]);const cost=card=>card&&(card.controller===r.side(p.player)||card.faceUp||card.public)?card.card.atk||0:1500;return cost(one)-cost(two);});
    let budget=60000;
    const search=(chosen,start,count)=>{
      if(--budget<0)return null;
      if(!count)return finishable(r,p,chosen)?chosen:null;
      for(let i=start;i<=candidates.length-count;i++){const result=search([...chosen,candidates[i]],i+1,count-1);if(result)return result;}
      return null;
    };
    for(let count=0;count<=Math.min(candidates.length,p.select_max?candidates.length:p.max);count++){const result=search([],0,count);if(result)return result;if(budget<0)break;}
    return null;
  }
  function actions(r){
    const {module:m,prompt:p,state:s}=r,T=m.OcgMessageType,R=m.OcgResponseType;
    r.reply.clear();r.epoch++;s.actions=[[],[]];s.choice=null;s.window=null;
    if(!p||s.winner!==null)return;
    const side=r.side(p.player),out=s.actions[side];
    const add=(action,response,stage=null)=>{const id=`${r.epoch}:${out.length}`;out.push({...action,id});r.reply.set(id,{response,stage});};
    const targetName=(card,item)=>card&&(card.controller===side||card.faceUp||card.public||s.revealedUIDs?.includes(card.uid)||item.location===m.OcgLocation.GRAVE)?card.card.name:'Face-down card';
    const located=(item,type,label,response,extra={})=>{const card=cardAt(r,item);add({type,uid:card?.uid,label,...extra},response);};
    if(p.type===T.SELECT_IDLECMD){
      for(const [key,command,type,label] of [['summons',m.SelectIdleCMDAction.SELECT_SUMMON,'SUMMON','Normal Summon'],['special_summons',m.SelectIdleCMDAction.SELECT_SPECIAL_SUMMON,'SUMMON','Special Summon'],['pos_changes',m.SelectIdleCMDAction.SELECT_POS_CHANGE,'POSITION','Change position'],['monster_sets',m.SelectIdleCMDAction.SELECT_MONSTER_SET,'SUMMON','Set in Defense'],['spell_sets',m.SelectIdleCMDAction.SELECT_SPELL_SET,'SET','Set Spell / Trap'],['activates',m.SelectIdleCMDAction.SELECT_ACTIVATE,'ACTIVATE','Activate effect']])p[key].forEach((item,index)=>located(item,type,label,{type:R.SELECT_IDLECMD,action:command,index},{set:key==='monster_sets',special:key==='special_summons',tributes:[],effectText:item.description?describe(r,item.description):''}));
      if(p.to_bp)add({type:'NEXT',label:'Battle'},{type:R.SELECT_IDLECMD,action:m.SelectIdleCMDAction.TO_BP,index:null});
      else if(p.to_ep)add({type:'NEXT',label:'End'},{type:R.SELECT_IDLECMD,action:m.SelectIdleCMDAction.TO_EP,index:null});
      if(p.to_ep)add({type:'END'},{type:R.SELECT_IDLECMD,action:m.SelectIdleCMDAction.TO_EP,index:null});return;
    }
    if(p.type===T.SELECT_BATTLECMD){
      p.chains.forEach((item,index)=>located(item,'ACTIVATE','Activate effect',{type:R.SELECT_BATTLECMD,action:m.SelectBattleCMDAction.SELECT_CHAIN,index}));
      p.attacks.forEach((item,index)=>located(item,'ATTACK','Attack',{type:R.SELECT_BATTLECMD,action:m.SelectBattleCMDAction.SELECT_BATTLE,index},!s.players[1-side].monsters.some(Boolean)&&item.can_direct?{target:null}:{}));
      if(p.to_m2)add({type:'NEXT',label:'Main 2'},{type:R.SELECT_BATTLECMD,action:m.SelectBattleCMDAction.TO_M2,index:null});else if(p.to_ep)add({type:'NEXT',label:'End'},{type:R.SELECT_BATTLECMD,action:m.SelectBattleCMDAction.TO_EP,index:null});
      if(p.to_ep)add({type:'END'},{type:R.SELECT_BATTLECMD,action:m.SelectBattleCMDAction.TO_EP,index:null});return;
    }
    if(p.type===T.SELECT_CHAIN){
      s.window={priority:side,event:{kind:s.pending?.kind||'effect',side:s.active}};
      if(!p.forced)add({type:'PASS'},{type:R.SELECT_CHAIN,index:null});
      p.selects.forEach((item,index)=>located(item,'ACTIVATE','Respond: '+(cardAt(r,item)?.card.name||'effect'),{type:R.SELECT_CHAIN,index}));return;
    }
    const choice={side,title:r.hint,trigger:{uid:r.sourceUid,rule:{op:'native'}},options:out,selected:[],stage:false,canFinish:false};s.choice=choice;
    const option=(label,response,extra={})=>add({type:'CHOOSE',label,...extra},response);
    if(p.type===T.SELECT_EFFECTYN||p.type===T.SELECT_YESNO){choice.title=(cardAt(r,p)?.card.name?cardAt(r,p).card.name+' · ':'')+describe(r,p.description);const responseType=p.type===T.SELECT_EFFECTYN?R.SELECT_EFFECTYN:R.SELECT_YESNO;option('Yes · activate / continue',{type:responseType,yes:true},{yes:true});option('No · decline',{type:responseType,yes:false},{yes:false});return;}
    if(p.type===T.SELECT_OPTION){choice.title='Choose an effect option';p.options.forEach((desc,index)=>option(describe(r,desc),{type:R.SELECT_OPTION,index}));return;}
    if(p.type===T.SELECT_POSITION){choice.title='Choose battle position';for(const [position,label] of [[m.OcgPosition.FACEUP_ATTACK,'Attack Position'],[m.OcgPosition.FACEUP_DEFENSE,'Defense Position'],[m.OcgPosition.FACEDOWN_DEFENSE,'Set in Defense'],[m.OcgPosition.FACEDOWN_ATTACK,'Face-down Attack']])if(p.positions&position)option(label,{type:R.SELECT_POSITION,position},{defense:!!(position&m.OcgPosition.DEFENSE)});return;}
    if(p.type===T.SELECT_UNSELECT_CARD){
      choice.title=r.hint;choice.stage=true;
      [...p.select_cards,...p.unselect_cards].forEach((item,index)=>{const card=cardAt(r,item);option((index>=p.select_cards.length?'Unselect ':'Select ')+targetName(card,item),{type:R.SELECT_UNSELECT_CARD,index},{target:card?.uid,selected:index>=p.select_cards.length});if(index>=p.select_cards.length)choice.selected.push(card?.uid);});
      if(p.can_finish||p.can_cancel){option(p.can_finish?'Confirm selection':'Cancel effect',{type:R.SELECT_UNSELECT_CARD,index:null},{finish:!!p.can_finish,cancel:!p.can_finish});choice.canFinish=!!p.can_finish;}return;
    }
    if([T.SELECT_CARD,T.SELECT_TRIBUTE,T.SELECT_SUM,T.SELECT_COUNTER,T.SELECT_DISFIELD,T.SORT_CARD,T.SORT_CHAIN].includes(p.type)){
      choice.stage=true;let candidates=p.selects||p.cards;
      if(p.type===T.SELECT_DISFIELD)candidates=places(r,p);
      const sorting=p.type===T.SORT_CARD||p.type===T.SORT_CHAIN;
      if(p.type===T.SELECT_SUM&&r.sumPlan===undefined)r.sumPlan=sumPlan(r,p);
      candidates.forEach((item,index)=>{
        const card=cardAt(r,item),selected=r.selected.includes(index),count=r.selected.filter(i=>i===index).length;
        let label=targetName(card,item);
        if(p.type===T.SELECT_DISFIELD)label=`${r.side(item.player)===side?'Your':'Opponent’s'} ${item.location===m.OcgLocation.MZONE?'Monster':'Spell / Trap'} Zone ${item.sequence+1}`;
        if(p.type===T.SELECT_COUNTER)label+=` · ${count}/${item.count} counters`;
        const canAdd=p.type===T.SELECT_COUNTER?count<item.count:!sorting||!selected;
        if(canAdd)add({type:'CHOOSE',label:(selected?'Selected · ':'')+label,target:card?.uid,selected,recommended:p.type===T.SELECT_SUM&&r.sumPlan!==null&&(selected!==r.sumPlan.includes(index))},null,{kind:p.type===T.SELECT_COUNTER?'counter':sorting?'sort':'toggle',index});
        if(selected&&card)choice.selected.push(card.uid);
      });
      if(r.selected.length&&(sorting||p.type===T.SELECT_COUNTER))add({type:'CHOOSE',label:'Reset selection',reset:true},null,{kind:'reset'});
      choice.title=`${sorting?'Choose order':r.hint} · ${r.selected.length} selected`;
      if(finishable(r,p)){add({type:'CHOOSE',label:'Confirm selection',finish:true},selectionResponse(r,p));choice.canFinish=true;}
      if(p.can_cancel&&!r.selected.length)option('Cancel effect',{type:p.type===T.SELECT_TRIBUTE?R.SELECT_TRIBUTE:R.SELECT_CARD,indicies:null},{cancel:true});
      return;
    }
    if(p.type===T.ANNOUNCE_NUMBER){choice.title='Declare a number';p.options.forEach((number,index)=>option(String(number),{type:R.ANNOUNCE_NUMBER,value:index}));return;}
    if(p.type===T.ANNOUNCE_CARD){choice.title='Declare a card name';choice.searchable=true;for(const record of r.records.values())if(m.cardMatchesOpcode(record,p.opcodes)&&!(record.type&m.OcgType.TOKEN))option(record.name,{type:R.ANNOUNCE_CARD,card:record.code});return;}
    if(p.type===T.ANNOUNCE_ATTRIB||p.type===T.ANNOUNCE_RACE){
      const attribute=p.type===T.ANNOUNCE_ATTRIB,values=Object.entries(attribute?m.OcgAttribute:m.OcgRace).filter(([,value])=>attribute?((p.available&value)===value):((p.available&value)===value));
      choice.title='Declare '+(attribute?'attribute':'monster type');choice.stage=true;;
      values.forEach(([label],index)=>add({type:'CHOOSE',label:label.replaceAll('_',' '),selected:r.selected.includes(index)},null,{kind:'toggle',index}));
      if(r.selected.length===p.count){option('Confirm declaration',attribute?{type:R.ANNOUNCE_ATTRIB,attributes:r.selected.map(i=>values[i][1])}:{type:R.ANNOUNCE_RACE,races:r.selected.map(i=>values[i][1])},{finish:true});choice.canFinish=true;}return;
    }
    if(p.type===T.ROCK_PAPER_SCISSORS){choice.title='Rock, paper, scissors';['Rock','Paper','Scissors'].forEach((label,index)=>option(label,{type:R.ROCK_PAPER_SCISSORS,value:index+1}));return;}
    throw new Error('Unsupported native prompt: '+m.ocgMessageTypeStrings.get(p.type));
  }
  function selectionResponse(r,p){
    const m=r.module,T=m.OcgMessageType,R=m.OcgResponseType;
    if(p.type===T.SELECT_DISFIELD)return {type:R.SELECT_DISFIELD,places:r.selected.map(i=>places(r,p)[i])};
    if(p.type===T.SELECT_COUNTER)return {type:R.SELECT_COUNTER,counters:p.cards.map((_,i)=>r.selected.filter(n=>n===i).length)};
    if(p.type===T.SORT_CARD||p.type===T.SORT_CHAIN)return {type:R.SORT_CARD,order:p.cards.map((_,i)=>r.selected.indexOf(i))};
    const type=p.type===T.SELECT_SUM?R.SELECT_SUM:p.type===T.SELECT_TRIBUTE?R.SELECT_TRIBUTE:R.SELECT_CARD;
    return {type,indicies:[...r.selected]};
  }
  function applyAction(state,action,side=state.active){
    const r=matches.get(state.runtimeId);if(!r)throw new Error('This duel has ended. Start a new match.');
    r.state=structuredClone(state);r.state.visualAction=null;
    if(action.type==='SURRENDER'){r.state.winner=1-side;log(r,who(side)+' surrendered.','victory');return r.state;}
    const legal=legalActions(state,side).find(a=>action.id?a.id===action.id:a.type===action.type),reply=legal&&r.reply.get(action.id);
    if(!reply)throw new Error('That selection is no longer legal.');
    if(reply.stage){const {kind,index}=reply.stage;if(kind==='toggle')r.selected=r.selected.includes(index)?r.selected.filter(i=>i!==index):[...r.selected,index];else if(kind==='reset')r.selected=[];else r.selected.push(index);actions(r);return r.state;}
    r.lib.duelSetResponse(r.handle,reply.response);pump(r);return r.state;
  }
  function destroyMatch(state){const r=matches.get(state?.runtimeId);if(r){r.lib.destroyDuel(r.handle);matches.delete(r.id);}}
  return {createMatch,applyAction,legalActions,stats,findCard,destroyMatch,chooseAIAction};
}
function selectionTypes(m){const T=m.OcgMessageType;return new Set(['SELECT_BATTLECMD','SELECT_IDLECMD','SELECT_EFFECTYN','SELECT_YESNO','SELECT_OPTION','SELECT_CARD','SELECT_CHAIN','SELECT_PLACE','SELECT_POSITION','SELECT_TRIBUTE','SORT_CHAIN','SELECT_COUNTER','SELECT_SUM','SELECT_DISFIELD','SORT_CARD','SELECT_UNSELECT_CARD','ANNOUNCE_RACE','ANNOUNCE_ATTRIB','ANNOUNCE_CARD','ANNOUNCE_NUMBER','ROCK_PAPER_SCISSORS'].map(key=>T[key]));}

// Scoring only uses the AI's cards, public field information, and choices the
// rules engine explicitly reveals. Hidden opposing stats never affect it.
export function chooseAIAction(state,side=1,difficulty='normal'){
  const actions=legalActions(state,side);if(!actions.length)return null;
  const strength=card=>!card?0:card.controller!==side&&!card.faceUp?1500:stats(state,card)[card.position==='defense'?'def':'atk'];
  const p=state.players[side],foe=state.players[1-side];
  const score=a=>{
    const card=findCard(state,a.uid),target=findCard(state,a.target),own=target?.controller===side;
    if(a.reset)return -500;if(a.finish)return 1000;if(a.recommended)return 800;if(a.cancel)return -100;
    if(a.selected)return -50;
    if(a.type==='PASS')return -5;
    if(a.type==='NEXT')return 0;if(a.type==='END')return -2;
    if(a.type==='SUMMON')return 20+(a.set?card?.card.def||0:card?.card.atk||0)/200+(a.special?8:0);
    if(a.type==='ATTACK'){const atk=stats(state,card).atk;return a.target===null?30+atk/100:10;}
    if(a.type==='ACTIVATE'||a.type==='EFFECT')return 12;
    if(a.type==='SET')return card?.card.type==='Trap Card'?10:2;
    if(a.type==='POSITION')return card?.position==='defense'&&stats(state,card).atk>=Math.max(0,...foe.monsters.filter(Boolean).map(strength))?10:-10;
    if(a.yes!==undefined)return a.yes?10:0;
    if(a.defense!==undefined)return a.defense&&Math.max(0,...foe.monsters.filter(Boolean).map(strength))>Math.max(0,...p.monsters.filter(Boolean).map(strength))?10:5;
    if(a.type==='CHOOSE'){
      if(!target)return 1;
      const name=state.choice?.title?.toLowerCase()||'';
      if(/discard|tribute|release|ritual|fusion|cost/.test(name))return 20-strength(target)/200;
      if(/special|grave|recover|add to hand/.test(name))return 10+strength(target)/200;
      return (own?-10:10)+strength(target)/200;
    }
    return 1;
  };
  let seed=(state.seed+Number.parseInt(actions[0].id)*17+state.serial*7919+(state.actions?.[side]?.[0]?.id?.length||0)*13)>>>0;
  const noise=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const variation=difficulty==='easy'?30:difficulty==='hard'?0:4;
  return actions.map((action,index)=>({action,index,score:score(action)+noise()*variation})).sort((a,b)=>b.score-a.score||a.index-b.index)[0].action;
}
const backend=createNativeBackend();
export const createMatch=(...args)=>backend.createMatch(...args);
export const applyAction=(...args)=>backend.applyAction(...args);
export const destroyMatch=(...args)=>backend.destroyMatch(...args);
