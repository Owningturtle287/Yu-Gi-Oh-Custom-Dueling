import {DUEL_SAVES_KEY,validDuelEntry} from './saves.js';
export const RECOVERY_PREFIX='duel-atlas.recovery.v1.';
export function readRecoveries(storage){
  const entries=[];let rejected=0;
  try{for(let i=0;i<(storage?.length||0);i++){const key=storage.key(i);if(!key?.startsWith(RECOVERY_PREFIX))continue;try{const entry=JSON.parse(storage.getItem(key));if(validDuelEntry(entry)&&key===RECOVERY_PREFIX+entry.id)entries.push(entry);else rejected++;}catch{rejected++;}}return {entries:entries.sort((a,b)=>(b.savedAt||0)-(a.savedAt||0)),rejected,error:null};}
  catch{return {entries:[],rejected,error:'Interrupted duels could not be read. Existing data was preserved.'};}
}
export function writeRecovery(storage,entry){
  if(!storage)throw Error('Browser storage is unavailable.');
  const key=RECOVERY_PREFIX+entry.id,raw=storage.getItem(key);
  if(raw){let previous;try{previous=JSON.parse(raw);}catch{throw Error('The recovery checkpoint is damaged and was preserved.');}if(previous?.id!==entry.id||previous.replay?.version!==1)throw Error('The recovery checkpoint is damaged and was preserved.');}
  storage.setItem(key,JSON.stringify(entry));
}
export const removeRecovery=(storage,id)=>{if(id)storage?.removeItem(RECOVERY_PREFIX+id);};
export function exportDuelRecovery(storage){
  const data={savedDuels:storage.getItem(DUEL_SAVES_KEY),interruptedDuels:{}};
  for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key?.startsWith(RECOVERY_PREFIX))data.interruptedDuels[key]=storage.getItem(key);}return JSON.stringify(data,null,2);
}
