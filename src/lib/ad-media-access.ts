import { createHmac, timingSafeEqual } from "node:crypto";
type Kind="ig"|"video";
function signature(kind:Kind,id:string,accountId:string,clientId:string,expires:string){
 if(!process.env.JWT_SECRET)throw Error("Chave de acesso indisponível.");
 return createHmac("sha256",process.env.JWT_SECRET).update(`ad-asset:${kind}:${id}:${accountId}:${clientId}:${expires}`).digest("hex");
}
export function signedAdAssetPath(kind:Kind,id:string,accountId:string,clientId:string):string {
 if(!/^\d+$/.test(id)||!/^(?:act_)?\d+$/.test(accountId))throw Error("Mídia inválida.");
 const expires=String(Math.floor(Date.now()/1000)+3600);
 return `/api/meta/${kind}/${id}?`+new URLSearchParams({accountId,expires,assetAccess:signature(kind,id,accountId,clientId,expires)});
}
export function verifyAdAssetAccess(url:URL,kind:Kind,id:string,clientId:string):boolean {
 const accountId=url.searchParams.get("accountId"),expires=url.searchParams.get("expires"),supplied=url.searchParams.get("assetAccess");
 const now=Math.floor(Date.now()/1000);
 if(!/^\d+$/.test(id)||!accountId||!/^(?:act_)?\d+$/.test(accountId)||!expires||!/^\d{10}$/.test(expires)||Number(expires)<now||Number(expires)>now+3600||!supplied||!/^[a-f0-9]{64}$/.test(supplied))return false;
 return timingSafeEqual(Buffer.from(supplied,"hex"),Buffer.from(signature(kind,id,accountId,clientId,expires),"hex"));
}
