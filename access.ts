// Billing-independent entitlements. Payment gateway callbacks must be verified separately.
export function weekStartMoscow(date=new Date()){
  const local=new Date(date.getTime()+3*3600000);
  const day=(local.getUTCDay()+6)%7; // Monday = 0
  const localMidnight=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate());
  return new Date(localMidnight-day*86400000-3*3600000);
}
export function hasPaidAccess(user,at=new Date()){
  const until=user?.access_until?new Date(user.access_until).getTime():0;
  const trial=user?.trial_until?new Date(user.trial_until).getTime():0;
  return Math.max(until,trial)>at.getTime();
}
export function normalizePhone(s){
  let x=String(s||"").replace(/\D/g,"");
  if(x.length===11&&x[0]==="8")x="7"+x.slice(1);
  if(x.length<10||x.length>15)return null;
  return x;
}
export async function prepareEntitlements(sql){
 await sql("ALTER TABLE mm_users ADD COLUMN IF NOT EXISTS trial_until TIMESTAMPTZ");
 await sql("ALTER TABLE mm_users ADD COLUMN IF NOT EXISTS access_until TIMESTAMPTZ");
 await sql("CREATE TABLE IF NOT EXISTS mm_trial_ledger(fingerprint TEXT PRIMARY KEY,first_user BIGINT NOT NULL,claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
 await sql("CREATE INDEX IF NOT EXISTS mm_trial_owner ON mm_trial_ledger(first_user)");
}
async function fingerprint(phone,pepper){
 const bytes=new TextEncoder().encode(pepper+"|"+phone);
 const buffer=await crypto.subtle.digest("SHA-256",bytes);
 return [...new Uint8Array(buffer)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
export async function startPhoneTrial(sql,id,phone,pepper){
 const normalized=normalizePhone(phone);
 if(!normalized||!pepper)return {started:false,reason:"phone or environment not configured"};
 const fp=await fingerprint(normalized,pepper);
 // One SQL statement guarantees the phone claim and trial grant are atomic.
 // A failed grant never consumes the user's one-time trial.
 const updated=await sql(`WITH claimed AS (
   INSERT INTO mm_trial_ledger(fingerprint,first_user)
   VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING first_user
 ), granted AS (
   UPDATE mm_users SET trial_until=NOW()+INTERVAL '15 days'
   WHERE id=$2 AND trial_until IS NULL AND EXISTS(SELECT 1 FROM claimed)
   RETURNING trial_until
 ) SELECT trial_until FROM granted`,fp,id);
 return {started:updated.length>0,until:updated[0]?.trial_until||null,reason:updated.length?"":"trial already claimed"};
}
