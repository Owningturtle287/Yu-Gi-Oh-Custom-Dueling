const smallPattern = /^https:\/\/images\.ygoprodeck\.com\/images\/cards_small\/\d+\.jpg$/;
const fullPattern = /^https:\/\/images\.ygoprodeck\.com\/images\/cards\/\d+\.jpg$/;

// Keep archive/printed data immutable while displaying the core's current
// monster properties (Cost Down, DNA Surgery/Transplant, Legendary Ocean).
export function currentCardData(instance){
  const trapMonster=instance.card.type==='Trap Card'&&(instance.currentType&1);
  return {...instance.card,...(trapMonster?{type:(instance.currentType&32?'Effect':'Normal')+' Trap Monster'}:{}),level:instance.currentLevel??instance.card.level,race:instance.currentRace??instance.card.race,attribute:instance.currentAttribute??instance.card.attribute};
}
export const cardStatText=(instance,values)=>({atk:instance.unknownStats?.atk?'?':values.atk,def:instance.unknownStats?.def?'?':values.def});
// Counter totals come from live core queries, never inferred from effect text.
export function cardCounters(instance){
  if(!instance?.faceUp)return [];
  const names={1:'Spell Counter',4110:'A-Counter',27:'Clock Counter'};
  return Object.entries(instance.counters||{}).filter(([,count])=>count>0).map(([type,count])=>({type:Number(type),count,label:`${count} ${names[type]||'Counter'}${count===1?'':'s'}`}));
}

export function cardArtURLs(card) {
  const supplied = card?.card_images?.[0];
  const small = smallPattern.test(supplied?.image_url_small || '') ? supplied.image_url_small : '';
  const full = fullPattern.test(supplied?.image_url || '') ? supplied.image_url : '';
  return { preview: small || full, full };
}

export function cardTypeLabel(card) {
  if (/Monster/.test(card.type)) {
    return [card.race, ...card.type.replace(/\bMonster\b/g, '').trim().split(/\s+/)].filter(Boolean).join(' / ');
  }
  return [card.type.replace(/\s+Card$/, ''), card.race].filter(Boolean).join(' / ');
}

// The field's already displayed thumbnail stays visible while full art loads
// and decodes. A slow connection or failed upgrade never clears that preview.
export function sharpenCardArt(container, card, { source, createImage = () => container.ownerDocument.createElement('img') } = {}) {
  const { preview, full } = cardArtURLs(card);
  let cancelled = false;
  const current = container.querySelector('img');
  if (current && source?.complete && source.naturalWidth && source.getAttribute('src') === preview) {
    const cached = source.cloneNode(true);
    cached.className = ''; cached.alt = ''; cached.decoding = 'sync'; cached.loading = 'eager';
    current.replaceWith(cached);
  } else if (current) current.decoding = 'sync';
  if (!full || full === preview) return () => {};
  const upgrade = createImage();
  upgrade.alt = ''; upgrade.className = 'duel-inspect-full'; upgrade.decoding = 'async';
  upgrade.onload = async () => {
    try { await upgrade.decode?.(); } catch { return; }
    if (!cancelled && container.isConnected) container.replaceChildren(upgrade);
  };
  upgrade.onerror = () => {}; // Keep the immediately visible preview.
  upgrade.src = full;
  return () => { cancelled = true; upgrade.onload = null; upgrade.onerror = null; };
}
