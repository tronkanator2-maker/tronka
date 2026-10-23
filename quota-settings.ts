// Operational limits approved in the latest owner addendum of the specification.
// Owners may edit them in /admin; moderators and users cannot.
export const QUOTA_DEFINITIONS=Object.freeze({
 free_responses_week:{title:"Бесплатных откликов в неделю",value:1,min:0,max:50},
 free_invitations_week:{title:"Бесплатных приглашений в неделю",value:1,min:0,max:50},
 free_active_jobs:{title:"Активных заявок без подписки",value:1,min:1,max:50},
 paid_active_jobs:{title:"Активных заявок с полным доступом",value:10,min:1,max:100},
 free_daily_jobs:{title:"Уникальных заявок в сутки без подписки",value:5,min:0,max:100},
 free_daily_profiles:{title:"Уникальных анкет в сутки без подписки",value:3,min:0,max:100},
 free_inbound_responses:{title:"Откликов на бесплатную собственную заявку",value:5,min:1,max:500}
});
export const quotaKeys=Object.freeze(Object.keys(QUOTA_DEFINITIONS));
export function validateQuota(key,value){
 const definition=QUOTA_DEFINITIONS[String(key)];
 if(!definition)throw Error("Неизвестный лимит");
 const number=Number(value);
 if(!Number.isSafeInteger(number)||number<definition.min||number>definition.max||String(value).trim()==="")
  throw Error("Укажите целое число от "+definition.min+" до "+definition.max);
 return {key:String(key),value:number};
}
export async function prepareQuotaSettings(sql){
 await sql(`CREATE TABLE IF NOT EXISTS mm_quota_settings(
  key TEXT PRIMARY KEY,value INTEGER NOT NULL CHECK(value>=0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 )`);
}
export async function readQuotaSettings(sql){
 const rows=await sql("SELECT key,value,updated_at FROM mm_quota_settings");
 const values=new Map(rows.map(x=>[String(x.key),Number(x.value)]));
 return quotaKeys.map(key=>{
  const d=QUOTA_DEFINITIONS[key],stored=values.get(key);
  return {key,title:d.title,value:Number.isSafeInteger(stored)&&stored>=d.min&&stored<=d.max?stored:d.value,
   default_value:d.value,min:d.min,max:d.max,updated_at:rows.find(r=>r.key===key)?.updated_at||null};
 });
}
export async function getQuotaValue(sql,key){
 const definition=QUOTA_DEFINITIONS[key];
 if(!definition)throw Error("Неизвестный лимит");
 const found=await sql("SELECT value FROM mm_quota_settings WHERE key=$1",key);
 const value=Number(found[0]?.value);
 return found.length && Number.isSafeInteger(value) && value>=definition.min && value<=definition.max
  ?value:definition.value;
}
export async function updateQuotaSetting(sql,key,value){
 const checked=validateQuota(key,value);
 const rows=await sql(`INSERT INTO mm_quota_settings(key,value,updated_at)
 VALUES($1,$2,NOW()) ON CONFLICT(key) DO UPDATE SET
 value=EXCLUDED.value,updated_at=NOW()
 RETURNING key,value,updated_at`,checked.key,checked.value);
 if(!rows.length)throw Error("Не удалось сохранить лимит");
 return rows[0];
}
