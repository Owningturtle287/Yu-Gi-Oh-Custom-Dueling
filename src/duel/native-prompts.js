const SYSTEM={30:'Activate this effect?',31:'Continue?',60:'Heads',61:'Tails',93:'Attack directly?',94:'Replay this attack?'};
// The pinned core's aux.Stringid packs the card code above a 20-bit index.
export function describeNative(records,value){
  const id=BigInt(value||0);
  for(const bits of [20n,4n]){
    const text=records.get(Number(id>>bits))?.descriptions?.[Number(id&((1n<<bits)-1n))];
    if(text)return text;
  }
  return SYSTEM[Number(id)]||'Choose an effect option';
}
// Use the printed phase clause only after the core offers a legal trigger.
// This labels the active effect without confusing it with another ignition
// effect on the same card or a stale hint from the previous battle selection.
export function phaseEffectText(card,phase){
  const label={end:'End Phase',standby:'Standby Phase'}[phase];
  if(!label)return '';
  const description=String(card?.desc||'').replace(/\s+/g,' ').trim();
  const index=description.search(new RegExp(`(?:During|At) [^.;:]{0,60}\\b${label}\\b`,'i'));
  return index<0?'':description.slice(index);
}
export function choiceContext(card,type,text,hint,phase){
  const phaseText=type==='select_effectyn'&&phaseEffectText(card,phase);
  if(phaseText&&/Choose an effect option|Activate this effect\?|Continue\?/i.test(text))return {title:`${card.name} · ${phase==='end'?'End':'Standby'} Phase effect`,instructions:phaseText,effectText:phaseText};
  if(card?.id===60082869&&type==='select_yesno')return {title:'Dust Tornado · Set a card?',instructions:'The targeted card was destroyed. You may now Set 1 Spell/Trap from your hand.',yes:'Set a Spell/Trap',no:'Finish without Setting'};
  if(card?.id===94773007&&type==='select_option')return {title:'Jirai Gumo · Call the coin',instructions:'Choose Heads or Tails. A wrong call costs half your current LP. The attack still continues.'};
  if(card?.id===9076207)return {instructions:'Required Flip effect: select a face-up Spell or a Set Spell/Trap, even your own. A Set Trap is revealed and stays Set.'};
  return {instructions:card?`${card.name}: ${text&&!/Choose an effect option|Continue\?/.test(text)?text:hint||'Follow the highlighted card choices.'}`:hint};
}
