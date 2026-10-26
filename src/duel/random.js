// Fresh entropy for real games; explicit seeds remain reproducible for replays.
let fallbackSequence=0;
export function freshSeed(){
  if(globalThis.crypto?.getRandomValues)return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
  return deriveSeed(Date.now()^Math.floor(Math.random()*4294967296),String(++fallbackSequence));
}
export function deriveSeed(seed,domain){
  let value=seed>>>0;
  for(const c of domain)value=Math.imul(value^c.charCodeAt(0),0x01000193);
  value=Math.imul(value^(value>>>16),0x21f0aaad);value=Math.imul(value^(value>>>15),0x735a2d97);
  return (value^(value>>>15))>>>0;
}
// SFC32 with independently mixed state and a warm-up. Unlike the old LCG,
// nearby seeds do not give neighboring first picks or correlated deck lists.
export function seededRandom(seed){
  let a=deriveSeed(seed,'a'),b=deriveSeed(seed,'b'),c=deriveSeed(seed,'c'),d=deriveSeed(seed,'d');
  const uint32=()=>{a|=0;b|=0;c|=0;d|=0;const t=((a+b|0)+d|0)>>>0;d=d+1|0;a=b^b>>>9;b=c+(c<<3)|0;c=(c<<21|c>>>11)+t|0;return t;};
  for(let i=0;i<20;i++)uint32();
  const random=()=>uint32()/4294967296;
  random.int=max=>{if(!Number.isInteger(max)||max<1||max>4294967296)throw new RangeError('Invalid random range.');const limit=4294967296-4294967296%max;let n;do{n=uint32();}while(n>=limit);return n%max;};
  return random;
}
export function shuffled(cards,random){
  const copy=[...cards];
  for(let i=copy.length-1;i>0;i--){const j=random.int?random.int(i+1):Math.floor(random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]];}
  return copy;
}
// Versions 1/2 must keep their exact initial order when an old save is replayed.
export function legacyRandom(seed){let value=seed>>>0||1;return()=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296;};}
