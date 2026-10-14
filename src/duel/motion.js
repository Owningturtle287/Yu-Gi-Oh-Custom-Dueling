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
  const visible = publicZones.has(zone) || (fieldZones.has(zone) && instance.faceUp)
    || (side === 0 && ['hand', 'extra'].includes(zone));
  // A motion plan never contains an opponent's hidden image URL or name.
  return { image: visible ? frontURL(instance.card) : CARD_BACK, back: !visible,
    rotation: zone === 'monsters' && instance.position === 'defense' ? 90 : 0 };
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
      to: action.target ? null : `${1 - attacker.side}:lp`, start: appearance(attacker), end: appearance(attacker) });
  }
  if(previous)for(const entry of next.log.filter(entry=>entry.id>previous.serial&&entry.uids?.length&&(entry.kind==='battle'||entry.kind==='damage'))){
    const attacker=before.get(entry.uids[0]);
    if(attacker)motions.push({type:'impact',target:entry.uids[1]||null,to:entry.uids[1]?null:`${1-attacker.side}:lp`});
  }
  if (previous) next.players.forEach((player, side) => {
    const delta = player.lp - previous.players[side].lp;
    if (delta) motions.push({ type: 'life', to: `${side}:lp`, delta, before: previous.players[side].lp, after: player.lp });
  });
  return motions;
}

function rectOf(element) {
  const rect = element?.getBoundingClientRect();
  return rect?.width > 0 && rect?.height > 0 ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height } : null;
}
export function captureArena(root) {
  const snapshot = { cards: new Map(), zones: new Map() };
  for (const element of root.querySelectorAll('[data-motion-uid]')) {
    const surface=element.querySelector('.duel-card-visual') || element.querySelector('img') || element;
    const rect = rectOf(surface);
    if(rect && surface.tagName==='IMG'){rect.width=Math.min(rect.width,rect.height*59/86);rect.height=rect.width*86/59;}
    if (rect) snapshot.cards.set(element.dataset.motionUid, rect);
  }
  for (const element of root.querySelectorAll('[data-motion-zone]')) {
    const rect = rectOf(element); if (rect) snapshot.zones.set(element.dataset.motionZone, rect);
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
    document.body.append(layer);
    const jobs = [], arrivals = new Map();
    const zonePoint = (snapshot, key) => snapshot.zones.get(key) || (key ? snapshot.zones.get(`${key[0]}:piles`) : null);
    let drawIndex = 0;
    const run = (element, keyframes, options) => {
      const animation = element.animate(keyframes, options); animations.add(animation);
      const finished = animation.finished?.catch(() => {}) || Promise.resolve();
      jobs.push(finished.finally(() => animations.delete(animation))); return finished;
    };
    for (const motion of motions) {
      if(motion.type==='impact'){
        const target=after.cards.get(motion.target)||before.cards.get(motion.target)||after.zones.get(motion.to);if(!target)continue;
        const impact=document.createElement('span');impact.className='duel-impact';layer.append(impact);
        run(impact,[{transform:transform(target,0,.2),opacity:0},{transform:transform(target,0,1),opacity:.95,offset:.25},{transform:transform(target,0,1.65),opacity:0}],{duration:500,easing:ease,fill:'both'});
        continue;
      }
      if (motion.type === 'life') {
        const target = after.zones.get(motion.to); if (!target) continue;
        const badge = document.createElement('span'); badge.className = `duel-lp-change ${motion.delta < 0 ? 'loss' : 'gain'}`;
        badge.textContent = `${motion.delta > 0 ? '+' : '−'}${Math.abs(motion.delta).toLocaleString()}`; layer.append(badge);
        run(badge, [{ transform: transform(target, 0, .7), opacity: 0 }, { transform: transform({ ...target, y: target.y - 9 }, 0, 1.1), opacity: 1, offset: .25 }, { transform: transform({ ...target, y: target.y - 28 }), opacity: 0 }], { duration: 850, easing: ease, fill: 'both' });
        const counter = root.querySelector(`[data-lp-value="${motion.to[0]}"]`);
        if (counter) {
          run(counter, [{ color: motion.delta < 0 ? '#ff9eaf' : '#b1ffdc', transform: 'scale(1.08)' }, { color: 'inherit', transform: 'scale(1)' }], { duration: 650, easing: ease });
          const view=document.defaultView;
          if(view?.requestAnimationFrame)jobs.push(new Promise(resolve=>{
            let frame, start;
            const stop=()=>{view.cancelAnimationFrame(frame);counter.textContent=Math.max(0,motion.after).toLocaleString();counters.delete(stop);resolve();};
            counters.add(stop);
            const tick=time=>{
              if(current!==generation){stop();return;}
              start??=time;const progress=Math.min(1,(time-start)/600),amount=Math.round(motion.before+(motion.after-motion.before)*(1-(1-progress)**3));
              counter.textContent=Math.max(0,amount).toLocaleString();
              if(progress<1)frame=view.requestAnimationFrame(tick);else stop();
            };
            frame=view.requestAnimationFrame(tick);
          }));
        }
        continue;
      }
      const from = before.cards.get(motion.uid) || zonePoint(before,motion.from) || zonePoint(after,motion.from);
      const to = motion.type === 'attack' ? after.cards.get(motion.target) || after.zones.get(motion.to)
        : after.cards.get(motion.uid) || zonePoint(after,motion.to);
      if (!from || !to) continue;
      const fromCard = before.cards.has(motion.uid), toCard = after.cards.has(motion.uid);
      const ghost = document.createElement('div'); ghost.className = `duel-moving-card ${motion.type === 'attack' ? 'attacking' : ''}`;
      // width/height describe the unrotated card; a sideways field rect swaps them.
      const width = motion.start.rotation ? from.height : fromCard ? from.width : 42;
      const height = motion.start.rotation ? from.width : fromCard ? from.height : 61;
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
      const delay = motion.draw ? Math.min(drawIndex++ * 75, 360) : Math.min(arrivals.size * 30, 120)+(motion.type==='move'&&motions.some(m=>m.type==='impact')?180:0);
      let frames, duration;
      if (motion.type === 'attack') {
        const near = { ...to, x: from.x + (to.x - from.x) * .88, y: from.y + (to.y - from.y) * .88 };
        frames = [{ transform: transform(from, motion.start.rotation), offset: 0 }, { transform: transform({ ...from, y: from.y + 5 }, motion.start.rotation, 1.06), offset: .18 }, { transform: transform(near, motion.start.rotation, 1.15), offset: .58 }, { transform: transform(from, motion.start.rotation), offset: 1 }]; duration = 680;
        const trail = document.createElement('div'); trail.className = 'duel-attack-trail';
        const dx = to.x - from.x, dy = to.y - from.y;
        trail.style.cssText = `left:${from.x}px;top:${from.y}px;width:${Math.hypot(dx, dy)}px;transform:rotate(${Math.atan2(dy, dx)}rad);`;
        layer.append(trail);
        run(trail, [{ opacity: 0, clipPath: 'inset(0 100% 0 0)' }, { opacity: .95, clipPath: 'inset(0 0 0 0)', offset: .5 }, { opacity: 0, clipPath: 'inset(0 0 0 100%)' }], { duration: 620, easing: ease, fill: 'both' });
      } else {
        const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - (motion.type === 'move' ? 24 : 0) };
        const targetWidth = motion.end.rotation ? to.height : toCard ? to.width : 34;
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
