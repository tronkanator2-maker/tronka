import {SQL} from "bun";
import {adminApp} from "./admin.ts";
import {payMatches,formatMatches} from "./pricing.ts";
import {exportAccount,deleteAccount,sendAccountExport} from "./privacy.ts";
import {parseWithModel} from "./ai-parser.ts";
import {prepareDocuments,legalReady,recordConsent,publicDocumentRoute,latestDocuments,documentHashes,allConsentsCurrent,consentIsCurrent} from "./documents.ts";
import {prepareEntitlements,startPhoneTrial,hasPaidAccess,weekStartMoscow} from "./access.ts";
import {setupFeedback, scheduleFeedback, feedbackTick, feedbackCallback, feedbackText, feedbackSummary} from "./feedback.ts";
import {ROLES, MODEL_ROLES, parseFields, field, ageAt, jobExpiresAt, moderate, parseSourcePost, extractContact, roleMatch, similarity, eligibleProfile, matchesCastingRequirements, isExplicitAdultCasting} from "./engine.ts";
const db=new SQL(Bun.env.DATABASE_URL||"postgres://unconfigured");
const token=Bun.env.BOT_TOKEN||"", secret=Bun.env.WEBHOOK_SECRET||"";
const admin=(Bun.env.ADMIN_IDS||"").split(",");
const roles=ROLES;
const menu={inline_keyboard:[[{text:"👤 Моя анкета",callback_data:"profile"},{text:"🎯 Фильтры",callback_data:"filters"}],[{text:"📢 Найти заявки",callback_data:"jobs"},{text:"➕ Разместить",callback_data:"new"}],[{text:"📌 Мои заявки",callback_data:"mine"},{text:"⏸️ Поиск вкл/выкл",callback_data:"pause"}],[{text:"🔎 Анкеты",callback_data:"browse:0"},{text:"📚 Статьи",callback_data:"articles"}],[{text:"🎁 Пригласить друга",callback_data:"invitefriend"},{text:"❓ Поддержка",callback_data:"support"}],[{text:"🔐 Мои данные",callback_data:"privacy"}]]};
const esc=s=>String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
async function sql(q,...v){return db.unsafe(q,v)}
async function setup(){
await sql("CREATE TABLE IF NOT EXISTS mm_users(id BIGINT PRIMARY KEY, username TEXT, first_name TEXT, phone TEXT, consent JSONB DEFAULT '{}', state TEXT DEFAULT '', profile JSONB DEFAULT '{}', filters JSONB DEFAULT '{}', photo TEXT, active BOOLEAN DEFAULT TRUE, blocked BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW())");
await sql("CREATE TABLE IF NOT EXISTS mm_jobs(id BIGSERIAL PRIMARY KEY,owner BIGINT NOT NULL,body JSONB NOT NULL,status TEXT DEFAULT 'active',created_at TIMESTAMPTZ DEFAULT NOW(),expires_at TIMESTAMPTZ DEFAULT NOW()+INTERVAL '14 days')");
await sql("CREATE TABLE IF NOT EXISTS mm_responses(id BIGSERIAL PRIMARY KEY,job_id BIGINT NOT NULL,user_id BIGINT NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW(),UNIQUE(job_id,user_id))");
await sql("CREATE TABLE IF NOT EXISTS mm_reports(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL,body TEXT,created_at TIMESTAMPTZ DEFAULT NOW())");
await sql("CREATE TABLE IF NOT EXISTS mm_updates(id BIGINT PRIMARY KEY)");
await sql("ALTER TABLE mm_updates ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()");
await sql("CREATE INDEX IF NOT EXISTS mm_update_age ON mm_updates(created_at)");
await sql("CREATE TABLE IF NOT EXISTS mm_sources(id BIGINT PRIMARY KEY,title TEXT DEFAULT '',city TEXT DEFAULT '',topic TEXT DEFAULT '',active BOOLEAN DEFAULT TRUE,created_at TIMESTAMPTZ DEFAULT NOW())");
await sql("CREATE TABLE IF NOT EXISTS mm_source_posts(source_id BIGINT NOT NULL,telegram_message_id BIGINT NOT NULL,job_id BIGINT,moderation TEXT NOT NULL,reason TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),PRIMARY KEY(source_id,telegram_message_id))");
await sql("CREATE TABLE IF NOT EXISTS mm_source_blacklist(source_id BIGINT NOT NULL,contact TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(source_id,contact))");
await sql("CREATE TABLE IF NOT EXISTS mm_deliveries(user_id BIGINT NOT NULL,job_id BIGINT NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW(),PRIMARY KEY(user_id,job_id))");
await sql("CREATE TABLE IF NOT EXISTS mm_fanout_queue(job_id BIGINT PRIMARY KEY, cursor_id BIGINT NOT NULL DEFAULT 0,profiles_done BOOLEAN NOT NULL DEFAULT FALSE,pending BOOLEAN NOT NULL DEFAULT TRUE,attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),completed_at TIMESTAMPTZ)");
await sql("CREATE INDEX IF NOT EXISTS mm_fanout_ready ON mm_fanout_queue(next_attempt_at) WHERE pending=TRUE");
await sql("CREATE TABLE IF NOT EXISTS mm_reports_v2(id BIGSERIAL PRIMARY KEY,reporter BIGINT NOT NULL,target_user BIGINT,target_job BIGINT,kind TEXT NOT NULL DEFAULT 'support',body TEXT NOT NULL DEFAULT '',photo TEXT,created_at TIMESTAMPTZ DEFAULT NOW())");
await sql("CREATE TABLE IF NOT EXISTS mm_profile_deliveries(job_id BIGINT NOT NULL,user_id BIGINT NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW(),PRIMARY KEY(job_id,user_id))");
await sql("CREATE TABLE IF NOT EXISTS mm_invitations(id BIGSERIAL PRIMARY KEY,from_user BIGINT NOT NULL,to_user BIGINT NOT NULL,job_id BIGINT,status TEXT DEFAULT 'sent',created_at TIMESTAMPTZ DEFAULT NOW())");
await sql("ALTER TABLE mm_users ADD COLUMN IF NOT EXISTS first_safety_sent_at TIMESTAMPTZ");
await sql("CREATE TABLE IF NOT EXISTS mm_admin_log(id BIGSERIAL PRIMARY KEY,actor BIGINT NOT NULL,action TEXT NOT NULL,details JSONB DEFAULT '{}',created_at TIMESTAMPTZ DEFAULT NOW())");
await sql("ALTER TABLE mm_jobs ADD COLUMN IF NOT EXISTS source_id BIGINT");
await sql("ALTER TABLE mm_jobs ADD COLUMN IF NOT EXISTS contact TEXT");
await sql("ALTER TABLE mm_jobs ADD COLUMN IF NOT EXISTS paused BOOLEAN NOT NULL DEFAULT FALSE");
await sql("ALTER TABLE mm_users ADD COLUMN IF NOT EXISTS suspended BOOLEAN NOT NULL DEFAULT FALSE");
await sql("ALTER TABLE mm_users ADD COLUMN IF NOT EXISTS first_source TEXT");
await sql("ALTER TABLE mm_users ADD COLUMN IF NOT EXISTS photos JSONB NOT NULL DEFAULT '[]'");
await sql("CREATE INDEX IF NOT EXISTS mm_jobs_active_expiry ON mm_jobs(status,expires_at)");
await sql("CREATE TABLE IF NOT EXISTS mm_referrals(inviter BIGINT NOT NULL,invitee BIGINT PRIMARY KEY,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CHECK(inviter<>invitee))");
await sql("CREATE INDEX IF NOT EXISTS mm_referrals_inviter ON mm_referrals(inviter,created_at)");

await sql("ALTER TABLE mm_reports_v2 ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new'");
await sql("ALTER TABLE mm_reports_v2 ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()");
await sql("CREATE TABLE IF NOT EXISTS mm_support_messages(id BIGSERIAL PRIMARY KEY,ticket_id BIGINT NOT NULL REFERENCES mm_reports_v2(id),sender TEXT NOT NULL,body TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
await sql("CREATE INDEX IF NOT EXISTS mm_support_message_ticket ON mm_support_messages(ticket_id,created_at)");

await setupFeedback(sql);
await prepareEntitlements(sql);
await prepareDocuments(sql);

}
let ready;function ensure(){return ready??=(setup().catch(e=>{ready=null;throw e}))}
async function call(method,p){const r=await fetch("https://api.telegram.org/bot"+token+"/"+method,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(p,(_,v)=>typeof v==="bigint"?Number(v):v)});const j=await r.json();if(!j.ok)console.error("Telegram",method,j.description);return j}
const send=async(id,text,markup)=>{
 const result=await call("sendMessage",{chat_id:id,text,parse_mode:"HTML",disable_web_page_preview:true,...markup?{reply_markup:markup}:{}});
 if(!result.ok && (result.error_code===429||result.error_code>=500))throw Error("Telegram delivery temporarily unavailable");
 return result;
};
const buttons=rows=>({inline_keyboard:rows.map(row=>row.map(([text,callback_data])=>({text,callback_data})))});
async function change(id,fields){let sets=[],vals=[];for(const [k,v] of Object.entries(fields)){vals.push(typeof v==="object"?JSON.stringify(v):v);sets.push(k+"=$"+vals.length+(typeof v==="object"?"::jsonb":""));}vals.push(id);await sql("UPDATE mm_users SET "+sets.join(",")+" WHERE id=$"+vals.length,...vals)}
async function who(f){await sql("INSERT INTO mm_users(id,username,first_name) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET username=EXCLUDED.username,first_name=EXCLUDED.first_name",f.id,f.username||null,f.first_name||"");return(await sql("SELECT * FROM mm_users WHERE id=$1",f.id))[0]}
const consentNames=["Оферта и правила сервиса","Обработка персональных данных","Показ анкеты другим"];
let cachedDocHashes=null,cachedDocHashesUntil=0;
async function currentDocumentHashes(){
 if(cachedDocHashes && Date.now()<cachedDocHashesUntil)return cachedDocHashes;
 const snapshot=await documentHashes(sql);
 cachedDocHashes=snapshot.hashes;cachedDocHashesUntil=Date.now()+2500;
 return cachedDocHashes;
}
function consentBoard(u,hashes){let c=u.consent||{};
 const ok=i=>consentIsCurrent(c,hashes,i);
 return buttons([...consentNames.map((x,i)=>[[(ok(i)?"✅ ":"☐ ")+x,"consent:"+i]]),[["📄 Документы","docs"]],...([0,1,2].every(ok)?[[["Продолжить","go"]]]:[])])}
async function begin(u){if(u.blocked)return send(u.id,"Аккаунт ограничен. /support");if(Bun.env.REGISTRATION_ENABLED!=="true"||!(await legalReady(sql)))return send(u.id,"«Мир моделей» готовится к запуску. Регистрация откроется после публикации юридических документов и проверки интеграций.");const hashes=await currentDocumentHashes();
 if(!allConsentsCurrent(u.consent,hashes))return send(u.id,"<b>Добро пожаловать в Мир моделей!</b>\nОзнакомьтесь с действующими документами и дайте три отдельных согласия.",consentBoard(u,hashes));if(!u.phone)return send(u.id,"Подтвердите ваш собственный номер через кнопку Telegram. Номер не будет опубликован.",{keyboard:[[{text:"📱 Поделиться номером",request_contact:true}]],resize_keyboard:true,one_time_keyboard:true});if(!u.username)return send(u.id,"Установите @имя пользователя в настройках Telegram, затем отправьте /start.");return send(u.id,"<b>✨ Мир моделей</b>\nВыберите раздел.",menu)}
const parse=parseFields;
const get=field;
const profileTpl="Кто вы: модель\nИмя: Анна\nДата рождения: 12.09.2002\nГород: Москва\nПол: женский\nРост: 172\nРазмер одежды: 42\nЦвет волос: русый\nДлина волос: длинные\nФормат: коммерция, ТФП\nПрайс: 3000 ₽/час\nО себе: съёмки каталогов\nПортфолио: https://example.com";
const clientTpl="Кто вы: фотограф\nИмя: Иван\nДата рождения: 05.03.1995\nГород: Москва\nОпыт и проекты: 4 года, снимал локальные бренды\nГонорар для модели: договорная\nО себе: снимаю каталог и лукбуки\nПортфолио: https://drive.google.com/...";
const jobTpl="Название заявки: Съёмка каталога\nКого ищу: модель\nТип работы: каталог\nГород: Москва\nТребования: женщина 20-30 лет\nФормат и оплата: 5000 ₽ за смену\nДата съёмки: 25.10.2026\nОписание: каталог одежды, 4 часа";
const bad=/эскорт|порнограф|содержанк|интим.услуг|ню\b|топлес|эротик|бдсм|фетиш/i;
function validProfile(p){
 const missing=["кто вы","имя","дата рождения","город"].filter(k=>!get(p,k));
 const age=ageAt(get(p,"дата рождения"));
 if(age===null||age<0||age>110)missing.push("корректная дата рождения");
 else if(age<18)missing.push("для несовершеннолетних нужна проверка родителя или опекуна — раздел пока недоступен");
 const selected=get(p,"кто вы").split(",").map(x=>x.trim().toLowerCase());
 if(selected.some(r=>!ROLES.includes(r)))missing.push("выберите роли из справочника");
 if(selected.some(x=>MODEL_ROLES.includes(x))&&selected.some(x=>!MODEL_ROLES.includes(x)))missing.push("модель и актёр не совмещаются с другими ролями");
 if(Object.entries(p).some(([k,v])=>!/telegram|контакт|телефон|instagram/i.test(k)&&/@\w{5,}/.test(v)))missing.push("контакты — только в специально отведённых полях");
 if(moderate(get(p,"о себе")).status==="reject")missing.push("запрещённая тема в описании");
 return [...new Set(missing)];
}
function validJob(p){
 const missing=["название заявки","кого ищу","тип работы","город","формат и оплата","описание"].filter(k=>!get(p,k));
 if(get(p,"название заявки").length>40)missing.push("название — максимум 40 символов");
 const sought=get(p,"кого ищу").split(",").map(x=>x.trim().toLowerCase());
 if(!sought.length||sought.some(r=>!ROLES.includes(r)&&r!=="модель в пару"))missing.push("укажите «Кого ищу» из справочника");
 const moderation=moderate(Object.values(p).join("\n"));
 if(moderation.status!=="accept")missing.push("объявление не прошло автоматическую проверку: "+moderation.reason);
 if(/@\w{5,}|https?:\/\//.test(get(p,"описание")))missing.push("контакты нельзя вставлять в описание");
 if(get(p,"дата съёмки")&&jobExpiresAt(get(p,"дата съёмки")).getTime()<Date.now())missing.push("дата съёмки уже прошла");
 return [...new Set(missing)];
}
async function profile(to,u,heading="Анкета"){if(!u.profile||!Object.keys(u.profile).length)return;const reviews=await feedbackSummary(u.id,sql); if((u.photos||[]).length>1)await call("sendMediaGroup",{chat_id:to,media:u.photos.slice(0,5).map(x=>({type:"photo",media:x}))});else if(u.photo)await call("sendPhoto",{chat_id:to,photo:u.photo});return send(to,"<b>"+esc(heading)+"</b>\n"+Object.entries(u.profile).filter(([k])=>!/дата рождения|телефон|telegram|instagram|фио/i.test(k)).map(([k,v])=>esc(k)+": "+esc(sourcePublicText(v))).join("\n")+"\nКонтакты скрыты.\n\n"+reviews.text,buttons([[["✉️ Пригласить","invite:"+u.id]],...(reviews.count?[[["⭐ Все отзывы ("+reviews.count+")","allreviews:"+u.id+":0"]]]:[]),[["⚠️ Пожаловаться","reportuser:"+u.id]]]))}
async function card(to,j){let p=j.body;let lines=["<b>📢 "+esc(get(p,"название заявки"))+"</b>","Кого ищу: "+esc(get(p,"кого ищу")),"Тип работы: "+esc(get(p,"тип работы")),"Город: "+esc(get(p,"город")),"Требования: "+esc(get(p,"требования")||"не указано"),"Оплата: "+esc(get(p,"формат и оплата")),"Дата: "+esc(get(p,"дата съёмки")||"не указана"),"",esc(sourcePublicText(get(p,"описание")))];if(get(p,"метка темы"))lines.push("Тематика: "+esc(get(p,"метка темы")));if(j.owner===0)lines.push("Заказчик не зарегистрирован в боте — анкеты и отзывов о нём пока нет.");return send(to,lines.join("\n"),buttons([[["✋ Откликнуться","reply:"+j.id]],[["⚠️ Пожаловаться","reportjob:"+j.id]]]))}
async function matches(u,j){
 if(!u||u.blocked||u.suspended||!u.active||!allConsentsCurrent(u.consent,await currentDocumentHashes())||!eligibleProfile(u.profile,u.photo)||j.paused||j.status!=="active")return false;
 const p=u.profile;
 // Level 2 completion is validated by eligibleProfile above.
 if(!roleMatch(get(j.body,"кого ищу"),get(p,"кто вы")))return false;
 if(isExplicitAdultCasting([get(j.body,"описание"),get(j.body,"требования"),get(j.body,"тип работы")].join(" ")) && !(u.filters?.adult===true && ageAt(get(p,"дата рождения"))>=18))return false;
 if(!matchesCastingRequirements(p,j.body))return false;
 if(u.filters?.city && get(j.body,"город")&&!u.filters.city.split(",").some(x=>get(j.body,"город").toLowerCase().includes(x.trim().toLowerCase())))return false;
 if(u.filters?.work && get(j.body,"тип работы")&&!u.filters.work.split(",").some(x=>get(j.body,"тип работы").toLowerCase().includes(x.trim().toLowerCase())))return false;
 if(!formatMatches(u.filters?.format,get(j.body,"формат и оплата")))return false;
 if(!payMatches(u.profile,j.body))return false;
 return true;
}
async function deliverTo(u,j){
 if(!(await matches(u,j)))return false;
 const prev=await sql("SELECT j.body FROM mm_deliveries d JOIN mm_jobs j ON d.job_id=j.id WHERE d.user_id=$1 AND d.created_at>NOW()-INTERVAL '7 days' ORDER BY d.created_at DESC LIMIT 100",u.id);
 if(prev.some(p=>similarity(get(p.body,"описание"),get(j.body,"описание"))>=.95))return false;
 const inserted=await sql("INSERT INTO mm_deliveries(user_id,job_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING job_id",u.id,j.id);
 if(!inserted.length)return false;
 try {
 const sent=await card(u.id,j);
 if(!sent?.ok){await sql("DELETE FROM mm_deliveries WHERE user_id=$1 AND job_id=$2",u.id,j.id);return false}
 await safetyOnce(u);return true;
} catch(e){
 await sql("DELETE FROM mm_deliveries WHERE user_id=$1 AND job_id=$2",u.id,j.id);
 throw e;
}
}
async function safetyOnce(u){
 const r=await sql("UPDATE mm_users SET first_safety_sent_at=NOW() WHERE id=$1 AND first_safety_sent_at IS NULL RETURNING id",u.id);
 if(r.length)await send(u.id,"<b>Безопасность</b>\nМир моделей помогает с поиском, но не организует съёмки и не участвует в оплате. Проверяйте условия, не переводите деньги за сомнительные кастинги и сообщайте о подозрительных предложениях через поддержку.");
}
// Webhooks enqueue work; a durable worker sends to recipients in bounded batches.
async function dispatch(j){
 await sql("INSERT INTO mm_fanout_queue(job_id) VALUES($1) ON CONFLICT(job_id) DO UPDATE SET pending=TRUE,completed_at=NULL,next_attempt_at=NOW()",j.id);
}
let fanoutRunning=false;
async function runFanoutBatch(){
 if(fanoutRunning)return;
 fanoutRunning=true;
 let jobId=null;
 try{
  await ensure();
  const queue=(await sql("SELECT * FROM mm_fanout_queue WHERE pending=TRUE AND next_attempt_at<=NOW() ORDER BY next_attempt_at,created_at LIMIT 1"))[0];
  if(!queue)return;
  jobId=queue.job_id;
  const job=(await sql("SELECT * FROM mm_jobs WHERE id=$1",jobId))[0];
  if(!job||job.status!=="active"||job.paused||new Date(job.expires_at)<=new Date()){
   await sql("UPDATE mm_fanout_queue SET pending=FALSE,completed_at=NOW() WHERE job_id=$1",jobId);return;
  }
  if(!queue.profiles_done){
   await matchingProfilesForJob(job);
   await sql("UPDATE mm_fanout_queue SET profiles_done=TRUE WHERE job_id=$1",jobId);
  }
  const users=await sql("SELECT * FROM mm_users WHERE id>$1 AND id<>$2 ORDER BY id ASC LIMIT 20",queue.cursor_id,job.owner);
  if(!users.length){
   await sql("UPDATE mm_fanout_queue SET pending=FALSE,completed_at=NOW(),attempts=0 WHERE job_id=$1",jobId);return;
  }
  let last=queue.cursor_id;
  for(const user of users){
   // Each deliverTo records delivery idempotently and handles duplicate messages.
   if(user.active&&!user.blocked&&!user.suspended&&user.photo)await deliverTo(user,job);
   last=user.id;
   await sql("UPDATE mm_fanout_queue SET cursor_id=$1,attempts=0,next_attempt_at=NOW()+INTERVAL '2 seconds' WHERE job_id=$2",last,jobId);
  }
 }catch(e){
  console.error("fanout batch",String(e));
  if(jobId!==null)try{
   await sql("UPDATE mm_fanout_queue SET attempts=attempts+1,next_attempt_at=NOW()+INTERVAL '30 seconds' WHERE job_id=$1",jobId);
  }catch(dbErr){console.error("fanout retry",String(dbErr))}
 }finally{fanoutRunning=false}
}

async function sendMatchedProfile(job,p){
 if(job.owner===p.id||job.owner===0||job.paused||job.status!=="active")return false;
 if(!p.active||p.blocked||p.suspended||!allConsentsCurrent(p.consent,await currentDocumentHashes())||!eligibleProfile(p.profile,p.photo))return false;
 if(!roleMatch(get(job.body,"кого ищу"),get(p.profile,"кто вы")))return false;
 if(isExplicitAdultCasting([get(job.body,"описание"),get(job.body,"требования"),get(job.body,"тип работы")].join(" ")) && !(p.filters?.adult===true && ageAt(get(p.profile,"дата рождения"))>=18))return false;
 if(!matchesCastingRequirements(p.profile,job.body))return false;
 if(!payMatches(p.profile,job.body))return false;
 const city=get(job.body,"город").toLowerCase();
 if(city&&get(p.profile,"город")&&!get(p.profile,"город").toLowerCase().split(",").some(x=>city.includes(x.trim())))return false;
 const inserted=await sql("INSERT INTO mm_profile_deliveries(job_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING user_id",job.id,p.id);
 if(!inserted.length)return false;
 try {
 const notice=await send(job.owner,"Анкета по вашей заявке №"+job.id+" · "+esc(get(job.body,"название заявки")));
 if(!notice?.ok)throw Error("Profile notice not sent");
 const shown=await profile(job.owner,p,"Анкета подходящего участника");
 if(!shown?.ok)throw Error("Profile card not sent");
 return true;
 }catch(e){await sql("DELETE FROM mm_profile_deliveries WHERE job_id=$1 AND user_id=$2",job.id,p.id);throw e}
}
async function matchingProfilesForJob(job){
 if(job.owner===0)return;
 const people=await sql("SELECT * FROM mm_users WHERE id<>$1 AND photo IS NOT NULL AND active=TRUE AND blocked=FALSE AND suspended=FALSE LIMIT 120",job.owner);
 for(const p of people)try{await sendMatchedProfile(job,p)}catch(e){console.error("profile delivery",String(e))}
}
async function profileBackfill(p){
 if(!eligibleProfile(p.profile,p.photo)||!allConsentsCurrent(p.consent,await currentDocumentHashes()))return;
 const jobs=await sql("SELECT * FROM mm_jobs WHERE owner<>$1 AND owner<>0 AND status='active' AND paused=FALSE AND expires_at>NOW() AND created_at>NOW()-INTERVAL '14 days' ORDER BY created_at DESC LIMIT 80",p.id);
 for(const j of jobs)try{await sendMatchedProfile(j,p)}catch(e){console.error("profile backfill",String(e))}
}
async function matchingJobs(u,limit=50){
 const jobs=await sql("SELECT * FROM mm_jobs WHERE status='active' AND paused=FALSE AND expires_at>NOW() AND created_at>NOW()-INTERVAL '14 days' ORDER BY created_at DESC LIMIT 200");
 const matched=[];
 for(const job of jobs){if(await matches(u,job))matched.push(job);if(matched.length>=limit)break}
 return matched;
}

async function browseProfiles(u,offset=0){
 if(!allConsentsCurrent(u.consent,await currentDocumentHashes()))return begin(u);
 const requested=u.filters?.profileRole||"";
 const city=(u.filters?.profileCity||u.filters?.city||"").trim().toLowerCase();
 const profiles=await sql("SELECT * FROM mm_users WHERE id<>$1 AND blocked=FALSE AND suspended=FALSE AND active=TRUE AND photo IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 300",u.id);
 const publicProfiles=profiles.filter(p=>{
  if(!allConsentsCurrent(p.consent,cachedDocHashes)||!eligibleProfile(p.profile,p.photo))return false;
  if(requested&&!get(p.profile,"кто вы").split(",").map(x=>x.trim().toLowerCase()).includes(requested))return false;
  if(city&&!city.split(",").some(c=>get(p.profile,"город").toLowerCase().includes(c.trim())))return false;
  return true;
 });
 const page=publicProfiles.slice(offset,offset+3);
 if(!page.length)await send(u.id,offset?"Других анкет по выбранным фильтрам пока нет.":"Не нашлось подходящих анкет. Попробуйте изменить город или профессию.");
 else for(const p of page)await profile(u.id,p,"Анкета в каталоге");
 const next=offset+page.length<publicProfiles.length;
 const nav=[];
 if(offset>0)nav.push(["◀️ Назад","browse:"+Math.max(0,offset-3)]);
 if(next)nav.push(["Дальше ▶️","browse:"+(offset+3)]);
 const rows=[];
 if(nav.length)rows.push(nav);
 rows.push([["⚙️ Профессия","browse_roles"],["🏙 Город","browse_city"]]);
 rows.push([["🏠 В меню","home"]]);
 await send(u.id,"🔎 <b>Каталог анкет</b> • показаны "+page.length+" из "+publicProfiles.length+
  "\\nГород: "+esc(city||"все")+" · Профессия: "+esc(requested||"все"),buttons(rows));
}
async function chooseBrowseRole(u){
 const rows=[[["Все направления","browse_role:all"]]];
 for(let i=0;i<ROLES.length;i+=2)rows.push(ROLES.slice(i,i+2).map((role,n)=>[(u.filters?.profileRole===role?"✅ ":"")+role,"browse_role:"+(i+n)]));
 return send(u.id,"Выберите нужную профессию:",buttons(rows));
}

async function showFilterMenu(u){
 const matched=await matchingJobs(u,200);
 const f=u.filters||{};
 let notice="🎯 <b>Фильтры и поиск</b>\n\n";
 notice+="Город: "+esc(f.city||"все")+"\n";
 notice+="Тип работы: "+esc(f.work||"все")+"\n";
 notice+="Формат: "+esc(f.format||"все")+"\n";
 notice+="Откровенные съёмки (18+): "+(f.adult===true?"включены":"выключены")+"\n\n";
 notice+="Подходящих актуальных заявок: <b>"+matched.length+"</b>";
 if(!matched.length)notice+="\nПока ничего не нашлось — можно изменить фильтры.";
 return send(u.id,notice,buttons([
  [["✏️ Изменить","editfilters"],["📢 Смотреть заявки"+(matched.length?" ("+matched.length+")":""),"jobs"]],
  [[u.active?"⏸️ Остановить поиск заявок":"▶️ Возобновить поиск заявок","pause"]],[[(f.adult===true?"🔞 Выключить 18+":"🔞 Включить 18+"),"adult_toggle"]]
 ]));
}
async function backfill(u){const jobs=await sql("SELECT * FROM mm_jobs WHERE status='active' AND paused=FALSE AND expires_at>NOW() AND created_at>NOW()-INTERVAL '14 days' ORDER BY created_at DESC LIMIT 100");for(const j of jobs)try{await deliverTo(u,j)}catch(e){console.error("backfill",String(e))}}

async function onMessage(m){if(m.chat?.type&&m.chat.type!=="private"){await onSourcePost(m);return}let u=await who(m.from),id=u.id,t=m.text||"";if(await adminAction(u,t))return;if(t==="/id")return send(id,"Telegram ID: <code>"+id+"</code>");
 if(t==="/cancel"){await change(id,{state:""});return send(id,"Текущее действие отменено. Вернуться в меню: /start");}
 if(t==="/mydata"){const payload=await exportAccount(sql,id);if(!payload)return send(id,"Данных нет.");const sent=await sendAccountExport(token,id,payload);if(!sent)return send(id,"Не получилось отправить архив. Попробуйте позже.");return;}
 if(t==="/deleteaccount"){await change(id,{state:"delete_confirm"});return send(id,"<b>Удалить аккаунт и данные?</b>\nЭто удалит анкету, фотографии из нашей базы, ваши заявки, историю откликов, отзывов, приглашений, согласий и обращений. Сообщения, ранее отправленные другим пользователям Telegram, стереть удалённо нельзя.\n\nПодтвердите удаление отдельной кнопкой.",buttons([[["❌ Удалить мои данные","deleteaccount:confirm"]],[["Отмена","deleteaccount:cancel"]]]));}if(t==="/subscription")return send(id,hasPaidAccess(u)?"⭐ Подписка или пробный период активны до "+esc(new Date(u.access_until&&new Date(u.access_until)>new Date(u.trial_until||0)?u.access_until:u.trial_until).toLocaleDateString("ru-RU")):"Бесплатный доступ: один отклик, одна заявка и одно приглашение в календарную неделю.");if(t.startsWith("/start")){
 const payload=t.trim().split(/\s+/)[1]||"";
 if(/^ref_\d{2,19}$/.test(payload)){
  const inviter=Number(payload.slice(4));
  if(Number.isSafeInteger(inviter)&&inviter!==id){
   const hasInviter=await sql("SELECT id FROM mm_users WHERE id=$1",inviter);
   if(hasInviter.length)await sql("INSERT INTO mm_referrals(inviter,invitee) VALUES($1,$2) ON CONFLICT(invitee) DO NOTHING",inviter,id);
  }
 }
 if(/^job_\d+$/.test(payload)&&Bun.env.REGISTRATION_ENABLED==="true"&&await legalReady(sql)&&u.phone){
  const j=(await sql("SELECT * FROM mm_jobs WHERE id=$1 AND status='active' AND paused=FALSE AND expires_at>NOW()",Number(payload.slice(4))))[0];
  if(j){await card(id,j);return begin(u)}
  await send(id,"Эта заявка больше не актуальна.");return begin(u);
 }
 if(/^profile_\d+$/.test(payload)&&Bun.env.REGISTRATION_ENABLED==="true"&&await legalReady(sql)&&u.phone){
  const target=(await sql("SELECT * FROM mm_users WHERE id=$1 AND active=TRUE AND blocked=FALSE AND suspended=FALSE AND photo IS NOT NULL",Number(payload.slice(8))))[0];
  if(target&&eligibleProfile(target.profile,target.photo)&&allConsentsCurrent(target.consent,await currentDocumentHashes())){await profile(id,target);return begin(u)}
  await send(id,"Эта анкета сейчас не участвует в поиске.");return begin(u);
 }
 return begin(u);
}if(t==="/support"){await change(id,{state:"support"});return send(id,"Опишите проблему одним сообщением.");}if(admin.includes(String(id))&&t==="/stats"){let a=await sql("SELECT (SELECT count(*) FROM mm_users)::int AS users,(SELECT count(*) FROM mm_jobs)::int AS jobs,(SELECT count(*) FROM mm_reports)::int AS reports");return send(id,JSON.stringify(a[0]));}if((u.blocked||u.suspended)&&u.state!=="support")return send(id,"Ваш профиль ограничен; напишите /support.");if(t&&!t.startsWith("/")&&await feedbackText(id,t,sql,send))return; if(m.contact){if(m.contact.user_id!==id)return send(id,"Поделитесь именно своим номером.");await change(id,{phone:m.contact.phone_number});const trial=await startPhoneTrial(sql,id,m.contact.phone_number,Bun.env.PHONE_HASH_PEPPER||secret);if(trial.started)await send(id,"🎁 Пробный период на 15 дней активирован.");await call("sendMessage",{chat_id:id,text:"Телефон подтверждён.",reply_markup:{remove_keyboard:true}});return begin({...u,phone:m.contact.phone_number})}
if((Bun.env.REGISTRATION_ENABLED!=="true"||!(await legalReady(sql))||!allConsentsCurrent(u.consent,await currentDocumentHashes()))&&u.state!=="support")return begin(u);
if(m.photo?.length&&u.state==="photo"){
 const file=m.photo[m.photo.length-1].file_id;
 const list=Array.isArray(u.photos)?u.photos:[];
 const photos=[...new Set([...list,file])].slice(0,5);
 await change(id,{photos,photo:photos[0],state:photos.length>=5?"":"photo"});
 if(photos.length===1)await send(id,"Первое фото сохранено — оно будет главным. Можно добавить до пяти фотографий.",buttons([[["✅ Готово","photo_done"]]]));
 if(photos.length>=5){await send(id,"Все пять фотографий сохранены ✅");const fresh=(await sql("SELECT * FROM mm_users WHERE id=$1",id))[0];await backfill(fresh);await profileBackfill(fresh);return begin(fresh)}
 return;
}
if(u.state==="support"){if(m.photo?.length)return saveReport(u,m.caption||"Фото-доказательство",m.photo.at(-1).file_id);return saveReport(u,t)}
if(u.state==="profile"){let p={...(u.profile||{}),...parse(t)},errors=validProfile(p);if(errors.length)return send(id,"Уточните:\n• "+esc(errors.join("\n• "))+"\nОтправьте исправленный шаблон.");await change(id,{profile:p,state:"profile_confirm"});return send(id,"<b>Проверьте анкету:</b>\n"+esc(t),buttons([[["✅ Сохранить","profile_save"],["✏️ Исправить","edit_profile"]]]))}
if(u.state==="job"){let p=parse(t),errors=validJob(p);if(errors.length)return send(id,"Исправьте заявку:\n• "+esc(errors.join("\n• ")));await change(id,{filters:{...(u.filters||{}),draft:p},state:"job_confirm"});return send(id,"Предпросмотр:\n"+esc(t),buttons([[["✅ Опубликовать","publish"],["✏️ Исправить","new"]]]))}
if(u.state==="browse_city"){
  const city=t.trim().toLowerCase()==="все"?"":t.trim().slice(0,80);
  const filters={...(u.filters||{}),profileCity:city};
  await change(id,{filters,state:""});return browseProfiles({...u,filters},0);
 }
 if(u.state==="filter"){let p=parse(t);await change(id,{filters:{...(u.filters||{}),city:get(p,"город"),work:get(p,"тип работы"),format:get(p,"формат")},state:""});await send(id,"Фильтры сохранены. Подбираю актуальные заявки.",menu);const fresh=(await sql("SELECT * FROM mm_users WHERE id=$1",id))[0];await backfill(fresh);return showFilterMenu(fresh)}
return begin(u)}
async function onCallback(c){await call("answerCallbackQuery",{callback_query_id:c.id});let u=await who(c.from),id=u.id,a=c.data;if(a==="privacy")return send(id,"🔐 <b>Данные и приватность</b>\nЭкспорт показывает сведения, сохранённые сервисом. Удаление аккаунта безвозвратное; ранее отправленные Telegram-сообщения других людей останутся.",buttons([[["📦 Экспорт данных","privacy:export"]],[["🗑 Удалить аккаунт","privacy:delete"]],[["◀️ В меню","home"]]]));
 if(a==="privacy:export"){const payload=await exportAccount(sql,id);if(!payload)return send(id,"Сведения ещё не сохранены.");const sent=await sendAccountExport(token,id,payload);if(!sent)return send(id,"Ошибка отправки файла.");return;}
 if(a==="privacy:delete"){await change(id,{state:"delete_confirm"});return send(id,"<b>Подтвердите окончательное удаление</b>\nАнкета, фото и объявления будут удалены из базы. Уже отправленные сообщения в чужих Telegram-чатах сохранятся.",buttons([[["Да, удалить всё","deleteaccount:confirm"]],[["Отменить","deleteaccount:cancel"]]]));}
 if(a==="deleteaccount:cancel"){await change(id,{state:""});return send(id,"Удаление отменено.",menu);}
 if(a==="deleteaccount:confirm"){
  if(u.state!=="delete_confirm")return send(id,"Сначала откройте раздел «Мои данные» и подтвердите удаление.");
  await deleteAccount(sql,id);
  return send(id,"Ваш аккаунт и связанные с ним данные удалены из нашей базы. Для создания нового аккаунта используйте /start.");
 }
 if(a.startsWith("consent:")){
 if(!(await legalReady(sql)))return send(id,"Сначала должны быть опубликованы документы сервиса.");
 const n=Number(a.slice("consent:".length));if(!Number.isInteger(n)||n<0||n>2)return;
 const hashes=await currentDocumentHashes(),co={...(u.consent||{})};
 const current=consentIsCurrent(co,hashes,n);
 co[n]=!current;co[n+"_at"]=co[n]?new Date().toISOString():null;
 co[n+"_hashes"]=co[n]?{...hashes}:null;
 // Persist both state and audit. Each historical event carries document versions and hashes.
 await change(id,{consent:co});
 await recordConsent(sql,id,["offer","processing","distribution"][n],co[n]);
 return call("editMessageReplyMarkup",{chat_id:id,message_id:c.message.message_id,reply_markup:consentBoard({...u,consent:co},hashes)});
}if(await feedbackCallback(a,id,sql,send))return;if(a==="articles"){
 const available=(await latestDocuments(sql)).filter(d=>["overview","safety","portfolio"].includes(d.slug));
 if(!available.length)return send(id,"Статьи ещё готовятся. После утверждения владельцем они появятся здесь.");
 const base=(Bun.env.PUBLIC_URL||"").replace(/\/$/,"");
 return send(id,"📚 <b>Полезные статьи</b>\nВыберите тему:",{inline_keyboard:available.map(d=>[{text:d.title,url:base+"/documents/"+encodeURIComponent(d.slug)}])});
}
if(a==="invitefriend"){
 const whoAmI=await call("getMe",{});const name=whoAmI.ok?whoAmI.result.username:(Bun.env.BOT_USERNAME||"").replace(/^@/,"");
 if(!name)return send(id,"Ссылка для приглашения пока недоступна.");
 const link="https://t.me/"+name+"?start=ref_"+id;
 const count=(await sql("SELECT COUNT(*)::int n FROM mm_referrals WHERE inviter=$1",id))[0].n;
 return send(id,"🎁 Пригласите друга в «Мир моделей»!\nВаша ссылка: "+esc(link)+"\nПо ссылке пришли: "+count+"\nСкидки по реферальной программе заработают после подключения оплаты.");
}
if(a==="docs")return send(id,"Все опубликованные документы сервиса: "+esc((Bun.env.PUBLIC_URL||"").replace(/\/$/,"")+"/documents"));if(a==="go")return begin(u);
 if(Bun.env.REGISTRATION_ENABLED!=="true"||!(await legalReady(sql))||!allConsentsCurrent(u.consent,await currentDocumentHashes()))return begin(u);if(!u.phone||!u.username)return begin(u);if(a==="profile"){if(Object.keys(u.profile||{}).length)await profile(id,u,"Ваша анкета");return send(id,"Анкета редактируется одним текстовым сообщением.",buttons([[["✏️ Заполнить или изменить","edit_profile"],["📷 Добавить фото","addphoto"]]]))}if(a==="edit_profile"){if(Object.keys(u.profile||{}).length){await change(id,{state:"profile"});return send(id,"Чтобы изменить один пункт, пришлите его название и новое значение. Например:\n<code>Город: Москва, Казань</code>");}return send(id,"Выберите шаблон анкеты:",buttons([[["🎬 Модель / актёр","template_model"],["📸 Специалист / бренд","template_client"]]]))}
if(a==="template_model"||a==="template_client"){await change(id,{state:"profile"});const tpl=a==="template_model"?profileTpl:clientTpl;return send(id,"Скопируйте шаблон, заполните и отправьте отдельным сообщением:\n<code>"+esc(tpl)+"</code>")}if(a==="profile_save"){await change(id,{state:""});if(u.photo){const fresh=(await sql("SELECT * FROM mm_users WHERE id=$1",id))[0];await profileBackfill(fresh);await backfill(fresh)}return send(id,"Анкета сохранена! Теперь добавьте ключевое фото.",buttons([[["📷 Добавить фото","addphoto"]]]))}if(a==="addphoto"){await change(id,{state:"photo"});return send(id,"Отправьте 1–5 фотографий: по одной или альбомом. Первая станет ключевой.",buttons([[["✅ Готово","photo_done"]]]))}if(a==="photo_done"){await change(id,{state:""});const fresh=(await sql("SELECT * FROM mm_users WHERE id=$1",id))[0];if(fresh.photo){await backfill(fresh);await profileBackfill(fresh)}return send(id,fresh.photo?"Фото сохранены ✅":"Можно добавить фото позже, но для подбора нужно ключевое фото.",menu)}if(a==="new"){await change(id,{state:"job"});return send(id,"Скопируйте и заполните шаблон заявки одним сообщением:\n<code>"+esc(jobTpl)+"</code>")}if(a==="publish"){let p=u.filters?.draft;if(!p)return send(id,"Черновик не найден.");let n=await sql("SELECT count(*)::int AS total FROM mm_jobs WHERE owner=$1 AND created_at>=$2",id,weekStartMoscow().toISOString());if(!hasPaidAccess(u)&&n[0].total)return send(id,"Без подписки можно разместить одну новую заявку с понедельника по воскресенье.");n=await sql("SELECT count(*)::int AS total FROM mm_jobs WHERE owner=$1 AND status='active' AND paused=FALSE AND expires_at>NOW()",id);if(n[0].total>=10)return send(id,"Лимит: 10 активных заявок.");const row=(await sql("INSERT INTO mm_jobs(owner,body,expires_at) VALUES($1,$2::jsonb,$3) RETURNING *",id,JSON.stringify(p),jobExpiresAt(get(p,"дата съёмки")).toISOString()))[0];await change(id,{state:"",filters:Object.fromEntries(Object.entries(u.filters).filter(([k])=>k!=="draft"))});await send(id,"Заявка №"+row.id+" опубликована.");await dispatch(row);return}if(a==="jobs"){
 const js=await matchingJobs(u,30);
 if(!js.length)return send(id,eligibleProfile(u.profile,u.photo)?"По вашим фильтрам подходящих заявок сейчас нет.":"Добавьте ключевое фото и заполните обязательные поля анкеты, чтобы запустить подбор.",buttons([[["🎯 Фильтры","filters"],["👤 Анкета","profile"]]]));
 for(const j of js)await card(id,j);
 if(js.length<=3)await send(id,"По вашим настройкам сейчас всего "+js.length+" подходящих заявок.");
 return;
}if(a==="mine"){let js=await sql("SELECT * FROM mm_jobs WHERE owner=$1 ORDER BY id DESC LIMIT 20",id);if(!js.length)return send(id,"Ваших заявок пока нет.");for(let j of js)await send(id,"№"+j.id+" — "+esc(get(j.body,"название заявки"))+" ("+(j.paused?"поиск остановлен":esc(j.status))+")",buttons([[[j.paused?"▶️ Восстановить":"⏸️ Остановить","jobpause:"+j.id],["Закрыть","close:"+j.id]]]));return}if(a.startsWith("jobpause:")){const rows=await sql("UPDATE mm_jobs SET paused=NOT paused WHERE id=$1 AND owner=$2 AND status='active' RETURNING paused",Number(a.slice(9)),id);return send(id,rows.length?(rows[0].paused?"Поиск анкет по этой заявке остановлен.":"Поиск анкет по этой заявке возобновлён."):"Заявка недоступна.")}if(a.startsWith("close:")){await sql("UPDATE mm_jobs SET status='closed' WHERE id=$1 AND owner=$2",+a.slice(6),id);return send(id,"Заявка закрыта.")}if(a==="home")return begin(u);
 if(a.startsWith("browse_role:")){
  const key=a.slice("browse_role:".length);
  const role=key==="all"?"":ROLES[Number(key)];
  if(role===undefined)return;
  const filters={...(u.filters||{}),profileRole:role};
  await change(id,{filters});return browseProfiles({...u,filters},0);
 }
 if(a==="browse_roles")return chooseBrowseRole(u);
 if(a==="browse_city"){await change(id,{state:"browse_city"});return send(id,"Напишите город для каталога, например «Москва». Для сброса отправьте «все».");}
 if(a.startsWith("browse:"))return browseProfiles(u,Math.max(0,Math.min(297,Number(a.slice(7))||0)));
 if(a==="adult_toggle"){
  if(ageAt(get(u.profile,"дата рождения"))<18||ageAt(get(u.profile,"дата рождения"))===null)return send(id,"Категория 18+ доступна только совершеннолетним.");
  const filters={...(u.filters||{}),adult:u.filters?.adult!==true};
  await change(id,{filters});return showFilterMenu({...u,filters});
 }
 if(a==="filters")return showFilterMenu(u);
if(a==="editfilters"){await change(id,{state:"filter"});return send(id,"Отправьте фильтры отдельным сообщением:\n<code>Город: Москва\nТип работы: реклама\nФормат: коммерция</code>\nЕсли строку оставить пустой, ограничение по ней отключится.")}if(a==="pause"){await change(id,{active:!u.active});if(!u.active)await backfill({...u,active:true});return send(id,u.active?"Поиск приостановлен. Анкета скрыта.":"Поиск возобновлён.")}if(a==="reply:"+a.slice(6)&&a.startsWith("reply:")){let j=(await sql("SELECT * FROM mm_jobs WHERE id=$1 AND status='active' AND expires_at>NOW()",+a.slice(6)))[0];if(!j||j.paused)return send(id,"Поиск по заявке остановлен.");if(!u.photo)return send(id,"Сначала добавьте фото в анкету.");let n=await sql("SELECT count(*)::int AS n FROM mm_responses WHERE user_id=$1 AND created_at>=$2",id,weekStartMoscow().toISOString());if(!hasPaidAccess(u)&&n[0].n)return send(id,"Бесплатный лимит — 1 отклик с понедельника по воскресенье.");let saved=await sql("INSERT INTO mm_responses(job_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id",j.id,id);if(!saved.length)return send(id,"Отклик уже учтён.");const owner=j.owner===0?null:(await sql("SELECT * FROM mm_users WHERE id=$1",j.owner))[0];if(j.contact){const contact=String(j.contact).replace(/^@/,"");if(/^\w{5,32}$/.test(contact)){const draft="Здравствуйте! Ваша заявка «"+get(j.body,"название заявки")+"» пришла мне в боте Мир моделей. С радостью обсужу детали.";await send(id,"Откройте диалог с автором:",{inline_keyboard:[[{text:"✉️ Написать автору",url:"https://t.me/"+contact+"?text="+encodeURIComponent(draft)}]]});return}await send(id,"Контакт автора: "+esc(j.contact));return}if(owner?.username){const draft="Здравствуйте! Откликаюсь на заявку «"+get(j.body,"название заявки")+"». С радостью обсужу детали.";await send(id,"Для отправки откройте диалог:",{inline_keyboard:[[{text:"✉️ Написать автору",url:"https://t.me/"+owner.username+"?text="+encodeURIComponent(draft)}]]})}else await send(id,"Отклик учтён, но у автора нет доступного @ника.");if(owner){await send(owner.id,"Отклик на заявку №"+j.id);await profile(owner.id,u,"Анкета откликнувшегося");await send(owner.id,"Выберите действие:",buttons([[["✅ Принять отклик","acceptresponse:"+saved[0].id],["❌ Отклонить","declineresponse:"+saved[0].id]]]))}return}if(a.startsWith("invite:")){
 const target=Number(a.slice(7));
 if(target===id)return send(id,"Нельзя пригласить самого себя.");
 if(!u.photo||!get(u.profile,"имя"))return send(id,"Сначала заполните анкету и добавьте ключевое фото.");
 const p=(await sql("SELECT * FROM mm_users WHERE id=$1 AND blocked=FALSE AND suspended=FALSE AND active=TRUE",target))[0];
 if(!p?.username)return send(id,"Участник временно не принимает приглашения.");
 const count=await sql("SELECT COUNT(*)::int n FROM mm_invitations WHERE from_user=$1 AND created_at>=$2",id,weekStartMoscow().toISOString());
 if(!hasPaidAccess(u)&&count[0].n>=1)return send(id,"Без подписки доступно одно приглашение с понедельника по воскресенье.");
 const invited=(await sql("INSERT INTO mm_invitations(from_user,to_user) VALUES($1,$2) RETURNING id",id,p.id))[0];
 const draft="Здравствуйте! Приглашаю вас обсудить съёмку через «Мир моделей». С радостью обсужу детали.";
 await send(id,"Приглашение зарегистрировано.",{inline_keyboard:[[{text:"✉️ Написать участнику",url:"https://t.me/"+p.username+"?text="+encodeURIComponent(draft)}]]});
 await send(p.id,"👋 Вам пришло приглашение.");
 await profile(p.id,u,"Приглашающий участник");
 await send(p.id,"Приглашение можно принять или оставить без ответа.",buttons([[["✅ Принять","acceptinvite:"+invited.id],["Пока нет","home"]]]));
 await safetyOnce(p);
 return;
}
if(a.startsWith("acceptinvite:")){
 const rows=await sql("UPDATE mm_invitations SET status='accepted' WHERE id=$1 AND to_user=$2 AND status='sent' RETURNING *",Number(a.slice(13)),id);
 if(!rows.length)return send(id,"Приглашение уже обработано.");await scheduleFeedback(sql,"invite",rows[0].id,rows[0].from_user,rows[0].to_user);
 const from=(await sql("SELECT username FROM mm_users WHERE id=$1",rows[0].from_user))[0];
 await send(rows[0].from_user,"Ваше приглашение принято. Можно связаться напрямую.");
 if(from?.username)return send(id,"Откройте диалог:",{inline_keyboard:[[{text:"✉️ Написать",url:"https://t.me/"+from.username}]]});
 return send(id,"Приглашение принято.");
}
if(a.startsWith("acceptresponse:")){
 const rId=Number(a.slice("acceptresponse:".length));
 const rows=await sql("UPDATE mm_responses r SET status='accepted',accepted_at=NOW() FROM mm_jobs j WHERE r.id=$1 AND r.job_id=j.id AND j.owner=$2 AND r.status='pending' RETURNING r.*",rId,id);
 if(!rows.length)return send(id,"Отклик уже обработан.");
 const j=(await sql("SELECT body FROM mm_jobs WHERE id=$1",rows[0].job_id))[0];
 await scheduleFeedback(sql,"response",rows[0].id,id,rows[0].user_id,get(j.body,"дата съёмки"));
 await send(id,"Отклик принят. Вы можете договориться о деталях напрямую.");
 await send(rows[0].user_id,"✅ Ваш отклик принят! Теперь можно согласовать детали с автором заявки.");
 return;
}
if(a.startsWith("declineresponse:")){
 const rId=Number(a.slice("declineresponse:".length));
 const rows=await sql("UPDATE mm_responses r SET status='declined' FROM mm_jobs j WHERE r.id=$1 AND r.job_id=j.id AND j.owner=$2 AND r.status='pending' RETURNING r.id",rId,id);
 return send(id,rows.length?"Отклик отклонён.":"Отклик уже обработан.");
}
if(a.startsWith("reportjob:")||a.startsWith("reportuser:")||a==="report"||a==="support"){const f={...(u.filters||{})};f.reportTarget=a.startsWith("reportjob:")?{job:Number(a.slice(10))}:a.startsWith("reportuser:")?{user:Number(a.slice(11))}:{};await change(id,{state:"support",filters:f});return send(id,"Опишите причину своими словами. Можно приложить скриншот.")}}

function sourcePublicText(raw) {
 return String(raw||"").replace(/(?:https?:\/\/)?t\.me\/[a-zA-Z0-9_]{5,32}/gi,"[контакт скрыт]")
 .replace(/(?:^|[\s(])@[A-Za-z0-9_]{5,32}\b/g," [контакт скрыт]")
 .replace(/(?:\+7|8)[\d\s()\-]{9,16}\d/g,"[контакт скрыт]");
}
async function onSourcePost(m) {
 const sourceId=m?.chat?.id;
 if(!sourceId)return;
 const settings=(await sql("SELECT * FROM mm_sources WHERE id=$1 AND active=TRUE",sourceId))[0];
 if(!settings)return;
 const raw=(m.text||m.caption||"").slice(0,5000);
 const exists=await sql("SELECT 1 FROM mm_source_posts WHERE source_id=$1 AND telegram_message_id=$2",sourceId,m.message_id);
 if(exists.length)return;
 const decision=moderate(raw.replace(/(?:https?:\/\/)?t\.me\/[a-zA-Z0-9_]{5,32}/gi,""));
 // Rules always decide safety. AI is an optional extraction fallback only.
 const parsed=parseSourcePost(raw,{city:settings.city,topic:settings.topic}) || (decision.status!=="reject" ? await parseWithModel(raw,{city:settings.city,topic:settings.topic}) : null);
 let state=decision.status==="reject"?"rejected":decision.status==="review"?"pending":"active";
 if(!parsed)state="rejected";
 if(parsed && /(?:несовершеннолет|до\s+1[0-7]\s+лет|дети\s+1[0-7]\s+лет)/i.test(raw))state="pending";
 let job=null;
 const contact=extractContact(raw);
 if(contact){
  const ignored=await sql("SELECT 1 FROM mm_source_blacklist WHERE source_id=$1 AND contact=$2",sourceId,contact);
  if(ignored.length)state="rejected";
 }
 if(parsed&&state!=="rejected"){
   // Deduplicate ONLY with an identical contact and >=95% textual similarity in the last seven days.
   const recent=await sql("SELECT * FROM mm_jobs WHERE source_id IS NOT NULL AND contact=$1 AND created_at>NOW()-INTERVAL '7 days' ORDER BY created_at DESC LIMIT 50",contact);
   job=recent.find(x=>similarity(get(x.body,"описание"),raw)>=.95)||null;
   if(!job){
     const stored={...parsed,"описание":raw};
     const eventDate=get(parsed,"дата съёмки");
     if(eventDate && jobExpiresAt(eventDate).getTime()<Date.now())state="rejected";
     if(state!=="rejected"){
       job=(await sql("INSERT INTO mm_jobs(owner,body,status,expires_at,source_id,contact) VALUES(0,$1::jsonb,$2,$3,$4,$5) RETURNING *",JSON.stringify(stored),state,jobExpiresAt(eventDate).toISOString(),sourceId,contact))[0];
     }
   }
 }
 await sql("INSERT INTO mm_source_posts(source_id,telegram_message_id,job_id,moderation,reason) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",sourceId,m.message_id,job?.id||null,state,decision.reason||"");
 if(job?.status==="active" && state==="active" && job?.source_id===sourceId)await dispatch(job);
 if(state==="pending"&&job)for(const id of admin.filter(x=>/^\d+$/.test(x)))try{
   await send(id,"⚠️ Заявка из источника ожидает модерации.\n№"+job.id+"\n"+esc(sourcePublicText(raw.slice(0,1300)))+"\nКоманды: /approve "+job.id+" или /reject "+job.id);
 }catch(e){console.error("admin alert",String(e))}
}
async function adminAction(u,t){
 const id=u.id;if(!admin.includes(String(id)))return false;
 const block=t.match(/^\/source_block\s+(-?\d+)\s+(@[A-Za-z0-9_]{5,32})$/);
 if(block){
  const source=Number(block[1]),contact=block[2].toLowerCase();
  await sql("INSERT INTO mm_source_blacklist(source_id,contact) VALUES($1,$2) ON CONFLICT DO NOTHING",source,contact);
  await sql("UPDATE mm_jobs SET status='rejected' WHERE source_id=$1 AND contact=$2 AND status='active'",source,contact);
  await sql("INSERT INTO mm_admin_log(actor,action,details) VALUES($1,'source_block',$2::jsonb)",id,JSON.stringify({source,contact}));
  await send(id,"Контакт заблокирован для указанного источника.");
  return true;
 }
 const add=t.match(/^\/source_add\s+(-?\d+)(?:\s+([^|]+))?(?:\|(.+))?$/);
 if(add){
   const source=Number(add[1]),city=(add[2]||"").trim(),topic=(add[3]||"").trim();
   await sql("INSERT INTO mm_sources(id,city,topic,active) VALUES($1,$2,$3,TRUE) ON CONFLICT(id) DO UPDATE SET city=EXCLUDED.city,topic=EXCLUDED.topic,active=TRUE",source,city,topic);
   await sql("INSERT INTO mm_admin_log(actor,action,details) VALUES($1,$2,$3::jsonb)",id,"source_add",JSON.stringify({source,city,topic}));
   await send(id,"Источник "+source+" добавлен. Бот должен иметь доступ к сообщениям канала или чата.");
   return true;
 }
 if(t==="/sources"){
   const rows=await sql("SELECT * FROM mm_sources ORDER BY id LIMIT 80");
   await send(id,rows.length?rows.map(x=>x.id+" · "+esc(x.city)+" · "+esc(x.topic)+" · "+(x.active?"✅":"⏸")).join("\n"):"Источников пока нет.");
   return true;
 }
 let m=t.match(/^\/source_off\s+(-?\d+)$/);
 if(m){await sql("UPDATE mm_sources SET active=FALSE WHERE id=$1",Number(m[1]));await send(id,"Источник выключен.");return true}
 m=t.match(/^\/(approve|reject)\s+(\d+)$/);
 if(m){
   const state=m[1]==="approve"?"active":"rejected";
   const jobs=await sql("UPDATE mm_jobs SET status=$1 WHERE id=$2 AND status='pending' RETURNING *",state,Number(m[2]));
   if(!jobs.length){await send(id,"Заявка не найдена в очереди.");return true}
   await sql("INSERT INTO mm_admin_log(actor,action,details) VALUES($1,$2,$3::jsonb)",id,m[1],JSON.stringify({job:jobs[0].id}));
   await send(id,"Заявка №"+jobs[0].id+": "+state);
   if(state==="active")await dispatch(jobs[0]);
   return true;
 }
 if(t==="/review"){
   const rows=await sql("SELECT id,body FROM mm_jobs WHERE status='pending' ORDER BY id LIMIT 15");
   await send(id,rows.length?rows.map(x=>"№"+x.id+" "+esc(get(x.body,"название заявки"))).join("\n"):"На модерации нет заявок.");
   return true;
 }
 m=t.match(/^\/(block|unblock|suspend|unsuspend)\s+(\d+)$/);
 if(m){
   const col=m[1].includes("block")?"blocked":"suspended";
   const flag=m[1]==="block"||m[1]==="suspend";
   await sql("UPDATE mm_users SET "+col+"=$1 WHERE id=$2",flag,Number(m[2]));
   await sql("INSERT INTO mm_admin_log(actor,action,details) VALUES($1,$2,$3::jsonb)",id,m[1],JSON.stringify({target:m[2]}));
   await send(id,"Изменён статус пользователя "+m[2]);
   return true;
 }
 if(t==="/stats"){
   const rows=await sql("SELECT (SELECT COUNT(*) FROM mm_users)::int users,(SELECT COUNT(*) FROM mm_jobs)::int jobs,(SELECT COUNT(*) FROM mm_jobs WHERE source_id IS NOT NULL)::int imported,(SELECT COUNT(*) FROM mm_responses)::int replies,(SELECT COUNT(*) FROM mm_reports_v2)::int reports,(SELECT COUNT(*) FROM mm_sources WHERE active)::int sources");
   await send(id,"📊 Мир моделей\n"+Object.entries(rows[0]).map(([k,v])=>k+": "+v).join("\n"));
   return true;
 }
 return false;
}
async function saveReport(u,txt,photo=null){
 const meta=u.filters?.reportTarget||{};
 const target_user=meta.user||null, target_job=meta.job||null;
 const ticket=(await sql("INSERT INTO mm_reports_v2(reporter,target_user,target_job,kind,body,photo) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",u.id,target_user,target_job,target_user||target_job?"complaint":"support",txt.slice(0,3000),photo))[0];
 await sql("INSERT INTO mm_support_messages(ticket_id,sender,body) VALUES($1,'user',$2)",ticket.id,txt.slice(0,3000));
 const f={...(u.filters||{})};delete f.reportTarget;
 await change(u.id,{state:"",filters:f});
 if(target_user){
  const n=await sql("SELECT COUNT(DISTINCT reporter)::int n FROM mm_reports_v2 WHERE target_user=$1 AND kind='complaint'",target_user);
  if(n[0].n>=3)for(const moderator of admin.filter(x=>/^\d+$/.test(x)))try{await send(moderator,"⚠️ На профиль "+target_user+" поступило "+n[0].n+" независимых жалоб. Проверьте факты в админке перед блокировкой.")}catch(e){console.error("complaint alert",String(e))}
 }
 for(const a of admin.filter(x=>/^\d+$/.test(x)))try{await send(a,"📩 Новое обращение от "+u.id+"; объект: "+(target_user||target_job||"поддержка")+"\n"+esc(txt.slice(0,1400)))}catch(e){console.error("notify admin",String(e))}
 await send(u.id,"Обращение записано. Модератор сможет его проверить.");
}

Bun.serve({port:Number(Bun.env.PORT||3000),hostname:"0.0.0.0",async fetch(r){
 try{await ensure()}catch(e){
  console.error("Database not ready:",String(e));
  return new Response("Service temporarily unavailable",{status:503,headers:{"cache-control":"no-store"}});
 }const documents=await publicDocumentRoute(r,sql);if(documents)return documents;const dashboard=await adminApp(r,sql,dispatch,async (id,message)=>{
 const reports=await sql("SELECT * FROM mm_reports_v2 WHERE id=$1",id);
 if(!reports.length)throw Error("Обращение не найдено");
 const target=reports[0].reporter;
 const sent=await send(target,"✉️ Ответ поддержки «Мир моделей» по обращению №"+id+":\n\n"+esc(message));
 if(!sent.ok)throw Error("Telegram не доставил ответ.");
 await sql("INSERT INTO mm_support_messages(ticket_id,sender,body) VALUES($1,'support',$2)",id,message);
 await sql("UPDATE mm_reports_v2 SET status='in_progress',updated_at=NOW() WHERE id=$1",id);
});if(dashboard)return dashboard;let u=new URL(r.url);if(u.pathname==="/health"){try{await ensure();return Response.json({ok:true,registration:Bun.env.REGISTRATION_ENABLED==="true"})}catch(e){return new Response("Database unavailable",{status:503})}}if(u.pathname==="/webhook"&&r.method==="POST"){if(!secret||r.headers.get("x-telegram-bot-api-secret-token")!==secret)return new Response("Forbidden",{status:403});try{await ensure();let x=await r.json();let ok=await sql("INSERT INTO mm_updates(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id",x.update_id);if(ok.length){
  try {
    if(x.message?.from||x.message?.chat?.type!=="private")if(x.message)await onMessage(x.message);
    if(x.channel_post)await onSourcePost(x.channel_post);
    if(x.callback_query?.from)await onCallback(x.callback_query);
  }catch(e){await sql("DELETE FROM mm_updates WHERE id=$1",x.update_id);throw e}
 }
 return new Response("ok")}catch(e){console.error("Update error",e);return new Response("error",{status:500})}}return new Response("World Models Bot")}})
setInterval(()=>ensure().then(()=>feedbackTick(sql,send)).catch(e=>console.error("feedback job",String(e))),60*60*1000);
setInterval(()=>runFanoutBatch().catch(e=>console.error("fanout tick",String(e))),5000);
setInterval(()=>ensure().then(async()=>{
 await sql("DELETE FROM mm_updates WHERE created_at<NOW()-INTERVAL '30 days'");
 await sql("DELETE FROM mm_fanout_queue WHERE pending=FALSE AND completed_at<NOW()-INTERVAL '90 days'");
 }).catch(e=>console.error("maintenance",String(e))),24*60*60*1000);
setTimeout(()=>runFanoutBatch().catch(e=>console.error("fanout startup",String(e))),4000);
if(token&&secret&&Bun.env.PUBLIC_URL)call("setWebhook",{url:Bun.env.PUBLIC_URL.replace(/\/$/,"")+"/webhook",secret_token:secret,allowed_updates:["message","channel_post","callback_query"]}).then(r=>console.log("Webhook configured",r.ok)).catch(console.error);
