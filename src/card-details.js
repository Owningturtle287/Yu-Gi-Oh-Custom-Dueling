import {cardReleaseDate} from './era.js';
import {cardTypeLabel} from './duel/card-view.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export function publicationHTML(card){
  const dates=['tcg','ocg'].flatMap(region=>{const date=cardReleaseDate(card,region);return date?[`${region.toUpperCase()} <time datetime="${date}">${date}</time>`]:[];});
  const sets=[...new Set(card.setNames||(card.card_sets||[]).map(set=>set.set_name))].filter(name=>typeof name==='string'&&name.trim());
  return `<div class="card-publication"><p class="card-release-date"><span>First release</span> ${dates.join(' · ')||'Not recorded'}</p>${sets.length?`<details class="card-set-details"><summary>${escape(sets[0])}${sets.length>1?` · +${sets.length-1} sets`:''}</summary><ul tabindex="0" aria-label="Set memberships">${sets.map(name=>`<li>${escape(name)}</li>`).join('')}</ul></details>`:'<p class="card-no-sets">Set not recorded</p>'}</div>`;
}
export function cardFactsHTML(card){
  const facts=[card.attribute,card.linkval!==undefined?`Link ${card.linkval}`:card.level!==undefined?`${/xyz/i.test(card.type)?'Rank':'Level'} ${card.level}`:'',card.scale!==undefined?`Scale ${card.scale}`:'',card.archetype].filter(Boolean);
  return `<div class="card-facts"><strong class="duel-card-typing">${escape(cardTypeLabel(card))}</strong>${facts.length?`<span>${escape(facts.join(' · '))}</span>`:''}${card.linkmarkers?.length?`<span>Arrows: ${escape(card.linkmarkers.join(', '))}</span>`:''}</div>`;
}
export function battleStatsHTML(card,values=card){
  const stats=['atk','def'].filter(key=>card[key]!==undefined).map(key=>`<span>${key.toUpperCase()} <b>${escape(typeof values[key]==='number'&&values[key]<0?'?':values[key]??'?')}</b></span>`).join('');
  return stats?`<div class="card-battle-stats" aria-label="Attack and defense">${stats}</div>`:'';
}
