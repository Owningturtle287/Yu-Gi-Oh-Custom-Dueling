export const SHOWCASE_CARDS=[
  ['blue-eyes','Blue-Eyes White Dragon','LIGHT · DRAGON'],
  ['dark-magician','Dark Magician','DARK · SPELLCASTER'],
  ['stardust','Stardust Dragon','WIND · SYNCHRO'],
  ['red-eyes','Red-Eyes Black Dragon','DARK · DRAGON'],
  ['black-rose','Black Rose Dragon','FIRE · SYNCHRO'],
  ['neos','Elemental HERO Neos','LIGHT · WARRIOR']
];
/* Decode before replacing a layer: slow or missing art never clears the current frame. */
export function createShowcase(root,{ImageClass=root.ownerDocument.defaultView.Image,clock=root.ownerDocument.defaultView,media=root.ownerDocument.defaultView.matchMedia('(prefers-reduced-motion: reduce)'),document:doc=root.ownerDocument,delay=6500}={}){
  const layers=[...root.querySelectorAll('.showcase-image')],pause=root.querySelector('[data-showcase-pause]'),next=root.querySelector('[data-showcase-next]');
  let destroyed=false,timer,index=-1,active=1,busy=false,paused=media.matches;
  const failed=new Set(),images=new Map();
  const load=i=>{
    if(!images.has(i))images.set(i,new Promise((resolve,reject)=>{const img=new ImageClass();img.onload=()=>Promise.resolve(img.decode?.()).then(()=>resolve(img.src),reject);img.onerror=reject;img.src=`./assets/menu-art/${SHOWCASE_CARDS[i][0]}.jpg`;}));
    return images.get(i);
  };
  const updatePause=()=>{pause.textContent=paused?'▶':'Ⅱ';pause.setAttribute('aria-label',paused?'Play artwork slideshow':'Pause artwork slideshow');pause.setAttribute('aria-pressed',String(paused));root.dataset.paused=String(paused);};
  const schedule=()=>{clock.clearTimeout(timer);if(!destroyed&&!paused&&!doc.hidden&&failed.size<SHOWCASE_CARDS.length-1)timer=clock.setTimeout(advance,delay);};
  async function advance(){
    if(destroyed||busy)return;busy=true;clock.clearTimeout(timer);
    for(let step=1;step<=SHOWCASE_CARDS.length;step++){
      const candidate=(index+step)%SHOWCASE_CARDS.length;if(failed.has(candidate)||candidate===index)continue;
      try{
        const src=await load(candidate);if(destroyed)return;
        const layer=layers[1-active];layer.src=src;layer.alt='';layer.classList.add('is-visible');layers[active].classList.remove('is-visible');active=1-active;index=candidate;
        root.dataset.card=SHOWCASE_CARDS[index][0];root.classList.add('has-art');
        root.querySelector('.showcase-name').textContent=SHOWCASE_CARDS[index][1];root.querySelector('.showcase-type').textContent=SHOWCASE_CARDS[index][2];
        break;
      }catch{if(destroyed)return;failed.add(candidate);}
    }
    busy=false;next.disabled=failed.size>=SHOWCASE_CARDS.length-1;schedule();
  }
  pause.onclick=()=>{paused=!paused;updatePause();schedule();};next.onclick=advance;
  const visibility=()=>{if(doc.hidden)clock.clearTimeout(timer);else schedule();};
  const motion=()=>{paused=media.matches;updatePause();schedule();};
  doc.addEventListener('visibilitychange',visibility);media.addEventListener?.('change',motion);updatePause();advance();
  return {destroy(){destroyed=true;clock.clearTimeout(timer);doc.removeEventListener('visibilitychange',visibility);media.removeEventListener?.('change',motion);pause.onclick=next.onclick=null;},next:advance};
}
