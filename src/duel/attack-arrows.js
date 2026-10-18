import {localRect,isRotated} from './viewport.js';
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
  const document=svg.ownerDocument,id=`attack-head-${++serial}`,color=side===1?'#ffd0e0':'#fff0c6',tail=side===1?'#b56bc0':'#68d7c5';
  const defs=element(document,'defs'),marker=element(document,'marker',{id,viewBox:'0 0 12 12',refX:10,refY:6,markerWidth:12,markerHeight:12,markerUnits:'userSpaceOnUse',orient:'auto'});
  marker.append(element(document,'path',{d:'M 1 1 L 11 6 L 1 11 L 3.5 6 Z',fill:color,stroke:'#172333','stroke-width':.6}));
  const gradient=element(document,'linearGradient',{id:id+'-light',gradientUnits:'userSpaceOnUse',x1:geometry.start.x,y1:geometry.start.y,x2:geometry.end.x,y2:geometry.end.y});
  gradient.append(element(document,'stop',{offset:0,'stop-color':tail}),element(document,'stop',{offset:1,'stop-color':color}));defs.append(marker,gradient);
  const d=`M ${geometry.start.x} ${geometry.start.y} L ${geometry.end.x} ${geometry.end.y}`;
  const outline=element(document,'path',{d,fill:'none',stroke:'#081523','stroke-width':7,'stroke-linecap':'round',opacity:.75});
  const path=element(document,'path',{d,fill:'none',stroke:`url(#${id}-light)`,'stroke-width':3.5,'stroke-linecap':'round','marker-end':`url(#${id})`,class:'duel-arrow-shaft','data-selected':selected,'data-side':side});
  const flow=element(document,'path',{d,fill:'none',stroke:'#ffffff','stroke-width':2,'stroke-linecap':'round','stroke-dasharray':'2 14',opacity:.9,class:'duel-arrow-flow'});
  svg.append(defs,outline,path,flow);return {path,outline,geometry};
}

export function attackLinks(state,selection){
  if(state?.winner!==undefined&&state.winner!==null)return [];
  if(!selection&&state?.choice?.attackUid)selection={kind:'attack',sourceUid:state.choice.attackUid,side:state.choice.side,selected:state.choice.selected||[],actions:state.choice.options};
  if(selection?.kind==='attack'){
    const target=(selection.selected||[]).find(uid=>selection.actions.some(a=>a.target===uid));
    return target?[{uid:selection.sourceUid,target,side:selection.side,selected:true}]:[];
  }
  const attack=state?.pending;
  return attack?.kind==='attack'?[{...attack,selected:true}]:[];
}

export function createAttackArrows(root){
  let state=null,selection=null,paused=false;
  function refresh(){
    const svg=root.querySelector('.duel-target-arrows'),table=root.querySelector('.duel-table');if(!svg||!table)return;
    svg.replaceChildren();if(paused)return;
    // Measure the SVG's own viewport. A surrounding console, border, safe-area
    // inset or CSS scale must never become part of its coordinate system.
    const area=svg.getBoundingClientRect();if(!area.width||!area.height)return;
    svg.setAttribute('viewBox',`0 0 ${isRotated(svg)?area.height:area.width} ${isRotated(svg)?area.width:area.height}`);
    const rect=uid=>{
      const host=root.querySelector(`[data-motion-uid="${uid}"]`),visual=host?.querySelector('.duel-card-visual')||host;
      const r=localRect(visual,svg);return r?.width&&r.height?{x:r.left+r.width/2,y:r.top+r.height/2,width:r.width,height:r.height}:null;
    };
    for(const link of attackLinks(state,selection)){
      const from=rect(link.uid),lp=link.target===null?localRect(root.querySelector(`[data-field-lp="${1-link.side}"]`),svg):null;
      const to=link.target===null&&lp?{x:lp.left+lp.width/2,y:lp.top+lp.height/2,width:lp.width,height:lp.height}:rect(link.target);
      if(!from||!to)continue;
      const arrow=appendAttackArrow(svg,from,to,{side:link.side,selected:true});
      if(arrow){arrow.path.dataset.source=link.uid;arrow.path.dataset.target=link.target||`lp:${1-link.side}`;}
    }
  }
  return {sync(next,nextSelection,{hidden=false}={}){state=next;selection=nextSelection;paused=hidden;refresh();},refresh,
    destroy(){root.querySelector('.duel-target-arrows')?.replaceChildren();}};
}
