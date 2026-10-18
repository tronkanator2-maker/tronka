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

/** Referred users must finish onboarding before the referral is recorded. */
export function parseReferralStart(text){
 const m=String(text||"").trim().match(/^\/start(?:@\w+)?\s+ref_(\d{1,19})$/i);
 if(!m)return null;
 const id=Number(m[1]);
 return Number.isSafeInteger(id)&&id>0?{kind:"ref",id,callback:"ref_"+id}:null;
}
export function parseReferralOnboard(action){
 const m=String(action||"").match(/^ref_(\d{1,19})$/);
 if(!m)return null;
 const id=Number(m[1]);
 return Number.isSafeInteger(id)&&id>0?{kind:"ref",id}:null;
}
/** Keep only validated callbacks in persisted registration intent. */
export function safeRegistrationTarget(action){
 const normalized=String(action||"");
 return parseOnboardTarget(normalized)||parseReferralOnboard(normalized)?normalized:null;
}
