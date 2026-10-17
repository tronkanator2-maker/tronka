import {SQL} from "bun";
import {Api,TelegramClient} from "teleproto";
import {StringSession} from "teleproto/sessions";
import {NewMessage} from "teleproto/events";
import {parseSourcePost,moderate,normalizePost,extractContact,isExplicitAdultCasting,inferCity} from "./engine.ts";

// Isolated optional MTProto collector. Runs only with a user-authorized session,
// observes chats this user may access, and never tries to bypass private invite links.
const cfg={
 apiId:Number(Bun.env.TG_API_ID||0),apiHash:Bun.env.TG_API_HASH||"",
 session:Bun.env.TG_STRING_SESSION||"",db:Bun.env.DATABASE_URL||"",
 searchTerms:(Bun.env.COLLECTOR_SEARCH_TERMS||"кастинг Москва|ищу модель Москва|TFP Санкт-Петербург|визажист кастинг|актёр массовка|кастинги Минск|съёмка Алматы|кастинг Казань|промоутер Москва|фотограф ТФП").split("|").map(x=>x.trim()).filter(Boolean)
};
if(!cfg.apiId||!cfg.apiHash||!cfg.session||!cfg.db)throw Error("Collector disabled. Configure TG_API_ID, TG_API_HASH, TG_STRING_SESSION and DATABASE_URL.");
const db=new SQL(cfg.db);
const query=(q,...p)=>db.unsafe(q,p);
const client=new TelegramClient(new StringSession(cfg.session),cfg.apiId,cfg.apiHash,{connectionRetries:5});
const dateFrom=message=>{
 const raw=message?.date;
 return raw instanceof Date?raw:(typeof raw==="number"?new Date(raw*1000):new Date(raw||0));
};
const from30=new Date(Date.now()-30*86400000),from14=new Date(Date.now()-14*86400000);
const titleOf=x=>String(x?.title||x?.username||"").slice(0,200);
function topicOf(title){
 const t=String(title||"").toLowerCase();
 for(const [tag,re] of [["плюс-сайз",/плюс.сайз|plus.size/],["ТФП",/тфп|tfp/],["хостес",/хостес/],["дети",/детск|дети|ребёнок|ребенок/],["актёры",/акт[её]р|массовк/]])if(re.test(t))return tag;
 return "";
}
async function init(){
 await query("CREATE TABLE IF NOT EXISTS mm_candidate_sources(id BIGINT PRIMARY KEY,username TEXT,title TEXT,status TEXT NOT NULL,reason TEXT,unique30 INTEGER NOT NULL DEFAULT 0,total30 INTEGER NOT NULL DEFAULT 0,first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
 await query("CREATE TABLE IF NOT EXISTS mm_collector_checkpoint(source_id BIGINT PRIMARY KEY,last_message_id BIGINT NOT NULL DEFAULT 0,checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
 await query("CREATE TABLE IF NOT EXISTS mm_collector_meta(id INTEGER PRIMARY KEY,last_discovery_day DATE,search_index INTEGER NOT NULL DEFAULT 0)");
 await query("INSERT INTO mm_collector_meta(id) VALUES(1) ON CONFLICT DO NOTHING");
}
async function queuePost(sourceId,message){
 const body=String(message?.message||message?.text||"").trim().slice(0,5000);
 if(!body||!message.id)return;
 await query("INSERT INTO mm_collector_inbox(source_id,telegram_message_id,body) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",sourceId,Number(message.id),body);
}
async function hasBeenReviewed(id){
 const row=await query("SELECT 1 FROM mm_candidate_sources WHERE id=$1",id);
 return !!row.length;
}
async function evaluate(entity){
 const id=Number(await client.getPeerId(entity));
 if(!Number.isSafeInteger(id)||await hasBeenReviewed(id))return;
 const username=entity.username?String(entity.username):null;
 const title=titleOf(entity),city=inferCity(title,"");
 let total=0,stop=0,unique=new Set(),last=null,childRisk=false;
 try{
  // Traverse the entire 30-day time window; no fixed "last 100 messages" shortcut.
  for await(const msg of client.iterMessages(entity)){
   const date=dateFrom(msg);if(date<from30)break;
   if(!last||date>last)last=date;
   const raw=String(msg.message||"");if(!raw.trim())continue;
   total++;
   if(moderate(raw).status==="reject")stop++;
   const info=parseSourcePost(raw,{city,topic:topicOf(title)});
   if(info)unique.add(String(extractContact(raw))+"|"+normalizePost(raw));
   if(/несовершеннолет|до\s+1[0-7]\s+лет|дети\s+1[0-7]\s+лет/i.test(raw)&&isExplicitAdultCasting(raw))childRisk=true;
  }
 }catch(e){console.error("source sample not accessible:",title,String(e));return}
 let status="rejected",reason="";
 if(childRisk){status="needs_review";reason="Риск 18+ с участием несовершеннолетних";}
 else if(unique.size<3)reason="Меньше 3 уникальных заявок за 30 дней";
 else if(!last||last<from14)reason="Последнее сообщение старше 14 дней";
 else if(total>0&&stop/total>=.50)reason="50% и больше сообщений со стоп-словами";
 else status="active";
 await query("INSERT INTO mm_candidate_sources(id,username,title,status,reason,unique30,total30) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",id,username,title,status,reason,unique.size,total);
 if(status==="active"){
  await query("INSERT INTO mm_sources(id,title,city,topic,username,active,mode) VALUES($1,$2,$3,$4,$5,TRUE,'trial') ON CONFLICT(id) DO NOTHING",id,title,city,topicOf(title),username);
  console.log("Authorized public source connected:",title,String(id));
 }else console.log("Source reviewed:",title,status);
}
async function discover(){
 const meta=(await query("SELECT * FROM mm_collector_meta WHERE id=1"))[0];
 const today=new Date().toISOString().slice(0,10);
 if(String(meta.last_discovery_day||"").slice(0,10)===today)return;
 const terms=cfg.searchTerms;let index=meta.search_index||0;
 for(let i=0;i<Math.min(4,terms.length);i++){
  const term=terms[(index+i)%terms.length];
  try{
   const result=await client.invoke(new Api.contacts.Search({q:term,limit:100}));
   for(const chat of result.chats||[]){
    if(!chat.username)continue; // private and invite-only chats need existing authorized membership
    await evaluate(chat);
   }
  }catch(e){console.error("Discovery query unavailable:",term,String(e))}
  await Bun.sleep(1600);
 }
 index=(index+4)%terms.length;
 await query("UPDATE mm_collector_meta SET search_index=$1,last_discovery_day=$2 WHERE id=1",index,today);
}
async function ingestSinceCheckpoint(source){
 const peer=source.username?"@"+source.username:source.id;
 const latest=(await query("SELECT last_message_id FROM mm_collector_checkpoint WHERE source_id=$1",source.id))[0]?.last_message_id||0;
 let newest=Number(latest),collected=[],n=0;
 try{
  for await(const msg of client.iterMessages(peer)){
   const id=Number(msg.id);
   if(id<=Number(latest)||dateFrom(msg)<from14)break;
   newest=Math.max(newest,id);collected.push(msg);n++;
   // The lower bound is a date, not a fixed recent-message count.
  }
  for(const message of collected.reverse())await queuePost(source.id,message);
  if(newest>Number(latest))await query("INSERT INTO mm_collector_checkpoint(source_id,last_message_id) VALUES($1,$2) ON CONFLICT(source_id) DO UPDATE SET last_message_id=GREATEST(mm_collector_checkpoint.last_message_id,EXCLUDED.last_message_id),checked_at=NOW()",source.id,newest);
 }catch(e){console.error("Source catchup unavailable:",String(source.id),String(e))}
}
async function activeCatchup(){
 const rows=await query("SELECT id,username FROM mm_sources WHERE active=TRUE ORDER BY id LIMIT 250");
 for(const source of rows){await ingestSinceCheckpoint(source);await Bun.sleep(400)}
}
async function main(){
 await init();await client.connect();
 if(!await client.isUserAuthorized())throw Error("MTProto session is not authorized. Authenticate the owner's own account offline and configure TG_STRING_SESSION.");
 client.addEventHandler(async ev=>{
  try{
   const message=ev.message;if(!message?.peerId)return;
   const id=Number(await client.getPeerId(message.peerId));
   const rows=await query("SELECT 1 FROM mm_sources WHERE id=$1 AND active=TRUE",id);
   if(rows.length)await queuePost(id,message);
  }catch(e){console.error("collector live event",String(e))}
 },new NewMessage({}));
 console.log("Collector connected and listening to accessible source messages.");
 const tick=async()=>{
  try{await discover();await activeCatchup()}catch(e){console.error("collector maintenance",String(e))}
 };
 await tick();
 setInterval(tick,15*60*1000);
}
main().catch(e=>{console.error("Collector startup failed:",String(e));process.exitCode=1});
