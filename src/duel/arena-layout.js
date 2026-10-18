const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

// Fit four card rows to the actual safe-area-adjusted table, then size the
// columns from those cards instead of spreading five slots across the screen.
export function arenaGeometry(width,height,{rightInset=0,expandedHand=false}={}){
  width=Math.max(320,width);height=Math.max(240,height);
  rightInset=clamp(Number(rightInset)||0,0,100);
  const phase=(width<640?24:28)+rightInset,phaseGap=4,fieldWidth=width-8-phase-phaseGap;
  let topHand=clamp(height*.05,16,26),bottomHand=clamp(height*.14,52,80)*(expandedHand?2:1);
  const handCardSize=bottomHand;
  const rowGap=3,sideGap=14,handGap=2,pileGap=18,outer=28,cellGap=4;
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
  const mat=cardHeight*2+rowGap+footer;
  return {...m,compact,phase,rightInset,fieldWidth,footer,rowGap,cellGap,pileGap,topHand,bottomHand,mat,
    topSide:topHand+handGap+mat,bottomSide:bottomHand+handGap+mat,sideGap,
    values:{'--phase-width':phase,'--phase-safe':rightInset,'--phase-gap':phaseGap,'--card-height':cardHeight,'--card-width':m.cardWidth,'--art-bay':m.bay,'--action-width':m.action,'--slot-width':m.slot,'--board-width':m.board,'--stat-footer':footer,'--row-gap':rowGap,'--cell-gap':cellGap,'--pile-gap':pileGap,'--ai-hand-size':topHand,'--player-hand-size':bottomHand,'--hand-card-size':handCardSize,'--ai-side-height':topHand+handGap+mat,'--player-side-height':bottomHand+handGap+mat,'--side-gap':sideGap}};
}

export function applyArenaGeometry(table,width,height,options){
  const layout=arenaGeometry(width,height,options);
  for(const [key,value] of Object.entries(layout.values))table.style.setProperty(key,`${Math.round(value*100)/100}px`);
  table.dataset.compactField=String(layout.compact);return layout;
}
