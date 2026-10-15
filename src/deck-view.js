const category = card => card.type === 'Spell Card' ? 'Spell' : card.type === 'Trap Card' ? 'Trap' : 'Monster';
const order = {Monster:0,Spell:1,Trap:2};
export function visibleDeckEntries(entries,{query='',category:kind='All',sort='type'}={}) {
  const search=query.trim().toLowerCase();
  return entries.filter(({card})=>(kind==='All'||category(card)===kind)&&(!search||[card.name,card.type,card.race,card.archetype,card.desc].some(value=>value?.toLowerCase().includes(search)))).sort((a,b)=>{
    const left=a.card,right=b.card,name=left.name.localeCompare(right.name);
    if(sort==='az')return name;
    if(['atk','def','level'].includes(sort))return (right[sort]??-1)-(left[sort]??-1)||name;
    return order[category(left)]-order[category(right)]||name;
  });
}
