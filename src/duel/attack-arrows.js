const NS='http://www.w3.org/2000/svg';
let serial=0;
const element=(document,tag,attributes={})=>{
  const node=document.createElementNS(NS,tag);
  for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));
  return node;
};

// Shared geometry keeps targeting previews and the actual strike pointed in
// exactly the same direction. Arrow tips stop at the victim's card edge.
export function attackGeometry(from,to){
  const dx=to.x-from.x,dy=to.y-from.y,length=Math.hypot(dx,dy);
  if(length<1)return null;
  const ux=dx/length,uy=dy/length;
  const edge=rect=>Math.min(Math.abs(ux)>.0001?(rect.width||0)/2/Math.abs(ux):Infinity,Math.abs(uy)>.0001?(rect.height||0)/2/Math.abs(uy):Infinity);
  const startInset=Math.min(edge(from)+4,length*.3),endInset=Math.min(edge(to)+7,length*.3);
  return {start:{x:from.x+ux*startInset,y:from.y+uy*startInset},end:{x:to.x-ux*endInset,y:to.y-uy*endInset},angle:Math.atan2(dy,dx)*180/Math.PI,length:length-startInset-endInset};
}

export function appendAttackArrow(svg,from,to,{selected=true,side=0}={}){
  const geometry=attackGeometry(from,to);if(!geometry)return null;
  const document=svg.ownerDocument,id=`attack-head-${++serial}`,color=side===1?'#ffafc5':'#ffe1a1';
  const defs=element(document,'defs'),marker=element(document,'marker',{id,viewBox:'0 0 12 12',refX:10,refY:6,markerWidth:12,markerHeight:12,markerUnits:'userSpaceOnUse',orient:'auto'});
  marker.append(element(document,'path',{d:'M 1 1 L 11 6 L 1 11 L 4 6 Z',fill:color}));defs.append(marker);
  const path=element(document,'path',{d:`M ${geometry.start.x} ${geometry.start.y} L ${geometry.end.x} ${geometry.end.y}`,fill:'none',stroke:color,'stroke-width':selected?3:1.8,'marker-end':`url(#${id})`,class:'duel-arrow-shaft','data-selected':selected});
  svg.append(defs,path);return {path,geometry};
}

export function attackLinks(state,selection){
  if(!selection&&state?.choice?.attackUid)selection={kind:'attack',sourceUid:state.choice.attackUid,side:state.choice.side,selected:state.choice.selected||[],actions:state.choice.options};
  if(selection?.kind==='attack'){
    const targets=[...new Set(selection.actions.filter(a=>a.target).map(a=>a.target))];
    const links=targets.map(target=>({uid:selection.sourceUid,target,side:selection.side,selected:selection.selected.includes(target)}));
    if(selection.actions.some(a=>a.type==='ATTACK'&&a.target===null))links.push({uid:selection.sourceUid,target:null,side:selection.side,selected:false});
    return links;
  }
  const attack=state?.pending;
  return attack?.kind==='attack'?[{...attack,selected:true}]:[];
}

export function createAttackArrows(root){
  let state=null,selection=null,paused=false,hovered=null;
  function refresh(){
    const svg=root.querySelector('.duel-target-arrows'),table=root.querySelector('.duel-table');if(!svg||!table)return;
    svg.replaceChildren();if(paused)return;
    const area=table.getBoundingClientRect();if(!area.width||!area.height)return;
    svg.setAttribute('viewBox',`0 0 ${area.width} ${area.height}`);
    const rect=uid=>{
      const host=root.querySelector(`[data-motion-uid="${uid}"]`),visual=host?.querySelector('.duel-card-visual')||host;
      const r=visual?.getBoundingClientRect();return r?.width&&r.height?{x:r.left+r.width/2-area.left,y:r.top+r.height/2-area.top,width:r.width,height:r.height}:null;
    };
    for(const link of attackLinks(state,selection)){
      const from=rect(link.uid),lp=link.target===null?root.querySelector(`[data-field-lp="${1-link.side}"]`)?.getBoundingClientRect():null;
      const to=link.target===null&&lp?{x:lp.left+lp.width/2-area.left,y:lp.top+lp.height/2-area.top,width:lp.width,height:lp.height}:rect(link.target);
      if(!from||!to)continue;
      const arrow=appendAttackArrow(svg,from,to,{side:link.side,selected:link.selected||hovered===(link.target||`lp:${1-link.side}`)});
      if(arrow){arrow.path.dataset.source=link.uid;arrow.path.dataset.target=link.target||`lp:${1-link.side}`;}
    }
  }
  const point=event=>{const node=event.target.closest?.('[data-duel-card],[data-field-lp]');hovered=node?.dataset.duelCard||(node?.dataset.fieldLp!==undefined?`lp:${node.dataset.fieldLp}`:null);refresh();};
  root.addEventListener('pointerover',point);root.addEventListener('focusin',point);
  return {sync(next,nextSelection,{hidden=false}={}){state=next;selection=nextSelection;paused=hidden;refresh();},refresh,
    destroy(){root.removeEventListener('pointerover',point);root.removeEventListener('focusin',point);root.querySelector('.duel-target-arrows')?.replaceChildren();}};
}
