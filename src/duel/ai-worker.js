import {chooseAIAction} from './native-ai.js';

self.onmessage=({data})=>{
  try{self.postMessage({request:data.request,id:chooseAIAction(data.state,data.side,{learning:data.learning})?.id||null});}
  catch{self.postMessage({request:data.request,error:true});}
};
