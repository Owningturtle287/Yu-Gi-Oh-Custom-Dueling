// Track physical copies through protocol moves. Hidden shuffles retire identities.
export const locationKey=loc=>`${loc.controller}:${loc.location}:${loc.sequence}`;
const entries=(ids,controller,location)=>[...ids].filter(([key])=>key.startsWith(`${controller}:${location}:`));
const sequence=key=>Number(key.split(':')[2]);
export function trackIdentities(ids,messages,module,allocate){
  const moved=new Map();
  const L=module.OcgLocation,T=module.OcgMessageType;
  const list=location=>[L.DECK,L.HAND,L.GRAVE,L.REMOVED,L.EXTRA].includes(location);
  const remove=loc=>{const key=locationKey(loc),uid=ids.get(key);ids.delete(key);if(list(loc.location))for(const [key,value] of entries(ids,loc.controller,loc.location).sort((a,b)=>sequence(a[0])-sequence(b[0])))if(sequence(key)>loc.sequence){ids.delete(key);ids.set(locationKey({...loc,sequence:sequence(key)-1}),value);}return uid;};
  const insert=(loc,uid)=>{if(!loc.location)return;if(list(loc.location))for(const [key,value] of entries(ids,loc.controller,loc.location).sort((a,b)=>sequence(b[0])-sequence(a[0])))if(sequence(key)>=loc.sequence){ids.delete(key);ids.set(locationKey({...loc,sequence:sequence(key)+1}),value);}ids.set(locationKey(loc),uid);};
  const clear=(controller,location)=>{for(const [key] of entries(ids,controller,location))ids.delete(key);};
  for(const msg of messages){
    if(msg.type===T.MOVE){const uid=ids.get(locationKey(msg.from));if(uid)moved.set(msg,uid);if(locationKey(msg.from)===locationKey(msg.to))continue;const copy=msg.from.location?remove(msg.from):null;insert(msg.to,copy||allocate());}
    else if(msg.type===T.DRAW)for(const _card of msg.drawn){const deck=entries(ids,msg.player,L.DECK),hand=entries(ids,msg.player,L.HAND),top=Math.max(-1,...deck.map(([key])=>sequence(key)));const uid=top>=0?remove({controller:msg.player,location:L.DECK,sequence:top}):null;insert({controller:msg.player,location:L.HAND,sequence:hand.length},uid||allocate());}
    else if(msg.type===T.SWAP){const one=locationKey(msg.card1),two=locationKey(msg.card2),a=ids.get(one),b=ids.get(two);ids.delete(one);ids.delete(two);if(a)ids.set(two,a);if(b)ids.set(one,b);}
    else if(msg.type===T.SHUFFLE_DECK)clear(msg.player,L.DECK);
    else if(msg.type===T.SHUFFLE_HAND)clear(msg.player,L.HAND);
    else if(msg.type===T.SHUFFLE_EXTRA)clear(msg.player,L.EXTRA);
    else if(msg.type===T.SWAP_GRAVE_DECK){clear(msg.player,L.GRAVE);clear(msg.player,L.DECK);}
    else if(msg.type===T.SHUFFLE_SET_CARD)for(const card of msg.cards){ids.delete(locationKey(card.from));ids.delete(locationKey(card.to));}
  }
  return moved;
}
