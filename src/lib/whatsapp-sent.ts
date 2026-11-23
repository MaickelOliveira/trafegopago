/** Recent platform sends, isolated by provider instance and recipient. */
const sentRegistry=new Map<string,string[]>();
const sendingRegistry=new Map<string,{expiry:number;usesLeft:number}>();
const key=(phone:string,scope:string)=>JSON.stringify([scope,phone]);
export function markPhoneSending(phone:string,scope=""){
 const id=key(phone,scope),expiry=Date.now()+8000;sendingRegistry.set(id,{expiry,usesLeft:2});
 const timer=setTimeout(()=>{if((sendingRegistry.get(id)?.expiry??0)<=Date.now())sendingRegistry.delete(id);},8000);timer.unref?.();
}
export function isPhoneSending(phone:string,scope=""):boolean{
 const id=key(phone,scope),entry=sendingRegistry.get(id);if(!entry)return false;if(entry.expiry<=Date.now()){sendingRegistry.delete(id);return false;}if(--entry.usesLeft<=0)sendingRegistry.delete(id);return true;
}
export function markSent(phone:string,content:string,scope=""){
 const id=key(phone,scope),list=sentRegistry.get(id)??[];list.push(content);sentRegistry.set(id,list);
 const timer=setTimeout(()=>{const current=sentRegistry.get(id);if(!current)return;const index=current.indexOf(content);if(index>=0)current.splice(index,1);if(!current.length)sentRegistry.delete(id);},60000);timer.unref?.();
}
export function consumeSent(phone:string,content:string,scope=""):boolean{
 const id=key(phone,scope),list=sentRegistry.get(id),index=list?.indexOf(content)??-1;if(!list||index<0)return false;list.splice(index,1);if(!list.length)sentRegistry.delete(id);return true;
}
