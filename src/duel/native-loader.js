let pending;
export async function loadNativeRules({fetchImpl=fetch, wasmBinary}={}) {
  const base=new URL('../../assets/rules/',import.meta.url);
  const get=async path=>{const response=await fetchImpl(new URL(path,base));if(!response.ok)throw new Error('The offline rules pack could not load. Reload and retry.');return response.json();};
  const manifest=await get('manifest.json'),scripts={},data={};
  await Promise.all(manifest.files.map(async file=>Object.assign(file.path.startsWith('scripts-')?scripts:data,await get(file.path))));
  if(!wasmBinary){const response=await fetchImpl(new URL('../../vendor/ocgcore/lib/ocgcore.sync.wasm',import.meta.url));if(!response.ok)throw new Error('The offline rules runtime could not load. Reload and retry.');wasmBinary=new Uint8Array(await response.arrayBuffer());}
  const module=await import('../../vendor/ocgcore/dist/index.js');
  const lib=await module.default({sync:true,wasmBinary,locateFile:name=>new URL('../../vendor/ocgcore/lib/'+name,import.meta.url).href});
  const records=new Map(Object.entries(data).map(([code,row])=>{
    let packed=BigInt(row[1]);const setcodes=[];while(packed){setcodes.push(Number(packed&65535n));packed>>=16n;}
    return [Number(code),{code:Number(code),alias:row[0],setcodes,type:row[2],attack:row[3],defense:row[4],level:row[5]&255,lscale:(row[5]>>>24)&255,rscale:(row[5]>>>16)&255,race:BigInt(row[6]),attribute:row[7],link_marker:row[2]&0x4000000?row[4]:0,name:row[8],descriptions:row[9]}];
  }));
  return {module,lib,scripts,records,manifest};
}
export const defaultNativeRules=()=>pending ||= loadNativeRules().catch(error=>{pending=null;throw error;});
