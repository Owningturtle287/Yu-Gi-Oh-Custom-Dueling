const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

// Fit four card rows to the actual safe-area-adjusted table, then size the
// columns from those cards instead of spreading five slots across the screen.
export function arenaGeometry(width,height,{bottomInset=4}={}){
  width=Math.max(320,width);height=Math.max(240,height);
  bottomInset=clamp(Number(bottomInset)||0,0,60);
  const phase=32,phaseGap=4,fieldWidth=width-8-phase-phaseGap;
  const handCardSize=clamp(height*.17,64,96);
  let topHand=clamp(height*.05,16,26),bottomHand=clamp(height*.14,52,80)+bottomInset;
  const rowGap=3,sideGap=14,handGap=2,pileGap=18,outer=45,cellGap=4;
  const available=height-8-topHand-bottomHand-sideGap-handGap*2;
  let compact=fieldWidth<570||(available-rowGap*2)/4<56;
  const measure=(cardHeight,compact)=>{
    const cardWidth=(cardHeight-2)*.686+2,bay=cardWidth+6,action=compact?0:24;
    const slot=Math.max(compact?44:0,bay+(action?action+3:0));
    const board=slot*5+cellGap*4;
    return {cardHeight,cardWidth,bay,action,slot,board,required:board+bay*2+pileGap*2+outer*2};
  };
  let footer=compact?16:0,cardHeight=(available-rowGap*2-footer*2)/4;
  let m=measure(cardHeight,compact);
  while(m.required>fieldWidth&&cardHeight>24){cardHeight-=.5;m=measure(cardHeight,compact);}
  // A tablet can be height-rich but width-limited. Keep its action gutters
  // and use the spare height for clearer hands rather than clipping a row.
  const spare=Math.max(0,available-rowGap*2-footer*2-cardHeight*4);
  topHand+=spare/2;bottomHand+=spare/2;
  const mat=cardHeight*2+rowGap+footer,boardOffset=compact?0:(m.slot-m.bay)/2;
  return {...m,compact,phase,bottomInset,fieldWidth,footer,rowGap,cellGap,pileGap,topHand,bottomHand,mat,boardOffset,
    topSide:topHand+handGap+mat,bottomSide:bottomHand+handGap+mat,sideGap,
    values:{'--phase-width':phase,'--phase-gap':phaseGap,'--card-height':cardHeight,'--card-width':m.cardWidth,'--art-bay':m.bay,'--action-width':m.action,'--slot-width':m.slot,'--board-width':m.board,'--board-offset':boardOffset,'--stat-footer':footer,'--row-gap':rowGap,'--cell-gap':cellGap,'--pile-gap':pileGap,'--ai-hand-size':topHand,'--player-hand-size':bottomHand,'--hand-card-size':handCardSize,'--ai-side-height':topHand+handGap+mat,'--player-side-height':bottomHand+handGap+mat,'--side-gap':sideGap}};
}

export function applyArenaGeometry(table,width,height,options){
  const layout=arenaGeometry(width,height,options);
  for(const [key,value] of Object.entries(layout.values))table.style.setProperty(key,`${Math.round(value*100)/100}px`);
  table.dataset.compactField=String(layout.compact);return layout;
}

// Hand fitting is an overlay calculation. It never changes a field track.
// Expanded hands lift above the controls. The toggle keeps its normal position.
export function handGeometry(width,height,{count,expanded=false,baseSize=64,bottomInset=4,dockWidth}={}){
  count=Math.max(0,Math.floor(Number(count)||0));
  bottomInset=clamp(Number(bottomInset)||0,0,60);
  const dock=clamp(Number(dockWidth)||width*.27,188,224),lp=clamp(width*.1,76,104);
  const toggle=30,toggleGap=5,gap=count>12?1:3;
  const normalLifted=width-(lp+12)-(dock+12)<150;
  const fit=large=>{
    const lifted=large||normalLifted,left=lifted?8:lp+28,right=lifted?8:dock+12;
    const available=Math.max(52,width-left-right),reserve=large?0:toggle+toggleGap;
    const target=Math.min(baseSize*(large?2:1),height*.48);
    const cardWidth=count?Math.max(1,Math.min(target*.686,(available-reserve-gap*(count-1))/count)):0;
    const cardHeight=count?cardWidth/.686:target,cardSpan=count?cardWidth*count+gap*(count-1):80;
    return {cardWidth,cardHeight,rackWidth:cardSpan,left:left+(available-cardSpan-reserve)/2+reserve,bottom:bottomInset+(lifted?48:0)};
  };
  const normal=fit(false);
  const rightLimit=normalLifted?width-8:width-dock-8;
  const shiftRight=Math.min(8,Math.max(0,rightLimit-normal.left-normal.rackWidth));
  const hand=expanded?fit(true):{...normal,left:normal.left+shiftRight,bottom:normalLifted?normal.bottom:Math.max(-4,normal.bottom-16)};
  // Use spare space below/right of the default cards without pushing a full
  // rack into the controls or increasing the existing bottom-edge allowance.
  // The zoom toggle and expanded overlay retain their own positions.
  const toggleLeft=Math.max(normalLifted?8:lp+28,normal.left-toggle-toggleGap-20),toggleBottom=normal.bottom+Math.max(0,(normal.cardHeight-32)/2-10);
  return {...hand,toggleLeft,toggleBottom,
    values:{'--hand-display-height':hand.cardHeight,'--hand-display-width':hand.cardWidth,'--hand-card-gap':gap,'--hand-rack-width':hand.rackWidth,'--hand-rack-left':hand.left,'--hand-rack-bottom':hand.bottom,'--hand-toggle-left':toggleLeft,'--hand-toggle-bottom':toggleBottom}};
}
