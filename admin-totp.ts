// RFC 6238 TOTP (HMAC-SHA1, 30s, six digits).
// Owner provides ADMIN_TOTP_SECRET through hosting secrets. Never store it in DB,
// print it to logs or return it to clients.
const b32="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function decodeTotpSecret(secret){
 const value=String(secret||"").replace(/[=\s-]/g,"").toUpperCase();
 if(value.length<16||/[^A-Z2-7]/.test(value))return null;
 let bits=0,buffer=0;const out=[];
 for(const ch of value){
  buffer=(buffer<<5)|b32.indexOf(ch);bits+=5;
  if(bits>=8){bits-=8;out.push((buffer>>bits)&255)}
 }
 return out.length>=10?new Uint8Array(out):null;
}
export async function totpCode(secret,now=Date.now()){
 const key=decodeTotpSecret(secret);
 if(!key||!Number.isFinite(now)||now<0)throw Error("Invalid TOTP configuration");
 const step=Math.floor(now/30000);
 const buffer=new ArrayBuffer(8),dv=new DataView(buffer);
 dv.setUint32(0,Math.floor(step/4294967296),false);
 dv.setUint32(4,step>>>0,false);
 const imported=await crypto.subtle.importKey("raw",key,{name:"HMAC",hash:"SHA-1"},false,["sign"]);
 const digest=new Uint8Array(await crypto.subtle.sign("HMAC",imported,buffer));
 const offset=digest[digest.length-1]&15;
 const raw=((digest[offset]&127)<<24)|(digest[offset+1]<<16)|(digest[offset+2]<<8)|digest[offset+3];
 return String(raw%1000000).padStart(6,"0");
}
export async function verifyAdminTotp(secret,submitted,now=Date.now()){
 if(typeof submitted!=="string"||!/^[0-9]{6}$/.test(submitted)||!decodeTotpSecret(secret))return false;
 // One preceding and following 30s period tolerate minor device clock drift.
 let match=0;
 for(const step of [-30000,0,30000]){
  if(now+step<0)continue;
  const expected=await totpCode(secret,now+step);
  let different=0;for(let i=0;i<6;i++)different|=submitted.charCodeAt(i)^expected.charCodeAt(i);
  match|=Number(different===0);
 }
 return match===1;
}
