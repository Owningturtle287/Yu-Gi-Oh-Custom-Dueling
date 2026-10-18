export const isRotated=element=>element?.ownerDocument.documentElement.dataset.duelRotated==='true';
export function landscapeSize(window){return {width:Math.max(window.innerWidth,window.innerHeight),height:Math.min(window.innerWidth,window.innerHeight)};}
export function localRect(element,root){
  const r=element?.getBoundingClientRect(),base=root?.getBoundingClientRect();if(!r||!base)return null;
  if(isRotated(root))return {left:r.top-base.top,top:base.right-r.right,width:r.height,height:r.width};
  return {left:r.left-base.left,top:r.top-base.top,width:r.width,height:r.height};
}
