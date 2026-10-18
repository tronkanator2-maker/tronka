// Telegram /start parameters are untrusted and must fit callback_data <=64 bytes.
export function parseStartTarget(text){
 const raw=String(text||"").trim();
 const parts=raw.match(/^\/start(?:@\w+)?(?:\s+(job|profile)_(\d{1,19}))?(?:\s*)$/i);
 if(!parts||!parts[1])return null;
 const number=Number(parts[2]);
 if(!Number.isSafeInteger(number)||number<=0)return null;
 return {kind:parts[1].toLowerCase(),id:number,callback:parts[1].toLowerCase()+"_"+number};
}
export function parseOnboardTarget(action){
 const match=String(action||"").match(/^(job|profile)_(\d{1,19})$/);
 if(!match)return null;
 const number=Number(match[2]);
 return Number.isSafeInteger(number)&&number>0?{kind:match[1],id:number}:null;
}
