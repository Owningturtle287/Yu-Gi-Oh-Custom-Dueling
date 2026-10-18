import { cardRotation } from './field.js';
import { appendAttackArrow } from './attack-arrows.js';
import {localRect} from './viewport.js';
export const CARD_BACK = './assets/card-back.jpg';
const fieldZones = new Set(['monsters', 'spells', 'field']);
const publicZones = new Set(['grave', 'banished']);
const frontURL = card => {
  const url = card?.card_images?.[0]?.image_url_small;
  return /^https:\/\/images\.ygoprodeck\.com\/images\/cards_small\/\d+\.jpg$/.test(url || '') ? url : '';
};
const zoneKey = location => `${location.side}:${location.zone}`;
export function cardLocations(state) {
  const locations = new Map();
  state?.players.forEach((player, side) => {
    for (const zone of ['deck', 'hand', 'monsters', 'spells', 'field', 'grave', 'banished', 'extra']) {
      const cards = zone === 'field' ? [player.field] : player[zone];
      cards.forEach((instance, index) => { if (instance) locations.set(instance.uid, { side, zone, index, instance }); });
    }
  });
  return locations;
}
function appearance(location) {
  const { side, zone, instance } = location;
  const visible = instance.public || (publicZones.has(zone) && (side===0 || instance.faceUp)) || (fieldZones.has(zone) && instance.faceUp)
    || (side === 0 && ['hand', 'extra'].includes(zone));
  // A motion plan never contains an opponent's hidden image URL or name.
  return { image: visible ? frontURL(instance.card) : CARD_BACK, back: !visible,
    rotation: cardRotation(side,instance.position,zone) };
}
export function planMotion(previous, next, action = null) {
  const before = cardLocations(previous), after = cardLocations(next), motions = [];
  for (const [uid, to] of after) {
    const from = before.get(uid) || (!previous && to.zone === 'hand' ? { ...to, zone: 'deck' } : null);
    if (!from) continue;
    const moved = from.side !== to.side || from.zone !== to.zone || (fieldZones.has(to.zone) && from.index !== to.index);
    const start = appearance(from), end = appearance(to);
    if (moved || start.rotation !== end.rotation || start.back !== end.back) {
      motions.push({ type: moved ? 'move' : start.back !== end.back ? 'flip' : 'rotate', uid,
        from: zoneKey(from), to: zoneKey(to), start, end,
        draw: from.zone === 'deck' && to.zone === 'hand' });
    }
  }
  if (previous && action?.type === 'ATTACK') {
    const attacker = before.get(action.uid);
    if (attacker) motions.push({ type: 'attack', uid: action.uid, target: action.target,
      to: action.target ? null : `${1 - attacker.side}:lp`, side:attacker.side, start: appearance(attacker), end: appearance(attacker) });
  }
  if(previous)for(const entry of next.log.filter(entry=>entry.id>previous.serial)){
    if(['activate','target'].includes(entry.kind)&&entry.uids?.length)motions.push({type:'effect',uid:entry.uids[0],target:entry.kind==='target'?entry.uids[1]:null});
    if(entry.kind==='damage'&&Number.isInteger(entry.targetSide))motions.push({type:'impact',target:null,to:`${entry.targetSide}:lp`});
    else if(entry.uids?.length&&(entry.kind==='battle'&&next.version!==2||entry.kind==='damage')){
      const attacker=before.get(entry.uids[0]);
      if(attacker)motions.push({type:'impact',target:entry.uids[1]||null,to:entry.uids[1]?null:`${1-attacker.side}:lp`});
    }
  }
  const strike=motions.find(m=>m.type==='attack');
  if(strike&&!motions.some(m=>m.type==='impact'&&m.target===strike.target&&m.to===strike.to))motions.push({type:'impact',target:strike.target,to:strike.to});
  if (previous) next.players.forEach((player, side) => {
    const delta = player.lp - previous.players[side].lp;
    if (delta) motions.push({ type: 'life', to: `${side}:lp`, delta, before: previous.players[side].lp, after: player.lp });
  });
  return motions;
}

function rectOf(element,root) {
  const rect = localRect(element,root);
  return rect?.width > 0 && rect?.height > 0 ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height } : null;
}
export function captureArena(root) {
  const snapshot = { cards: new Map(), zones: new Map() };
  for (const element of root.querySelectorAll('[data-motion-uid]')) {
    const surface=element.querySelector('.duel-card-visual') || element.querySelector('img') || element;
    const rect = rectOf(surface,root);
    if(rect && surface.tagName==='IMG'){rect.width=Math.min(rect.width,rect.height*59/86);rect.height=rect.width*86/59;}
    if (rect) snapshot.cards.set(element.dataset.motionUid, rect);
  }
  for (const element of root.querySelectorAll('[data-motion-zone]')) {
    const rect = rectOf(element,root); if (rect) snapshot.zones.set(element.dataset.motionZone, rect);
  }
  return snapshot;
}
const ease = 'cubic-bezier(.22,.72,.18,1)';
const transform = (point, rotation = 0, scale = 1) => `translate(${point.x}px,${point.y}px) translate(-50%,-50%) rotate(${rotation}deg) scale(${scale})`;

// Only presentation waits on Web Animations. Rules have already committed once.
// Cancelling (navigation, resize, reduced motion) restores all actual card nodes.
export function createMotionPlayer(root) {
  const animations = new Set(), hidden = new Set(), counters = new Set();
  let layer = null, generation = 0;
  function cancel() {
    generation++;
    for (const animation of animations) { try { animation.cancel(); } catch { /* already finished */ } }
    animations.clear();
    for (const stop of counters) stop();
    counters.clear();
    for (const element of hidden) element.style.visibility = '';
    hidden.clear(); layer?.remove(); layer = null;
  }
  async function play(motions, before, { enabled = true } = {}) {
    cancel();
    if (!enabled || !motions.length || typeof root.animate !== 'function') return;
    const after = captureArena(root), current = generation, document = root.ownerDocument;
    layer = document.createElement('div'); layer.className = 'duel-motion-layer'; layer.setAttribute('aria-hidden', 'true');
    root.append(layer);
    const jobs = [], arrivals = new Map();
    const zonePoint = (snapshot, key) => snapshot.zones.get(key) || (key ? snapshot.zones.get(`${key[0]}:piles`) : null);
    let drawIndex = 0;
    const run = (element, keyframes, options) => {
      if(typeof element.animate!=='function')return Promise.resolve();
      const animation = element.animate(keyframes, options); animations.add(animation);
      const finished = animation.finished?.catch(() => {}) || Promise.resolve();
      jobs.push(finished.finally(() => animations.delete(animation))); return finished;
    };
    for (const motion of motions) {
      if(motion.type==='effect'){
        const source=after.cards.get(motion.uid)||before.cards.get(motion.uid),target=after.cards.get(motion.target)||before.cards.get(motion.target);
        for(const [point,isTarget] of [[source,false],[target,true]]){
          if(!point)continue;
          const pulse=document.createElement('span');pulse.className='duel-effect-pulse'+(isTarget?' target':'');layer.append(pulse);
          run(pulse,[{transform:transform(point,0,.85),opacity:0},{transform:transform(point,0,1.1),opacity:1,offset:.3},{transform:transform(point,0,1.45),opacity:0}],{duration:540,delay:isTarget?100:0,easing:ease,fill:'both'});
        }
        if(source&&target){
          const path=document.createElement('span');path.className='duel-effect-path';
          path.style.cssText=`left:${source.x}px;top:${source.y}px;width:${Math.hypot(target.x-source.x,target.y-source.y)}px;transform:rotate(${Math.atan2(target.y-source.y,target.x-source.x)}rad);`;layer.append(path);
          run(path,[{opacity:0,clipPath:'inset(0 100% 0 0)'},{opacity:.85,clipPath:'inset(0 0 0 0)',offset:.5},{opacity:0,clipPath:'inset(0 0 0 100%)'}],{duration:560,easing:ease,fill:'both'});
        }
        continue;
      }
      if(motion.type==='impact'){
        const target=before.cards.get(motion.target)||after.cards.get(motion.target)||after.zones.get(motion.to);if(!target)continue;
        const impact=document.createElement('span');impact.className='duel-impact';layer.append(impact);
        run(impact,[{transform:transform(target,0,.2),opacity:0},{transform:transform(target,0,1),opacity:.95,offset:.25},{transform:transform(target,0,1.65),opacity:0}],{duration:500,delay:motions.some(m=>m.type==='attack')?420:0,easing:ease,fill:'both'});
        continue;
      }
      if (motion.type === 'life') {
        const target = after.zones.get(motion.to); if (!target) continue;
        const badge = document.createElement('span'); badge.className = `duel-lp-change ${motion.delta < 0 ? 'loss' : 'gain'}`;
        badge.textContent = `${motion.delta > 0 ? '+' : '−'}${Math.abs(motion.delta).toLocaleString()}`; layer.append(badge);
        run(badge, [{ transform: transform(target, 0, .7), opacity: 0 }, { transform: transform({ ...target, y: target.y - 9 }, 0, 1.1), opacity: 1, offset: .25 }, { transform: transform({ ...target, y: target.y - 28 }), opacity: 0 }], { duration: 850, delay:motions.some(m=>m.type==='attack')?420:0, easing: ease, fill: 'both' });
        const counter = root.querySelector(`[data-lp-value="${motion.to[0]}"]`);
        if (counter) {
          const hold=motions.some(m=>m.type==='attack')?420:0;
          counter.textContent=Math.max(0,motion.before).toLocaleString();
          run(counter, [{ color: motion.delta < 0 ? '#ff9eaf' : '#b1ffdc', transform: 'scale(1.08)' }, { color: 'inherit', transform: 'scale(1)' }], { duration: 650, delay:hold, easing: ease });
          const view=document.defaultView;
          if(view?.requestAnimationFrame)jobs.push(new Promise(resolve=>{
            let frame, start;
            const stop=()=>{view.cancelAnimationFrame(frame);counter.textContent=Math.max(0,motion.after).toLocaleString();counters.delete(stop);resolve();};
            counters.add(stop);
            const tick=time=>{
              if(current!==generation){stop();return;}
              start??=time;const progress=Math.max(0,Math.min(1,(time-start-hold)/600)),amount=Math.round(motion.before+(motion.after-motion.before)*(1-(1-progress)**3));
              counter.textContent=Math.max(0,amount).toLocaleString();
              if(progress<1)frame=view.requestAnimationFrame(tick);else stop();
            };
            frame=view.requestAnimationFrame(tick);
          }));
        }
        continue;
      }
      const from = before.cards.get(motion.uid) || zonePoint(before,motion.from) || zonePoint(after,motion.from);
      const to = motion.type === 'attack' ? before.cards.get(motion.target) || after.cards.get(motion.target) || after.zones.get(motion.to)
        : after.cards.get(motion.uid) || zonePoint(after,motion.to);
      if (!from || !to) continue;
      const fromCard = before.cards.has(motion.uid), toCard = after.cards.has(motion.uid);
      const ghost = document.createElement('div'); ghost.className = `duel-moving-card ${motion.type === 'attack' ? 'attacking' : ''}`;
      // width/height describe the unrotated card; a sideways field rect swaps them.
      const sideways=motion.start.rotation%180!==0;
      const width = sideways ? from.height : fromCard ? from.width : 42;
      const height = sideways ? from.width : fromCard ? from.height : 61;
      ghost.style.width = `${Math.max(20, Math.min(width, 100))}px`;
      ghost.style.height = `${Math.max(29, Math.min(height, 146))}px`;
      const inner = document.createElement('div'); inner.className = 'duel-moving-faces';
      const startFace = document.createElement('img'), endFace = document.createElement('img');
      startFace.src = motion.start.image || CARD_BACK; endFace.src = motion.end.image || CARD_BACK;
      startFace.alt = ''; endFace.alt = ''; startFace.className = 'motion-start-face'; endFace.className = 'motion-end-face';
      inner.append(startFace, endFace); ghost.append(inner); layer.append(ghost);
      const actual = root.querySelector(`[data-motion-uid="${motion.uid}"] .duel-card-visual`)
        || root.querySelector(`.duel-hand-card[data-motion-uid="${motion.uid}"] img`);
      if (actual) { actual.style.visibility = 'hidden'; hidden.add(actual); }
      const delay = motion.type==='attack'?0:motion.draw ? Math.min(drawIndex++ * 75, 360) : Math.min(arrivals.size * 30, 120)+(motion.type==='move'&&motions.some(m=>m.type==='impact')?(motions.some(m=>m.type==='attack')?480:180):0);
      let frames, duration;
      if (motion.type === 'attack') {
        const near = { ...to, x: from.x + (to.x - from.x) * .88, y: from.y + (to.y - from.y) * .88 };
        const distance=Math.hypot(to.x-from.x,to.y-from.y)||1,windup={x:from.x-(to.x-from.x)/distance*6,y:from.y-(to.y-from.y)/distance*6};
        frames = [{ transform: transform(from, motion.start.rotation), offset: 0 }, { transform: transform(windup, motion.start.rotation, 1.04), offset: .16 }, { transform: transform(near, motion.start.rotation, 1.12), offset: .6 }, { transform: transform(near, motion.start.rotation, 1.06), offset:.69 }, { transform: transform(from, motion.start.rotation), offset: 1 }]; duration = 780;
        const arrow=document.createElementNS('http://www.w3.org/2000/svg','svg');arrow.classList.add('duel-strike-arrow');
        arrow.setAttribute('viewBox',`0 0 ${document.defaultView.innerWidth} ${document.defaultView.innerHeight}`);layer.append(arrow);
        const line=appendAttackArrow(arrow,from,to,{side:motion.side||0});
        if(line){
          line.path.style.strokeDasharray=String(line.geometry.length);
          run(line.path,[{strokeDashoffset:line.geometry.length},{strokeDashoffset:0}],{duration:240,easing:ease,fill:'both'});
          line.outline.style.strokeDasharray=String(line.geometry.length);
          run(line.outline,[{strokeDashoffset:line.geometry.length},{strokeDashoffset:0}],{duration:240,easing:ease,fill:'both'});
          run(arrow,[{opacity:0},{opacity:1,offset:.15},{opacity:1,offset:.72},{opacity:0}],{duration,easing:ease,fill:'both'});
          const spark=document.createElement('span');spark.className='duel-attack-particle';layer.append(spark);
          run(spark,[{transform:transform(line.geometry.start,line.geometry.angle,.5),opacity:0},{transform:transform(line.geometry.start,line.geometry.angle),opacity:1,offset:.12},{transform:transform(line.geometry.end,line.geometry.angle,1.15),opacity:1,offset:.82},{transform:transform(line.geometry.end,line.geometry.angle,.5),opacity:0}],{duration:490,easing:ease,fill:'both'});
        }
      } else {
        const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - (motion.type === 'move' ? 24 : 0) };
        const targetWidth = motion.end.rotation%180!==0 ? to.height : toCard ? to.width : 34;
        const scale = Math.max(.45, Math.min(1.8, targetWidth / Math.max(width, 1)));
        frames = [{ transform: transform(from, motion.start.rotation), opacity: 1 }, { transform: transform(mid, (motion.start.rotation + motion.end.rotation) / 2 - (motion.draw ? 8 : 0), 1.08), opacity: 1, offset: .48 }, { transform: transform(to, motion.end.rotation, scale), opacity: toCard ? 1 : .3 }];
        duration = motion.type === 'move' ? 600 : 480;
      }
      if (motion.start.image !== motion.end.image || motion.start.back !== motion.end.back) {
        run(startFace, [{ opacity: 1, transform: 'rotateY(0deg)' }, { opacity: 1, transform: 'rotateY(88deg)', offset: .49 }, { opacity: 0, transform: 'rotateY(90deg)', offset: .5 }, { opacity: 0, transform: 'rotateY(90deg)' }], { duration, delay, fill: 'both', easing: ease });
        run(endFace, [{ opacity: 0, transform: 'rotateY(-90deg)' }, { opacity: 0, transform: 'rotateY(-90deg)', offset: .49 }, { opacity: 1, transform: 'rotateY(-88deg)', offset: .5 }, { opacity: 1, transform: 'rotateY(0deg)' }], { duration, delay, fill: 'both', easing: ease });
      } else endFace.hidden = true;
      const done = run(ghost, frames, { duration, delay, easing: ease, fill: 'both' });
      arrivals.set(motion.uid, done);
      done.finally(() => { if (current !== generation) return; ghost.remove(); if (actual) { actual.style.visibility = ''; hidden.delete(actual); } });
    }
    await Promise.allSettled(jobs);
    if (current === generation) { for (const element of hidden) element.style.visibility = ''; hidden.clear(); layer?.remove(); layer = null; }
  }
  return { play, cancel };
}
