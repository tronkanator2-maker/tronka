import {getQuotaValue} from "./quota-settings.ts";
import {withUserActionLock} from "./quota-actions.ts";

// Calendar days are counted in Moscow (+03:00), as required by the owner.
// Known cards do not consume another daily view when reopened.
export function moscowCalendarDay(at=new Date()){
 const date=at instanceof Date?at:new Date(at);
 if(!Number.isFinite(date.getTime()))throw Error("Invalid calendar time");
 return new Date(date.getTime()+3*3600000).toISOString().slice(0,10);
}
export async function prepareDailyViews(sql){
 await sql(`CREATE TABLE IF NOT EXISTS mm_daily_views(
   user_id BIGINT NOT NULL,
   kind TEXT NOT NULL CHECK(kind IN ('job','profile')),
   item_id BIGINT NOT NULL,
   day DATE NOT NULL,
   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
   PRIMARY KEY(user_id,kind,item_id,day)
 )`);
 await sql("CREATE INDEX IF NOT EXISTS mm_daily_views_count ON mm_daily_views(user_id,kind,day)");
}
export async function claimDailyView(db,{userId,kind,itemId,paid=false,at=new Date()}){
 const user=Number(userId),item=Number(itemId),type=String(kind||"");
 if(!Number.isSafeInteger(user)||user<=0||!Number.isSafeInteger(item)||item<=0||!["job","profile"].includes(type))
  return {allowed:false,reason:"invalid"};
 if(paid)return {allowed:true,already:false,paid:true};
 const day=moscowCalendarDay(at);
 return withUserActionLock(db,user,async sql=>{
  const found=await sql("SELECT 1 FROM mm_daily_views WHERE user_id=$1 AND kind=$2 AND item_id=$3 AND day=$4",user,type,item,day);
  if(found.length)return {allowed:true,already:true,day};
  const cap=await getQuotaValue(sql,type==="job"?"free_daily_jobs":"free_daily_profiles");
  const used=await sql("SELECT COUNT(*)::int AS n FROM mm_daily_views WHERE user_id=$1 AND kind=$2 AND day=$3",user,type,day);
  const count=Number(used[0]?.n||0);
  if(count>=cap)return {allowed:false,reason:"limit",limit:cap,day};
  const inserted=await sql("INSERT INTO mm_daily_views(user_id,kind,item_id,day) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING item_id",user,type,item,day);
  return {allowed:true,already:!inserted.length,day,limit:cap,remaining:Math.max(0,cap-count-(inserted.length?1:0))};
 });
}
// Used only when delivery never reached Telegram; a successful send is never refunded.
export async function releaseUnsentDailyView(sql,{userId,kind,itemId,day}){
 if(!Number.isSafeInteger(Number(userId))||!Number.isSafeInteger(Number(itemId))||!["job","profile"].includes(kind)||!/^\d{4}-\d\d-\d\d$/.test(String(day||"")))
  return false;
 await sql("DELETE FROM mm_daily_views WHERE user_id=$1 AND kind=$2 AND item_id=$3 AND day=$4",Number(userId),kind,Number(itemId),day);
 return true;
}
export function dailyLimitText(kind,limit){
 return kind==="profile"
  ?"Сегодня вы уже посмотрели "+limit+" новых анкет. Повторно открыть ранее просмотренные можно без ограничений. Новые анкеты будут доступны после полуночи по Москве."
  :"Сегодня вы уже посмотрели "+limit+" новых заявок. Ранее просмотренные можно открывать повторно. Новые заявки будут доступны после полуночи по Москве.";
}
