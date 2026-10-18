import {SQL} from "bun";
import {jobWizardFields,jobWizardField,jobWizardFinished,validateJobWizardAnswer,jobWizardFilters,clearJobWizard} from "./job-wizard.ts";
import {relayAuthorized,prepareRelay,consumeRelayQuota} from "./relay.ts";
import {profileDraftOf,stageProfileDraft,discardProfileDraft,mergeProfilePhoto} from "./profile-draft.ts";
import {WIZARD_ROLES,wizardFields,wizardField,wizardCompleted,wizardAnswer,toggleProfileRole,canFinishWizardNow} from "./profile-wizard.ts";
import {isTestMode,canRegister,canUseTestFeatures,testWarning,testMenuText} from "./test-mode.ts";
import {redactContacts,publicProfileEntries,publicProfileAllowed} from "./visibility.ts";
import {adminApp} from "./admin.ts";
import {setupSourceHealth,allowanceForModel,reviewSourceHealth} from "./source-health.ts";
import {payMatches,formatMatches} from "./pricing.ts";
import {exportAccount,deleteAccount,sendAccountExport} from "./privacy.ts";
import {parseWithModel} from "./ai-parser.ts";
import {prepareDocuments,legalReady as legalDocumentsReady,recordConsent,publicDocumentRoute,latestDocuments,documentHashes,allConsentsCurrent as fullConsentsCurrent,consentIsCurrent} from "./documents.ts";
import {prepareEntitlements,startPhoneTrial,hasPaidAccess as activeSubscription,weekStartMoscow} from "./access.ts";
import {setupFeedback, scheduleFeedback, feedbackTick, feedbackCallback, feedbackText, feedbackSummary} from "./feedback.ts";
import {ROLES, MODEL_ROLES, parseFields, field, ageAt, jobExpiresAt, moderate, parseSourcePost, extractContact, roleMatch, similarity, eligibleProfile, matchesCastingRequirements, isExplicitAdultCasting,matchesWantedProfileRoles,incompleteProfileFields} from "./engine.ts";
const db=new SQL(Bun.env.DATABASE_URL||"postgres://unconfigured");
const token=Bun.env.BOT_TOKEN||"", secret=Bun.env.WEBHOOK_SECRET||"";
const admin=(Bun.env.ADMIN_IDS||"").split(",");
const roles=ROLES;
const testMode=()=>isTestMode(Bun.env);
const hasPaidAccess=(u,at)=>testMode()||activeSubscription(u,at);
const legalReady=async query=>canRegister({...Bun.env,REGISTRATION_ENABLED:"true"},await legalDocumentsReady(query));
const allConsentsCurrent=(c,hashes)=>testMode()?canUseTestFeatures(Bun.env,c):fullConsentsCurrent(c,hashes);
const testReady=()=>Bun.env.REGISTRATION_ENABLED==="true";
const menu={inline_keyboard:[
 [{text:"👤 Моя анкета",callback_data:"profile"},{text:"🔎 Анкеты",callback_data:"browse:0"}],
 [{text:"📢 Найти заявки",callback_data:"jobs"},{text:"➕ Создать заявку",callback_data:"new"}],
 [{text:"🎯 Фильтры",callback_data:"filters"},{text:"📌 Мои заявки",callback_data:"mine"}],
 [{text:"📬 Мои отклики",callback_data:"myresponses"},{text:"✉️ Приглашения",callback_data:"myinvites"}],
 [{text:"⏸️ Поиск вкл/выкл",callback_data:"pause"},{text:"ℹ️ Как работает",callback_data:"how"}],
 [{text:"⚙️ Ещё",callback_data:"more"}]
]};
const esc=s=>String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
async function sql(q,...v){return db.unsafe(q,v)}
async function setup(){
await sql("CREATE TABLE IF NOT EXISTS mm_users(id BIGINT PRIMARY KEY, username TEXT, first_name TEXT, phone TEXT, consent JSONB DEFAULT '{}', state TEXT DEFAULT '', profile JSONB DEFAULT '{}', filters JSONB DEFAULT '{}', photo TEXT, active BOOLEAN DEFAULT TRUE, blocked BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW())");
await sql("CREATE TABLE IF NOT EXISTS mm_jobs(id BIGSERIAL PRIMARY KEY,owner BIGINT NOT NULL,body JSONB NOT NULL,status TEXT DEFAULT 'active',created_at TIMESTAMPTZ DEFAULT NOW(),expires_at TIMESTAMPTZ DEFAULT NOW()+INTERVAL '14 days')");
await sql("ALTER TABLE mm_jobs ADD COLUMN IF NOT EXISTS draft_token TEXT");
await sql("CREATE UNIQUE INDEX IF NOT EXISTS mm_jobs_owner_draft_token ON mm_jobs(owner,draft_token) WHERE draft_token IS NOT NULL");
await sql("CREATE TABLE IF NOT EXISTS mm_responses(id BIGSERIAL PRIMARY KEY,job_id BIGINT NOT NULL,user_id BIGINT NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW(),UNIQUE(job_id,user_id))");
await sql("ALTER TABLE mm_responses ADD COLUMN IF NOT EXISTS message TEXT NOT NULL DEFAULT ''");
await sql("CREATE TABLE IF NOT EXISTS mm_response_outbox(response_id BIGINT PRIMARY KEY,step INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),completed_at TIMESTAMPTZ)");
await sql("CREATE INDEX IF NOT EXISTS mm_response_outbox_ready ON mm_response_outbox(next_attempt_at) WHERE completed_at IS NULL");
await sql("CREATE TABLE IF NOT EXISTS mm_reports(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL,body TEXT,created_at TIMESTAMPTZ DEFAULT NOW())");
await sql("CREATE TABLE IF NOT EXISTS mm_updates(id BIGINT PRIMARY KEY)");
await sql("ALTER TABLE mm_updates ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()");
await sql("CREATE INDEX IF NOT EXISTS mm_update_age ON mm_updates(created_at)");
await sql("CREATE TABLE IF NOT EXISTS mm_sources(id BIGINT PRIMARY KEY,title TEXT DEFAULT '',city TEXT DEFAULT '',topic TEXT DEFAULT '',active BOOLEAN DEFAULT TRUE,created_at TIMESTAMPTZ DEFAULT NOW())");
await sql("CREATE TABLE IF NOT EXISTS mm_source_posts(source_id BIGINT NOT NULL,telegram_message_id BIGINT NOT NULL,job_id BIGINT,moderation TEXT NOT NULL,reason TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),PRIMARY KEY(source_id,telegram_message_id))");
await sql("CREATE TABLE IF NOT EXISTS mm_source_blacklist(source_id BIGINT NOT NULL,contact TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(source_id,contact))");
await sql("CREATE TABLE IF NOT EXISTS mm_candidate_sources(id BIGINT PRIMARY KEY,username TEXT,title TEXT,status TEXT NOT NULL,reason TEXT,unique30 INTEGER NOT NULL DEFAULT 0,total30 INTEGER NOT NULL DEFAULT 0,first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
await sql("CREATE TABLE IF NOT EXISTS mm_collector_inbox(source_id BIGINT NOT NULL,telegram_message_id BIGINT NOT NULL,body TEXT NOT NULL,received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),processed_at TIMESTAMPTZ,attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(source_id,telegram_message_id))");
await sql("CREATE INDEX IF NOT EXISTS mm_collector_ready ON mm_collector_inbox(next_attempt_at) WHERE processed_at IS NULL");
await sql("ALTER TABLE mm_sources ADD COLUMN IF NOT EXISTS username TEXT");
await sql("CREATE TABLE IF NOT EXISTS mm_deliveries(user_id BIGINT NOT NULL,job_id BIGINT NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW(),PRIMARY KEY(user_id,job_id))");
await sql("CREATE TABLE IF NOT EXISTS mm_fanout_queue(job_id BIGINT PRIMARY KEY, cursor_id BIGINT NOT NULL DEFAULT 0,profiles_done BOOLEAN NOT NULL DEFAULT FALSE,pending BOOLEAN NOT NULL DEFAULT TRUE,attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),completed_at TIMESTAMPTZ)");
await sql("CREATE INDEX IF NOT EXISTS mm_fanout_ready ON mm_fanout_queue(next_attempt_at) WHERE pending=TRUE");
await sql("CREATE TABLE IF NOT EXISTS mm_reports_v2(id BIGSERIAL PRIMARY KEY,reporter BIGINT NOT NULL,target_user BIGINT,target_job BIGINT,kind TEXT NOT NULL DEFAULT 'support',body TEXT NOT NULL DEFAULT '',photo TEXT,created_at TIMESTAMPTZ DEFAULT NOW())");
await sql("CREATE TABLE IF NOT EXISTS mm_profile_deliveries(job_id BIGINT NOT NULL,user_id BIGINT NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW(),PRIMARY KEY(job_id,user_id))");
await sql("CREATE TABLE IF NOT EXISTS mm_invitations(id BIGSERIAL PRIMARY KEY,from_user BIGINT NOT NULL,to_user BIGINT NOT NULL,job_id BIGINT,status TEXT DEFAULT 'sent',created_at TIMESTAMPTZ DEFAULT NOW())");
await sql("ALTER TABLE mm_users ADD COLUMN IF NOT EXISTS first_safety_sent_at TIMESTAMPTZ");
 await sql("ALTER TABLE mm_users ADD COLUMN IF NOT EXISTS first_reply_ack_at TIMESTAMPTZ");
await sql("CREATE TABLE IF NOT EXISTS mm_admin_log(id BIGSERIAL PRIMARY KEY,actor BIGINT NOT NULL,action TEXT NOT NULL,details JSONB DEFAULT '{}',created_at TIMESTAMPTZ DEFAULT NOW())");
await sql("ALTER TABLE mm_jobs ADD COLUMN IF NOT EXISTS source_id BIGINT");
await sql("ALTER TABLE mm_jobs ADD COLUMN IF NOT EXISTS contact TEXT");
await sql("ALTER TABLE mm_jobs ADD COLUMN IF NOT EXISTS paused BOOLEAN NOT NULL DEFAULT FALSE");
await sql("ALTER TABLE mm_users ADD COLUMN IF NOT EXISTS suspended BOOLEAN NOT NULL DEFAULT FALSE");
await sql("ALTER TABLE mm_users ADD COLUMN IF NOT EXISTS first_source TEXT");
await sql("ALTER TABLE mm_users ADD COLUMN IF NOT EXISTS photos JSONB NOT NULL DEFAULT '[]'");
await sql("UPDATE mm_users SET photos=jsonb_build_array(photo) WHERE photo IS NOT NULL AND photos='[]'::jsonb");
await sql("CREATE INDEX IF NOT EXISTS mm_jobs_active_expiry ON mm_jobs(status,expires_at)");
await sql("CREATE TABLE IF NOT EXISTS mm_referrals(inviter BIGINT NOT NULL,invitee BIGINT PRIMARY KEY,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CHECK(inviter<>invitee))");
await sql("CREATE INDEX IF NOT EXISTS mm_referrals_inviter ON mm_referrals(inviter,created_at)");

await sql("ALTER TABLE mm_reports_v2 ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new'");
await sql("ALTER TABLE mm_reports_v2 ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()");
await sql("CREATE TABLE IF NOT EXISTS mm_support_messages(id BIGSERIAL PRIMARY KEY,ticket_id BIGINT NOT NULL REFERENCES mm_reports_v2(id),sender TEXT NOT NULL,body TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
await sql("CREATE INDEX IF NOT EXISTS mm_support_message_ticket ON mm_support_messages(ticket_id,created_at)");

await setupFeedback(sql);
await prepareEntitlements(sql);
await prepareRelay(sql);
await prepareDocuments(sql);
await setupSourceHealth(sql);

}
let ready;function ensure(){return ready??=(setup().catch(e=>{ready=null;throw e}))}
async function call(method,p){const r=await fetch("https://api.telegram.org/bot"+token+"/"+method,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(p,(_,v)=>typeof v==="bigint"?Number(v):v)});const j=await r.json();if(!j.ok)console.error("Telegram",method,j.description);return j}
const send=async(id,text,markup)=>{
 const result=await call("sendMessage",{chat_id:id,text,parse_mode:"HTML",disable_web_page_preview:true,...markup?{reply_markup:markup}:{}});
 if(!result.ok && (result.error_code===429||result.error_code>=500))throw Error("Telegram delivery temporarily unavailable");
 return result;
};
const buttons=rows=>({inline_keyboard:rows.map(row=>row.map(([text,callback_data])=>({text,callback_data})))});
async function change(id,fields){let sets=[],vals=[];for(const [k,v] of Object.entries(fields)){const json=v!==null&&typeof v==="object";vals.push(json?JSON.stringify(v):v);sets.push(k+"=$"+vals.length+(json?"::jsonb":""));}vals.push(id);await sql("UPDATE mm_users SET "+sets.join(",")+" WHERE id=$"+vals.length,...vals)}
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
const welcomeControls=(intent="home")=>{
 const safeIntent=/^[A-Za-z0-9:_-]{1,42}$/.test(intent)?intent:"home";
 return buttons([[["✨ Начать работу","onboard:"+safeIntent]],[["📄 Информация о сервисе","docs"],["🎬 Посмотреть пример","demo:home"]]]);
};
async function begin(u){
 if(u.blocked||u.suspended)return send(u.id,"Аккаунт ограничен. Напишите /support или используйте /mydata.");
 if(!testReady()||!(await legalReady(sql)))return send(u.id,"«Мир моделей» готовится к запуску. Пока доступно демо.",buttons([[["🎬 Демо","demo:home"]],[["📄 Документы","docs"]]]));
 if(testMode()){
  if(!canUseTestFeatures(Bun.env,u.consent))return send(u.id,testWarning,welcomeControls());
  const resume=u.state==="wizard"?[[{text:"▶️ Продолжить анкету",callback_data:"wizard:resume"},{text:"❌ Отменить",callback_data:"wizard:cancel"}]]:u.state==="profile_confirm"?[[{text:"✅ Сохранить черновик",callback_data:"profile_save"},{text:"✏️ Исправить",callback_data:"edit_profile"}]]:u.filters?.profileDraft?[[{text:"📝 Вернуться к черновику",callback_data:"edit_profile"},{text:"❌ Отменить",callback_data:"wizard:cancel"}]]:u.state==="job_wizard"?[[{text:"▶️ Продолжить заявку",callback_data:"jobwizard:resume"},{text:"❌ Отменить",callback_data:"jobwizard:cancel"}]]:u.state==="job_confirm"?[[{text:"✅ Опубликовать заявку",callback_data:"publish"},{text:"✏️ Исправить",callback_data:"job_template"}]]:[];
  return send(u.id,testMenuText+(resume.length?"\n\n📝 У вас есть незавершённая анкета.":""),{inline_keyboard:[...resume,...menu.inline_keyboard]});
 }
 const hashes=await currentDocumentHashes();
 if(!fullConsentsCurrent(u.consent,hashes))return send(u.id,"<b>Добро пожаловать в Мир моделей!</b>\nОзнакомьтесь с документами и дайте три отдельных согласия.",consentBoard(u,hashes));
 if(!u.phone)return send(u.id,"Подтвердите ваш собственный номер через кнопку Telegram. Номер не будет опубликован.",{keyboard:[[{text:"📱 Поделиться номером",request_contact:true}]],resize_keyboard:true,one_time_keyboard:true});
 if(!u.username)return send(u.id,"Установите @имя пользователя в настройках Telegram, затем отправьте /start.");
 return send(u.id,"<b>✨ Мир моделей</b>\nВыберите раздел.",menu);
}
const parse=parseFields;
const get=field;
const profileTpl="Кто вы: модель\nИмя: Анна\nДата рождения: 12.09.2002\nГород: Москва\nПол: женский\nРост: 172\nРазмер одежды: 42\nЦвет волос: русый\nДлина волос: длинные\nФормат: коммерция, ТФП\nПрайс: 3000 ₽/час\nО себе: съёмки каталогов\nПортфолио: https://example.com";
const clientTpl="Кто вы: фотограф\nИмя: Иван\nДата рождения: 05.03.1995\nГород: Москва\nОпыт и проекты: 4 года, снимал локальные бренды\nГонорар для модели: договорная\nО себе: снимаю каталог и лукбуки\nПортфолио: https://drive.google.com/...";
const jobTpl=()=>{
 const day=new Date(Date.now()+14*86400000);
 const date=[String(day.getUTCDate()).padStart(2,"0"),String(day.getUTCMonth()+1).padStart(2,"0"),day.getUTCFullYear()].join(".");
 return "Название заявки: Съёмка каталога\nКого ищу: модель\nТип работы: каталог\nГород: Москва\nТребования: женщина 20-30 лет\nФормат и оплата: 5000 ₽ за смену\nДата съёмки: "+date+"\nОписание: каталог одежды, 4 часа";
};
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
async function profile(to,u,heading="Анкета"){
 if(!u.profile||!Object.keys(u.profile).length)return;
 const reviews=await feedbackSummary(u.id,sql);
 if((u.photos||[]).length>1){
  const result=await call("sendMediaGroup",{chat_id:to,media:u.photos.slice(0,5).map(file=>({type:"photo",media:file}))});
  if(!result.ok)throw Error("Telegram media group delivery failed");
 } else if(u.photo){
  const photo=await call("sendPhoto",{chat_id:to,photo:u.photo});
  if(!photo.ok)throw Error("Telegram profile photo delivery failed");
 }
 const age=ageAt(get(u.profile,"дата рождения"));
 const content="<b>"+esc(heading)+"</b>\n"+
   (age!==null?"Возраст: "+age+"\n":"")+
   publicProfileEntries(u.profile).map(([k,v])=>esc(k)+": "+esc(v)).join("\n")+
   "\nКонтакты скрыты до принятого приглашения или отклика.\n\n"+reviews.text;
 const own=Number(to)===Number(u.id);
 const rows=own?[[["✏️ Изменить","edit_profile"],["🖼 Управление фото","photos"]]]:
  [[["✉️ Пригласить","invite:"+u.id]],...(reviews.count?[[["⭐ Все отзывы ("+reviews.count+")","allreviews:"+u.id+":0"]]]:[]),[["⚠️ Пожаловаться","reportuser:"+u.id]]];
 return send(to,content,buttons(rows));
}
async function card(to,j){
 const p=j.body||{},external=j.owner===0;
 const visible=k=>esc(external?sourceJobDisplayText(get(p,k)):redactContacts(get(p,k)));
 const lines=[
 "<b>📢 "+visible("название заявки")+"</b>",
 "Кого ищу: "+visible("кого ищу"),
 "Тип работы: "+visible("тип работы"),
 "Город: "+visible("город"),
 "Требования: "+(get(p,"требования")?visible("требования"):"не указано"),
 "Оплата: "+visible("формат и оплата"),
 "Дата: "+(get(p,"дата съёмки")?visible("дата съёмки"):"не указана"),
 "",visible("описание")
 ];
 if(get(p,"метка темы"))lines.push("Тематика: "+visible("метка темы"));
 if(external)lines.push("Заказчик не зарегистрирован в боте — сведения о нём не проверены.");
 return send(to,lines.join("\n"),buttons([[["✋ Откликнуться","reply:"+j.id]],[["⚠️ Пожаловаться","reportjob:"+j.id]]]));
}
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
 const eligible=await sql("SELECT id FROM mm_users WHERE id=$1 AND first_safety_sent_at IS NULL",u.id);
 if(!eligible.length)return false;
 try{
 const notice=await send(u.id,"<b>Безопасность</b>\n«Мир моделей» помогает найти исполнителей и съёмки, но не организует сделки, не проверяет заявления участников и не участвует в оплате. Уточняйте условия заранее, не отправляйте неизвестным людям предоплаты и личные материалы. Что сделать перед съёмкой: прочитайте памятку и сообщайте о подозрительных объявлениях.",buttons([[["📚 Прочитать памятку","articles"],["⚠️ Сообщить о проблеме","support"]]]));
 if(!notice?.ok)return false;
 await sql("UPDATE mm_users SET first_safety_sent_at=NOW() WHERE id=$1 AND first_safety_sent_at IS NULL",u.id);
 return true;
 }catch(e){console.error("Safety notice failed",String(e));return false}
}
// Webhooks enqueue work; a durable worker sends to recipients in bounded batches.
async function dispatch(j){
 await sql("INSERT INTO mm_fanout_queue(job_id) VALUES($1) ON CONFLICT(job_id) DO UPDATE SET pending=TRUE,cursor_id=0,profiles_done=FALSE,attempts=0,completed_at=NULL,next_attempt_at=NOW()",j.id);
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
 const owner=(await sql("SELECT filters,consent FROM mm_users WHERE id=$1 AND active=TRUE AND blocked=FALSE AND suspended=FALSE",job.owner))[0];
 if(!owner||!allConsentsCurrent(owner.consent,await currentDocumentHashes())||!matchesWantedProfileRoles(owner.filters?.profileRoles||[],get(p.profile,"кто вы")))return false;
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
 const requested=u.filters?.profileRoles|| (u.filters?.profileRole?[u.filters.profileRole]:[]);
 const city=(u.filters?.profileCity||u.filters?.city||"").trim().toLowerCase();
 const profiles=await sql("SELECT * FROM mm_users WHERE id<>$1 AND blocked=FALSE AND suspended=FALSE AND active=TRUE AND photo IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 300",u.id);
 const publicProfiles=profiles.filter(p=>{
  if(!publicProfileAllowed(p,cachedDocHashes,allConsentsCurrent,eligibleProfile))return false;
  if(!matchesWantedProfileRoles(requested,get(p.profile,"кто вы")))return false;
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
  "\nГород: "+esc(city||"все")+" · Профессия: "+esc(requested.join(", ")||"все"),buttons(rows));
}
async function chooseBrowseRole(u){
 const rows=[[["Все направления","browse_role:all"]]];
 const chosen=u.filters?.profileRoles|| (u.filters?.profileRole?[u.filters.profileRole]:[]);
 for(let i=0;i<ROLES.length;i+=2)rows.push(ROLES.slice(i,i+2).map((role,n)=>[(chosen.includes(role)?"✅ ":"☐ ")+role,"browse_role:"+(i+n)]));
 rows.push([["✅ Готово","browse:0"]]);
 return send(u.id,"Выберите одну или несколько профессий. Настройка действует и на каталог, и на присылаемые анкеты:",buttons(rows));
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


function demoMenu(){
 return buttons([[["👤 Пример анкеты","demo:profile"],["📢 Пример заявки","demo:job"]],[["🎯 Фильтры","demo:filters"],["🔎 Поиск анкет","demo:catalog"]],[["🏠 В начало","demo:home"]]]);
}
async function demoScreen(id,screen="home"){
 if(screen==="profile")return send(id,"🎬 <b>ДЕМО · Анкета</b>\n\nИмя: Анна\nНаправление: модель\nВозраст: 24 года\nГород: Москва\nРост: 172 см\nФормат: коммерция, ТФП\nПрайс: 3 000 ₽/час\nПортфолио: прикрепляется пользователем\n\nКонтакты скрыты до взаимодействия.",demoMenu());
 if(screen==="job")return send(id,"🎬 <b>ДЕМО · Заявка</b>\n\nСъёмка каталога одежды\nКого ищу: модель\nГород: Москва\nОплата: 5 000 ₽ за смену\nДата: по согласованию\nОписание: коммерческая съёмка, 4 часа.\n\nКнопки отклика заработают после открытия регистрации.",demoMenu());
 if(screen==="filters")return send(id,"🎬 <b>ДЕМО · Фильтры</b>\n\nГорода: Москва, Санкт-Петербург\nТип работы: реклама, кино\nФормат: коммерция / ТФП\nЧьи анкеты получать: фотографы, визажисты\n18+: выключено по умолчанию.\n\nЭто демонстрационные данные, реальные фильтры не меняются.",demoMenu());
 if(screen==="catalog")return send(id,"🎬 <b>ДЕМО · Каталог</b>\n\nАнкеты доступны по городу и профессии. Ключевое фото и обязательные поля проверяются до публикации. Контакты открываются только после приглашения.\n\nСейчас реальные данные пользователей не показываются.",demoMenu());
 return send(id,"🎬 <b>Демо «Мир моделей»</b>\nМожно посмотреть основные экраны без регистрации. Данные и фотографии вымышленные, реальные заявки не отправляются.",demoMenu());
}



let responseWorkerRunning=false;
async function processResponseOutbox(){
 if(responseWorkerRunning)return;
 responseWorkerRunning=true;
 try{
  await ensure();
  const ready=await sql("SELECT o.*,r.job_id,r.user_id,r.message,r.status AS response_status,j.owner,j.status AS job_status,j.paused FROM mm_response_outbox o JOIN mm_responses r ON r.id=o.response_id JOIN mm_jobs j ON j.id=r.job_id WHERE o.completed_at IS NULL AND o.next_attempt_at<=NOW() ORDER BY o.next_attempt_at LIMIT 5");
  for(const outbox of ready){
   try{
    const owner=(await sql("SELECT * FROM mm_users WHERE id=$1",outbox.owner))[0];
    const applicant=(await sql("SELECT * FROM mm_users WHERE id=$1",outbox.user_id))[0];
    if(!owner||!applicant||owner.blocked||owner.suspended||!owner.active||outbox.response_status!=="pending"||outbox.job_status!=="active"||outbox.paused){
     await sql("UPDATE mm_response_outbox SET completed_at=NOW() WHERE response_id=$1",outbox.response_id);
     continue;
    }
    if(outbox.step===0){
     const delivered=await send(owner.id,"✉️ <b>Новый отклик на заявку №"+outbox.job_id+"</b>\n\n"+esc(outbox.message));
     if(!delivered?.ok)throw Error("Telegram reply notification not delivered");
     await sql("UPDATE mm_response_outbox SET step=1,attempts=0,next_attempt_at=NOW() WHERE response_id=$1",outbox.response_id);
    }
    if(outbox.step<=1){
     const cardResult=await profile(owner.id,applicant,"Анкета откликнувшегося");
     if(!cardResult?.ok)throw Error("Telegram response profile card not delivered");
     await sql("UPDATE mm_response_outbox SET step=2,attempts=0,next_attempt_at=NOW() WHERE response_id=$1",outbox.response_id);
    }
    const controls=await send(owner.id,"Выберите действие:",buttons([[["✅ Принять отклик","acceptresponse:"+outbox.response_id],["❌ Отклонить","declineresponse:"+outbox.response_id]]]));
    if(!controls?.ok)throw Error("Telegram response controls not delivered");
    await sql("UPDATE mm_response_outbox SET completed_at=NOW(),step=3 WHERE response_id=$1",outbox.response_id);
   }catch(e){
    console.error("Response outbox:",String(e));
    await sql("UPDATE mm_response_outbox SET attempts=attempts+1,next_attempt_at=NOW()+make_interval(secs=>LEAST(3600,POWER(2,LEAST(attempts,8))*15)::int) WHERE response_id=$1",outbox.response_id);
   }
  }
 }finally{responseWorkerRunning=false}
}

async function promptWizard(u){
 const role=u.filters?.wizardRole,step=Number(u.filters?.wizardStep||0);
 const fields=wizardFields(role);
 if(!role||!fields.length)return begin(u);
 const item=wizardField(role,step);
 if(!item)return finishWizard(u);
 const total=fields.length;
 const existing=profileDraftOf(u)[item.key];
 return send(u.id,"✍️ <b>Анкета · шаг "+(step+1)+" из "+total+"</b>\n\n"+esc(item.label)+"\nПример: <code>"+esc(item.example)+"</code>"+(existing?"\nСейчас: "+esc(existing):"")+(testMode()&&item.key==="дата рождения"?"\n🧪 Укажите вымышленную дату.":""),buttons([
  ...(item.required?[]:[[["⏭ Пропустить","wizard:skip"]]]),
  ...(canFinishWizardNow(role,profileDraftOf(u))?[[["✅ Готово · остальные поля потом","wizard:finish_optional"]]]:[]),
  [[["◀️ Назад","wizard:back"],["❌ Отменить","wizard:cancel"]]]
 ]));
}
async function finishWizard(u){
 const draft=profileDraftOf(u),errors=validProfile(draft);
 if(errors.length){
  await change(u.id,{state:"profile"});
  return send(u.id,"Анкета почти готова, но нужно исправить:\n• "+esc(errors.join("\n• "))+"\n\nПришлите недостающие поля текстом в формате «Название: значение».",buttons([[["✏️ Исправить вручную","edit_profile"]],[["◀️ В меню","home"]]]));
 }
 await change(u.id,{state:"profile_confirm"});
 const summary=Object.entries(draft).map(([key,value])=>esc(key)+": "+esc(value)).join("\n");
 return send(u.id,"✅ <b>Анкета заполнена</b>\n\n"+summary+"\n\nТеперь сохраните анкету и добавьте главное фото.",buttons([[["✅ Сохранить анкету","profile_save"],["✏️ Исправить","edit_profile"]]]));
}
async function showWizardRolePage(id,page=0,selected=[],editMessageId=null){
 const perPage=8,totalPages=Math.ceil(WIZARD_ROLES.length/perPage);
 const current=Math.max(0,Math.min(totalPages-1,page)),chosen=Array.isArray(selected)?selected:[];
 const roles=WIZARD_ROLES.slice(current*perPage,(current+1)*perPage),rows=[];
 for(let i=0;i<roles.length;i+=2)rows.push(roles.slice(i,i+2).map((role,offset)=>[(chosen.includes(role)?"✅ ":"☐ ")+role,"wizard:role:"+(current*perPage+i+offset)]));
 const paging=[];
 if(current>0)paging.push(["◀️ Назад","wizard:page:"+(current-1)]);
 if(current<totalPages-1)paging.push(["Дальше ▶️","wizard:page:"+(current+1)]);
 if(paging.length)rows.push(paging);
 rows.push([["➡️ Продолжить ("+chosen.length+")","wizard:roles_done"]]);
 rows.push([["❌ Отмена","wizard:cancel"]]);
 const content="🪄 <b>Анкета · кто вы?</b>\nСтраница "+(current+1)+" из "+totalPages+
  "\n\nМожно выбрать несколько профессий. «Модель» и «актёр» совместимы друг с другом, но не со специальностями съёмочной команды."+
  "\n\nВыбрано: "+esc(chosen.join(", ")||"пока ничего");
 if(editMessageId){
  const edited=await call("editMessageText",{chat_id:id,message_id:editMessageId,text:content,parse_mode:"HTML",reply_markup:buttons(rows)});
  if(edited?.ok||/message is not modified/i.test(String(edited?.description||"")))return edited;
 }
 return send(id,content,buttons(rows));
}
async function startWizard(u,role){
 if(!String(role).split(",").map(x=>x.trim()).every(x=>WIZARD_ROLES.includes(x)))return send(u.id,"Выберите профессии из справочника.");
 const profile={...profileDraftOf(u),"кто вы":role};
 const filters=stageProfileDraft(u.filters,profile,{wizardRole:role,wizardStep:0});
 await change(u.id,{state:"wizard",filters});
 return promptWizard({...u,filters});
}
async function acceptWizardText(u,txt){
 const role=u.filters?.wizardRole,step=Number(u.filters?.wizardStep||0);
 const item=wizardField(role,step),accepted=wizardAnswer(item,txt);
 if(!accepted.ok)return send(u.id,"⚠️ "+esc(accepted.error));
 const profile={...profileDraftOf(u),[item.key]:accepted.value};
 const filters=stageProfileDraft(u.filters,profile,{wizardStep:step+1});
 await change(u.id,{filters});
 const current={...u,filters};
 return wizardCompleted(role,filters.wizardStep)?finishWizard(current):promptWizard(current);
}


async function jobWizardPrompt(u){
 const step=Number(u.filters?.jobWizardStep??0),f=jobWizardField(step);
 if(!f)return finishJobWizard(u);
 const existing=u.filters?.jobWizardDraft?.[f.key];
 const controls=[];
 if(!f.required)controls.push([["⏭ Пропустить","jobwizard:skip"]]);
 controls.push([["◀️ Назад","jobwizard:back"],["❌ Отменить","jobwizard:cancel"]]);
 return send(u.id,"📢 <b>Заявка · шаг "+(step+1)+" из "+jobWizardFields.length+"</b>\n\n"+esc(f.label)+"\nПример: <code>"+esc(f.example)+"</code>"+(existing?"\nСейчас: "+esc(existing):""),buttons(controls));
}
async function finishJobWizard(u){
 const draft={...(u.filters?.jobWizardDraft||{})};
 const errors=validJob(draft);
 if(errors.length){
  await change(u.id,{state:"job"});
  return send(u.id,"Некоторые поля заявки требуют исправления:\n• "+esc(errors.join("\n• "))+"\n\nОтправьте заполненный шаблон заявки ещё раз.",buttons([[["📝 Открыть шаблон","job_template"],["❌ Отменить","jobwizard:cancel"]]]));
 }
 const filters={...clearJobWizard(u.filters),draft,draftToken:crypto.randomUUID()};
 await change(u.id,{state:"job_confirm",filters});
 return send(u.id,"📋 <b>Проверьте заявку</b>\n\n"+Object.entries(draft).map(([k,v])=>esc(k)+": "+esc(v)).join("\n")+"\n\nПосле публикации заявка появится в поиске.",buttons([[["✅ Опубликовать","publish"],["✏️ Исправить","job_template"]],[["❌ Отменить","jobwizard:cancel"]]]));
}
async function saveJobWizardAnswer(u,text){
 const step=Number(u.filters?.jobWizardStep??0),f=jobWizardField(step),v=validateJobWizardAnswer(f,text);
 if(!v.ok)return send(u.id,"⚠️ "+esc(v.error));
 const draft={...(u.filters?.jobWizardDraft||{}),[f.key]:v.value};
 const filters=jobWizardFilters(u.filters,draft,step+1);
 await change(u.id,{filters});
 const current={...u,filters};
 return jobWizardFinished(step+1)?finishJobWizard(current):jobWizardPrompt(current);
}

async function submitResponse(u,body){
 const id=u.id,jobId=Number(u.filters?.replyJobId),message=String(body||"").trim();
 if(!Number.isSafeInteger(jobId)||jobId<=0)return send(id,"Черновик отклика больше не найден. Найдите заявку заново.");
 if(!message||message.length>1200)return send(id,"Напишите текст отклика длиной от 1 до 1200 символов. Для отмены — /cancel.");
 if(!eligibleProfile(u.profile,u.photo))return send(id,"Перед откликом заполните анкету и добавьте главное фото.");
 const j=(await sql("SELECT * FROM mm_jobs WHERE id=$1 AND status='active' AND paused=FALSE AND expires_at>NOW()",jobId))[0];
 if(!j||j.owner===id)return send(id,"Заявка недоступна для отклика.");
 const existing=await sql("SELECT id FROM mm_responses WHERE job_id=$1 AND user_id=$2",jobId,id);
 if(existing.length){
  if(j.owner!==0)await sql("INSERT INTO mm_response_outbox(response_id) VALUES($1) ON CONFLICT DO NOTHING",existing[0].id);
  return send(id,"Отклик уже сохранён. Если уведомление ещё не было доставлено заказчику, бот повторит отправку.");
 }
 const quota=await sql("SELECT COUNT(*)::int n FROM mm_responses WHERE user_id=$1 AND created_at>=$2",id,weekStartMoscow().toISOString());
 if(!hasPaidAccess(u)&&quota[0].n>=1)return send(id,"На этой неделе бесплатный отклик уже использован.");
 const inserted=await sql("INSERT INTO mm_responses(job_id,user_id,message) VALUES($1,$2,$3) ON CONFLICT(job_id,user_id) DO NOTHING RETURNING id",jobId,id,message);
 if(!inserted.length)return send(id,"Отклик уже отправлен.");
 const f={...(u.filters||{})};delete f.replyJobId;
 await change(id,{state:"",filters:f});
 const owner=j.owner===0?null:(await sql("SELECT * FROM mm_users WHERE id=$1",j.owner))[0];
 if(owner){
  await sql("INSERT INTO mm_response_outbox(response_id) VALUES($1) ON CONFLICT DO NOTHING",inserted[0].id);
 }
 if(j.contact){
  const contact=String(j.contact).trim(),username=contact.replace(/^@/,"");
  if(/^[A-Za-z0-9_]{5,32}$/.test(username)){
   const text="Здравствуйте! Откликаюсь на вашу заявку «"+get(j.body,"название заявки")+"». "+message;
   return send(id,"Отклик учтён. Откройте чат с автором и отправьте подготовленное сообщение:",{inline_keyboard:[[{text:"✉️ Открыть чат автора",url:"https://t.me/"+username+"?text="+encodeURIComponent(text)}]]});
  }
  return send(id,"Отклик учтён. Контакт автора объявления: "+esc(contact)+"\nВаш текст: "+esc(message));
 }
 if(owner)return send(id,"✅ Отклик сохранён. Уведомление заказчику поставлено в очередь, контакт откроется после принятия.");
 return send(id,owner?"Отклик сохранён и отправлен заказчику.":"Отклик сохранён, но у внешнего объявления нет доступного контакта.");
}

async function onMessage(m){
 if(m.chat?.type&&m.chat.type!=="private"){await onSourcePost(m);return}
 const text=String(m.text||"");
 if(text==="/demo")return demoScreen(m.from.id);
 if(text==="/id")return send(m.from.id,"Telegram ID: <code>"+m.from.id+"</code>");
 if(text.startsWith("/start")&&(Bun.env.REGISTRATION_ENABLED!=="true"||!(await legalReady(sql)))){
  return send(m.from.id,"«Мир моделей» готовится к запуску. Регистрация откроется после публикации документов и проверки интеграций. Пока можно посмотреть демонстрацию.",buttons([[["🎬 Посмотреть демо","demo:home"]],[["📄 Документы","docs"]]]));
 }
 if(testMode()&&testReady()){
  const existing=(await sql("SELECT consent FROM mm_users WHERE id=$1",m.from.id))[0];
  const personalControl=!!existing&&/^\/(?:mydata|deleteaccount|support|cancel|help)(?:\s|$)/.test(text);
  if(!canUseTestFeatures(Bun.env,existing?.consent)&&!personalControl)
   return send(m.from.id,testWarning,welcomeControls());
 }
 let u=await who(m.from),id=u.id,t=m.text||"";if(await adminAction(u,t))return;if(t==="/demo")return demoScreen(id);if(t==="/id")return send(id,"Telegram ID: <code>"+id+"</code>");
 if(t==="/cancel"){const f=clearJobWizard(discardProfileDraft(u.filters));delete f.replyJobId;delete f.relayPeer;delete f.draft;delete f.draftToken;delete f.draftJobId;await change(id,{state:"",filters:f});return send(id,"Действие отменено. Несохранённые изменения сброшены. Вернуться в меню: /start");}
 if(t==="/help")return send(id,"ℹ️ <b>Мир моделей</b>\n/start — главное меню\n/demo — попробовать без анкеты\n/cancel — отмена текущего действия\n/mydata — экспорт своих данных\n/deleteaccount — удалить аккаунт\n\n🧪 Сейчас включён тестовый режим. Используйте вымышленные данные.",buttons([[["👤 Моя анкета","profile"],["ℹ️ Как работает","how"]],[["🏠 В меню","home"]]]));
 if(t==="/teststatus")return send(id,testMode()?"🧪 Тестовый режим активен. Регистрация открыта: "+(testReady()?"да":"нет")+"\nПлатежи отключены.\nТелефон не требуется.":"Тестовый режим выключен.");if(t==="/mydata"){const payload=await exportAccount(sql,id);if(!payload)return send(id,"Данных нет.");const sent=await sendAccountExport(token,id,payload);if(!sent)return send(id,"Не получилось отправить архив. Попробуйте позже.");return;}
 if(t==="/deleteaccount"){await change(id,{state:"delete_confirm"});return send(id,"<b>Удалить аккаунт и данные?</b>\nЭто удалит анкету, фотографии из нашей базы, ваши заявки, историю откликов, отзывов, приглашений, согласий и обращений. Сообщения, ранее отправленные другим пользователям Telegram, стереть удалённо нельзя.\n\nПодтвердите удаление отдельной кнопкой.",buttons([[["❌ Удалить мои данные","deleteaccount:confirm"]],[["Отмена","deleteaccount:cancel"]]]));}if(t==="/subscription"&&testMode())return send(id,"🧪 Тестовый доступ: лимиты заявок, откликов и приглашений для проверки сняты. Настоящие платежи выключены.");if(t==="/subscription")return send(id,hasPaidAccess(u)?"⭐ Подписка или пробный период активны до "+esc(new Date(u.access_until&&new Date(u.access_until)>new Date(u.trial_until||0)?u.access_until:u.trial_until).toLocaleDateString("ru-RU")):"Бесплатный доступ: один отклик, одна заявка и одно приглашение в календарную неделю.");if(t.startsWith("/start")){
 if(u.state==="relay"){const filters={...(u.filters||{})};delete filters.relayPeer;await change(id,{state:"",filters});u={...u,state:"",filters};}
 const payload=t.trim().split(/\s+/)[1]||"";
 if(/^ref_\d{2,19}$/.test(payload)){
  const inviter=Number(payload.slice(4));
  if(Number.isSafeInteger(inviter)&&inviter!==id){
   const hasInviter=await sql("SELECT id FROM mm_users WHERE id=$1",inviter);
   if(hasInviter.length)await sql("INSERT INTO mm_referrals(inviter,invitee) VALUES($1,$2) ON CONFLICT(invitee) DO NOTHING",inviter,id);
  }
 }
 if(/^job_\d+$/.test(payload)&&Bun.env.REGISTRATION_ENABLED==="true"&&await legalReady(sql)&&(testMode()||u.phone)&&allConsentsCurrent(u.consent,await currentDocumentHashes())){
  const j=(await sql("SELECT * FROM mm_jobs WHERE id=$1 AND status='active' AND paused=FALSE AND expires_at>NOW()",Number(payload.slice(4))))[0];
  if(j){await card(id,j);return begin(u)}
  await send(id,"Эта заявка больше не актуальна.");return begin(u);
 }
 if(/^profile_\d+$/.test(payload)&&Bun.env.REGISTRATION_ENABLED==="true"&&await legalReady(sql)&&(testMode()||u.phone)&&allConsentsCurrent(u.consent,await currentDocumentHashes())){
  const target=(await sql("SELECT * FROM mm_users WHERE id=$1 AND active=TRUE AND blocked=FALSE AND suspended=FALSE AND photo IS NOT NULL",Number(payload.slice(8))))[0];
  if(target&&eligibleProfile(target.profile,target.photo)&&allConsentsCurrent(target.consent,await currentDocumentHashes())){await profile(id,target);return begin(u)}
  await send(id,"Эта анкета сейчас не участвует в поиске.");return begin(u);
 }
 return begin(u);
}if(t==="/support"){await change(id,{state:"support"});return send(id,"Опишите проблему одним сообщением.");}if(admin.includes(String(id))&&t==="/stats"){let a=await sql("SELECT (SELECT count(*) FROM mm_users)::int AS users,(SELECT count(*) FROM mm_jobs)::int AS jobs,(SELECT count(*) FROM mm_reports)::int AS reports");return send(id,JSON.stringify(a[0]));}if((u.blocked||u.suspended)&&u.state!=="support")return send(id,"Ваш профиль ограничен; напишите /support.");if(u.state===""&&t&&!t.startsWith("/")&&await feedbackText(id,t,sql,send))return; if(m.contact){
 if(testMode())return send(id,"🧪 В тестовом режиме телефон не нужен. Не отправляйте настоящий номер.");
 if(Bun.env.REGISTRATION_ENABLED!=="true"||!(await legalReady(sql))||!allConsentsCurrent(u.consent,await currentDocumentHashes()))return begin(u);
 if(!m.contact.user_id||Number(m.contact.user_id)!==Number(id))return send(id,"Поделитесь своим номером через кнопку Telegram.");
 if(!m.contact.phone_number)return send(id,"Номер не получен. Используйте кнопку подтверждения.");
 await change(id,{phone:m.contact.phone_number});
 const trial=await startPhoneTrial(sql,id,m.contact.phone_number,Bun.env.PHONE_HASH_PEPPER||"");
 if(trial.started)await send(id,"🎁 Пробный период на 15 дней активирован.");
 await call("sendMessage",{chat_id:id,text:"Телефон подтверждён.",reply_markup:{remove_keyboard:true}});
 return begin({...u,phone:m.contact.phone_number,trial_until:trial.until||u.trial_until});
}
if((Bun.env.REGISTRATION_ENABLED!=="true"||!(await legalReady(sql))||!allConsentsCurrent(u.consent,await currentDocumentHashes()))&&u.state!=="support")return begin(u);
if(m.photo?.length&&u.state==="photo"){
 const file=m.photo[m.photo.length-1].file_id;
 // Append using one database statement; simultaneous Telegram album parts cannot lose photo IDs.
 const saved=await sql("UPDATE mm_users SET photos=CASE WHEN photos @> jsonb_build_array($2::text) THEN photos ELSE photos || jsonb_build_array($2::text) END,photo=COALESCE(photo,$2) WHERE id=$1 AND (jsonb_array_length(photos)<5 OR photos @> jsonb_build_array($2::text)) RETURNING photos",id,file);
 const photos=saved[0]?.photos||[];
 if(photos.length>=5)await change(id,{state:""});
 if(photos.length===1)await send(id,"Первое фото сохранено — оно будет главным. Можно добавить до пяти фотографий.",buttons([[["✅ Готово","photo_done"]]]));
 if(photos.length>=5){await send(id,"Все пять фотографий сохранены ✅");const fresh=(await sql("SELECT * FROM mm_users WHERE id=$1",id))[0];await backfill(fresh);await profileBackfill(fresh);return begin(fresh)}
 return;
}
if(u.state==="relay"){
  const peerId=Number(u.filters?.relayPeer);
  if(!await relayAuthorized(sql,id,peerId))return send(id,"Переписка недоступна: нет подтверждённого сотрудничества или доступ отозван.");
  const peer=(await sql("SELECT * FROM mm_users WHERE id=$1",peerId))[0];
  if(!peer||peer.blocked||peer.suspended||!allConsentsCurrent(peer.consent,await currentDocumentHashes()))return send(id,"Сейчас написать этому участнику невозможно.");
  if(!t.trim()||t.length>1500)return send(id,"Отправьте текстовое сообщение до 1500 символов. Выйти из переписки: /cancel");
  if(!await consumeRelayQuota(sql,id))return send(id,"На этот час лимит в 20 сообщений исчерпан. Попробуйте позже.");
  const delivered=await send(peerId,"💬 <b>Сообщение участника, с которым вы сотрудничаете</b>\n\n"+esc(t),buttons([
    [["↩️ Ответить","relay:"+id],["⚠️ Пожаловаться","reportuser:"+id]]
  ]));
  if(!delivered?.ok)return send(id,"Telegram не доставил сообщение. Возможно, собеседник заблокировал бота.");
  return send(id,"✅ Сообщение передано. Можете написать ещё или выйти: /cancel");
 }
 if(u.state==="wizard"){if(m.photo?.length)return send(id,"Для фото будет отдельный шаг после заполнения анкеты. Сейчас отправьте ответ текстом.");return acceptWizardText(u,t)}
 if(u.state==="job_wizard")return saveJobWizardAnswer(u,t);
 if(u.state==="reply_compose"){if(!t.trim())return send(id,"Отклик должен быть текстовым сообщением. Для отмены — /cancel.");return submitResponse(u,t)}
 if(u.state==="support"){if(m.photo?.length)return saveReport(u,m.caption||"Фото-доказательство",m.photo.at(-1).file_id);return saveReport(u,t)}
if(u.state==="profile"){
 const input=m.caption||t;
 const parsed=parse(input);
 const photoFile=m.photo?.length?m.photo[m.photo.length-1].file_id:null;
 if(!Object.keys(parsed).length&&!photoFile)return send(id,"Не вижу заполненных полей. Пришлите строки «Имя: ...», «Город: ...» и т. д. либо добавьте фото с подписью.");
 const draft={...profileDraftOf(u),...parsed};
 const filters=stageProfileDraft(u.filters,draft,photoFile?{profileDraftPhoto:photoFile}:{});
 await change(id,{filters});
 const errors=validProfile(draft);
 if(errors.length)return send(id,"Черновик сохранён, но для завершения ещё нужно:\n• "+esc(errors.join("\n• "))+"\n\nДобавьте недостающие строки — уже заполненные поля не потеряются.");
 await change(id,{state:"profile_confirm"});
 const summary=Object.entries(draft).map(([key,value])=>esc(key)+": "+esc(value)).join("\n");
 return send(id,"<b>✅ Проверьте черновик</b>\n\n"+summary+"\n\nДо нажатия «Сохранить» ваш публичный профиль не меняется.",buttons([[["✅ Сохранить","profile_save"],["✏️ Исправить","edit_profile"],["❌ Отменить","wizard:cancel"]]]));
}
if(u.state==="job_edit"){
 const originalId=Number(u.filters?.draftJobId);
 const original=(await sql("SELECT id FROM mm_jobs WHERE id=$1 AND owner=$2 AND status='active'",originalId,id))[0];
 if(!original)return send(id,"Эта заявка уже недоступна для изменений.");
 const draft={...parse(t)},errors=validJob(draft);
 if(errors.length)return send(id,"Исправьте заявку:\n• "+esc(errors.join("\n• ")));
 await change(id,{filters:{...(u.filters||{}),draft},state:"job_edit_confirm"});
 return send(id,"<b>Проверьте изменения заявки №"+originalId+"</b>\n"+esc(t),buttons([[["✅ Сохранить изменения","updatejob:"+originalId],["✏️ Изменить","jobedit:"+originalId]]]));
}
if(u.state==="job"){let p=parse(t),errors=validJob(p);if(errors.length)return send(id,"Исправьте заявку:\n• "+esc(errors.join("\n• ")));await change(id,{filters:{...(u.filters||{}),draft:p,draftToken:crypto.randomUUID()},state:"job_confirm"});return send(id,"Предпросмотр:\n"+esc(t),buttons([[["✅ Опубликовать","publish"],["✏️ Исправить","job_template"]]]))}
if(u.state==="browse_city"){
  const city=t.trim().toLowerCase()==="все"?"":t.trim().slice(0,80);
  const filters={...(u.filters||{}),profileCity:city};
  await change(id,{filters,state:""});return browseProfiles({...u,filters},0);
 }
 if(u.state==="filter"){let p=parse(t);await change(id,{filters:{...(u.filters||{}),city:get(p,"город"),work:get(p,"тип работы"),format:get(p,"формат")},state:""});await send(id,"Фильтры сохранены. Подбираю актуальные заявки.",menu);const fresh=(await sql("SELECT * FROM mm_users WHERE id=$1",id))[0];await backfill(fresh);return showFilterMenu(fresh)}
return begin(u)}
async function onCallback(c){
 await call("answerCallbackQuery",{callback_query_id:c.id});
 if(c.data?.startsWith("demo:"))return demoScreen(c.from.id,c.data.slice(5));
 if(c.data==="docs")return send(c.from.id,"Документы сервиса: "+esc((Bun.env.PUBLIC_URL||"").replace(/\/$/,"")+"/documents"));
 const requestedAction=String(c.data||"");
 const onboardingClick=requestedAction==="test:agree"||requestedAction.startsWith("onboard:");
 if(testMode()&&!onboardingClick&&!["test:revoke","privacy","privacy:export","privacy:delete","deleteaccount:cancel","deleteaccount:confirm"].includes(requestedAction)){
  const existing=(await sql("SELECT consent FROM mm_users WHERE id=$1",c.from.id))[0];
  if(!canUseTestFeatures(Bun.env,existing?.consent))
   return send(c.from.id,testWarning,welcomeControls(requestedAction));
 }
 let u=await who(c.from),id=u.id,a=requestedAction;
 if(onboardingClick){
  if(!testMode()||!testReady())return send(id,"Регистрация пока недоступна.");
  const consent={...(u.consent||{}),test_access:true,test_at:new Date().toISOString()};
  await change(id,{consent,active:true});
  u={...u,consent,active:true};
  a=requestedAction.startsWith("onboard:")?requestedAction.slice(8):"home";
  if(a==="home")return begin(u);
 }
 if(a==="test:revoke"){
  if(!testMode())return send(id,"Эта функция доступна только в тестовом режиме.");
  const consent={...(u.consent||{}),test_access:false,test_revoked_at:new Date().toISOString()};
  await change(id,{consent,active:false,state:""});
  await sql("UPDATE mm_jobs SET paused=TRUE WHERE owner=$1 AND status='active'",id);
  return send(id,"Тестовое согласие отозвано. Анкета больше не участвует в подборе. Удалить все данные: /deleteaccount");
 }
 if(a==="privacy")return send(id,"🔐 <b>Данные и приватность</b>\nЭкспорт показывает сведения, сохранённые сервисом. Удаление аккаунта безвозвратное; ранее отправленные Telegram-сообщения других людей останутся.",buttons([[["📦 Экспорт данных","privacy:export"]],[["🗑 Удалить аккаунт","privacy:delete"]],...(testMode()?[[["🧪 Отозвать участие в тесте","test:revoke"]]]:[]),[["◀️ В меню","home"]]]));
 if(a==="privacy:export"){const payload=await exportAccount(sql,id);if(!payload)return send(id,"Сведения ещё не сохранены.");const sent=await sendAccountExport(token,id,payload);if(!sent)return send(id,"Ошибка отправки файла.");return;}
 if(a==="privacy:delete"){await change(id,{state:"delete_confirm"});return send(id,"<b>Подтвердите окончательное удаление</b>\nАнкета, фото и объявления будут удалены из базы. Уже отправленные сообщения в чужих Telegram-чатах сохранятся.",buttons([[["Да, удалить всё","deleteaccount:confirm"]],[["Отменить","deleteaccount:cancel"]]]));}
 if(a==="deleteaccount:cancel"){await change(id,{state:""});return send(id,"Удаление отменено.",menu);}
 if(a==="deleteaccount:confirm"){
  if(u.state!=="delete_confirm")return send(id,"Сначала откройте раздел «Мои данные» и подтвердите удаление.");
  await deleteAccount(sql,id);
  return send(id,"Ваш аккаунт и связанные с ним данные удалены из нашей базы. Для создания нового аккаунта используйте /start.");
 }
 if((u.blocked||u.suspended)&&!["support","report"].includes(a)&&!a.startsWith("reportjob:")&&!a.startsWith("reportuser:"))return send(id,"Ваш аккаунт ограничен. Вы можете обратиться в поддержку, экспортировать или удалить данные.");
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
if(a==="more")return send(id,"⚙️ <b>Дополнительно</b>\nИнформация о проекте, приватность и поддержка.",buttons([
 [["📚 Статьи","articles"],["🎁 Пригласить друга","invitefriend"]],
 [["🔐 Личные данные","privacy"],["❓ Поддержка","support"]],
 [["🧪 Доступ и подписка","access_info"],["🏠 В меню","home"]]
]));
 if(a==="how")return send(id,"<b>Как работает «Мир моделей»</b>\n\n1. Создайте анкету — можно отвечать по шагам.\n2. Прикрепите ключевое фото (до пяти).\n3. Настройте фильтры по городу, типу работы и оплате.\n4. Найдите заявку и отправьте персональный отклик либо разместите свою заявку.\n5. Принимайте приглашения и отклики, затем договаривайтесь напрямую.\n\n🧪 Пока включено тестирование: используйте только вымышленные данные. Платежи не работают.",buttons([[["👤 Создать анкету","profile"],["📢 Посмотреть заявки","jobs"]],[["🏠 В меню","home"]]]));
 if(a==="access_info")return send(id,testMode()?"🧪 <b>Тестовый доступ открыт</b>\nОплата отключена, лимиты для тестирования сняты. Тестовые данные будут удалены при подготовке к коммерческому запуску.":"Пробный и платный доступ проверяются по текущей подписке.");
 if(a==="myresponses"){
  const responses=await sql("SELECT r.id,r.job_id,r.status,r.created_at,j.body,j.owner FROM mm_responses r LEFT JOIN mm_jobs j ON j.id=r.job_id WHERE r.user_id=$1 ORDER BY r.created_at DESC LIMIT 15",id);
  if(!responses.length)return send(id,"Вы ещё не отправляли отклики.",buttons([[["📢 Найти заявки","jobs"],["🏠 В меню","home"]]]));
  const labels={pending:"🕓 Ожидает",accepted:"✅ Принят",declined:"❌ Отклонён"};
  const lines=responses.map(r=>"№"+r.id+" · "+esc(get(r.body||{},"название заявки")||"Заявка №"+r.job_id)+" — "+(labels[r.status]||esc(r.status||"отправлен")));
  const rows=responses.filter(r=>r.status==="accepted"&&Number(r.owner)>0).slice(0,5).map(r=>[["💬 Связаться по отклику №"+r.id,"relay:"+r.owner]]);
  rows.push([["📢 Найти заявки","jobs"],["🏠 В меню","home"]]);
  return send(id,"📬 <b>Ваши последние отклики</b>\n\n"+lines.join("\n"),buttons(rows));
 }
 if(a==="myinvites"){
  const invitations=await sql("SELECT id,from_user,to_user,status,created_at FROM mm_invitations WHERE from_user=$1 OR to_user=$1 ORDER BY created_at DESC LIMIT 20",id);
  if(!invitations.length)return send(id,"Приглашений пока нет.",buttons([[["🔎 Каталог анкет","browse:0"],["🏠 В меню","home"]]]));
  const labels={sent:"🕓 Ожидает",accepted:"✅ Принято",declined:"❌ Отклонено",cancelled:"🚫 Отменено"};
  const lines=invitations.map(inv=>(Number(inv.from_user)===Number(id)?"📤 Исходящее":"📥 Входящее")+" №"+inv.id+" — "+(labels[inv.status]||esc(inv.status||"неизвестно")));
  const rows=[];
  for(const invite of invitations.slice(0,10)){
   const mine=Number(invite.from_user)===Number(id),peer=mine?invite.to_user:invite.from_user;
   if(invite.status==="sent"&&!mine)rows.push([["✅ Принять №"+invite.id,"acceptinvite:"+invite.id],["❌ Отклонить","rejectinvite:"+invite.id]]);
   else if(invite.status==="sent"&&mine)rows.push([["🚫 Отменить №"+invite.id,"cancelinvite:"+invite.id]]);
   else if(invite.status==="accepted")rows.push([["💬 Переписка №"+invite.id,"relay:"+peer]]);
  }
  rows.push([["🔎 Каталог анкет","browse:0"],["🏠 В меню","home"]]);
  return send(id,"✉️ <b>Ваши приглашения</b>\n\n"+lines.join("\n"),buttons(rows));
 }
 if(a.startsWith("cancelinvite:")){
  const inviteId=Number(a.slice("cancelinvite:".length));
  const rows=await sql("UPDATE mm_invitations SET status='cancelled' WHERE id=$1 AND from_user=$2 AND status='sent' RETURNING to_user",inviteId,id);
  if(!rows.length)return send(id,"Приглашение уже обработано.");
  try{await send(rows[0].to_user,"Входящее приглашение №"+inviteId+" отменено отправителем.")}catch(e){console.error("Invite cancellation notice",String(e))}
  return send(id,"Приглашение отменено. Контакты не раскрыты.");
 }
 if(a==="invitefriend"){
 const whoAmI=await call("getMe",{});const name=whoAmI.ok?whoAmI.result.username:(Bun.env.BOT_USERNAME||"").replace(/^@/,"");
 if(!name)return send(id,"Ссылка для приглашения пока недоступна.");
 const link="https://t.me/"+name+"?start=ref_"+id;
 const count=(await sql("SELECT COUNT(*)::int n FROM mm_referrals WHERE inviter=$1",id))[0].n;
 return send(id,"🎁 Пригласите друга в «Мир моделей»!\nВаша ссылка: "+esc(link)+"\nПо ссылке пришли: "+count+"\nСкидки по реферальной программе заработают после подключения оплаты.");
}
if(a==="docs")return send(id,"Все опубликованные документы сервиса: "+esc((Bun.env.PUBLIC_URL||"").replace(/\/$/,"")+"/documents"));if(a==="go")return begin(u);
 if(Bun.env.REGISTRATION_ENABLED!=="true"||!(await legalReady(sql))||!allConsentsCurrent(u.consent,await currentDocumentHashes()))return begin(u);if(!testMode()&&(!u.phone||!u.username))return begin(u);if(a==="profile"){if(Object.keys(u.profile||{}).length)await profile(id,u,"Ваша анкета");return send(id,"Выберите удобный способ заполнения. Можно отвечать на вопросы по одному, либо отправить шаблон одним сообщением.",buttons([[["🪄 Заполнить по шагам","profile_wizard"]],[["📝 Отправить шаблон","edit_profile"],["📷 Добавить фото","addphoto"]]]))}if(a==="profile_wizard"){
  const selected=String(u.filters?.wizardSelected?.join(",")||get(profileDraftOf(u),"кто вы")).split(",").map(x=>x.trim()).filter(x=>WIZARD_ROLES.includes(x));
  await change(id,{filters:{...(u.filters||{}),wizardSelected:selected}});
  return showWizardRolePage(id,0,selected);
 }
 if(a.startsWith("wizard:page:")){
  const page=Number(a.slice("wizard:page:".length));
  return showWizardRolePage(id,Number.isInteger(page)?page:0,u.filters?.wizardSelected||[],c.message?.message_id);
 }
 if(a.startsWith("wizard:role:")){
  const index=Number(a.slice("wizard:role:".length)),role=WIZARD_ROLES[index];
  if(!role)return send(id,"Профессия не найдена.");
  const selected=toggleProfileRole(u.filters?.wizardSelected||[],role);
  const filters={...(u.filters||{}),wizardSelected:selected.selected};
  await change(id,{filters});
  if(selected.error)await send(id,"ℹ️ "+esc(selected.error));
  return showWizardRolePage(id,Math.floor(index/8),selected.selected,c.message?.message_id);
 }
 if(a==="wizard:roles_done"){
  const selected=u.filters?.wizardSelected||[];
  if(!selected.length)return send(id,"Выберите хотя бы одну профессию.",buttons([[["🪄 Выбрать","profile_wizard"]]]));
  return startWizard(u,selected.join(", "));
 }
 if(a==="wizard:finish_optional"){
  if(u.state!=="wizard"||!canFinishWizardNow(u.filters?.wizardRole,profileDraftOf(u)))return send(id,"Сначала заполните обязательные поля.");
  return finishWizard(u);
 }
 if(a==="wizard:resume"){
  if(u.state!=="wizard")return send(id,"Откройте «Моя анкета», чтобы продолжить заполнение.");
  return promptWizard(u);
 }
 if(a==="wizard:cancel"){const cleaned=discardProfileDraft(u.filters);delete cleaned.wizardSelected;await change(id,{state:"",filters:cleaned});return send(id,"Изменения анкеты отменены. Ваш прежний профиль сохранён.",buttons([[["🏠 В меню","home"],["👤 Моя анкета","profile"]]]));}
 if(a==="wizard:back"||a==="wizard:skip"){
  if(u.state!=="wizard")return send(id,"Мастер заполнения завершён. Откройте анкету заново.");
  const role=u.filters?.wizardRole,step=Number(u.filters?.wizardStep||0);
  if(a==="wizard:skip"&&wizardField(role,step)?.required)return send(id,"Это обязательное поле.");
  const filters={...(u.filters||{}),wizardStep:a==="wizard:back"?Math.max(0,step-1):step+1};
  await change(id,{filters});
  const next={...u,filters};
  return wizardCompleted(role,filters.wizardStep)?finishWizard(next):promptWizard(next);
 }
 if(a.startsWith("relay:")){
  const peerId=Number(a.slice("relay:".length));
  if(!await relayAuthorized(sql,id,peerId))return send(id,"Переписка разрешена только после принятого приглашения или отклика.");
  const peer=(await sql("SELECT * FROM mm_users WHERE id=$1",peerId))[0];
  if(!peer||peer.blocked||peer.suspended||!allConsentsCurrent(peer.consent,await currentDocumentHashes()))return send(id,"Участник сейчас недоступен.");
  await change(id,{state:"relay",filters:{...(u.filters||{}),relayPeer:peerId}});
  return send(id,"💬 <b>Переписка через бота</b>\nНапишите собеседнику текст. Он получит сообщение с кнопкой «Ответить».\nЛимит: 20 сообщений в час.\nВыйти: /cancel.");
 }
 if(a==="edit_profile"){
 const draft=profileDraftOf(u);
 if(Object.keys(draft).length){
  const filters=stageProfileDraft(u.filters,draft);
  await change(id,{state:"profile",filters});
  return send(id,"📝 <b>Редактирование анкеты</b>\nПришлите только изменившиеся поля. Например:\n<code>Город: Москва, Казань</code>\n\nИзменения появятся в каталоге после подтверждения.",buttons([[["❌ Отменить","wizard:cancel"]]]));
 }
 return send(id,"Выберите шаблон анкеты или заполните по шагам:",buttons([[["🪄 По шагам","profile_wizard"]],[["🎬 Модель / актёр","template_model"],["📸 Специалист / бренд","template_client"]]]));
}
if(a==="template_model"||a==="template_client"){
 const role=a==="template_model"?"модель":"фотограф";
 const filters=stageProfileDraft(u.filters,{...profileDraftOf(u),"кто вы":role});
 await change(id,{state:"profile",filters});
 const tpl=a==="template_model"?profileTpl:clientTpl;
 return send(id,"📝 Скопируйте шаблон, заполните и отправьте отдельным сообщением (можно с фото):\n<code>"+esc(tpl)+"</code>\n\nВ тестовом режиме используйте вымышленные данные.");
}if(a==="profile_save"){
 if(u.state!=="profile_confirm"||!u.filters?.profileDraft)return send(id,"Черновик не найден. Откройте «Моя анкета» и проверьте изменения.");
 const draft=profileDraftOf(u),errors=validProfile(draft);
 if(errors.length)return send(id,"Нужно исправить поля:\n• "+esc(errors.join("\n• ")));
 const pendingPhoto=u.filters.profileDraftPhoto;
 const photos=mergeProfilePhoto(u.photos,pendingPhoto);
 const savedFilters=discardProfileDraft(u.filters);delete savedFilters.wizardSelected;
 await change(id,{profile:draft,filters:savedFilters,state:"",photos,photo:photos[0]||u.photo||null});
 const fresh=(await sql("SELECT * FROM mm_users WHERE id=$1",id))[0];
 const gaps=incompleteProfileFields(fresh.profile,fresh.photo);
 if(fresh.photo){await profileBackfill(fresh);await backfill(fresh);}
 if(gaps.length){
  return send(id,"✅ Анкета сохранена, но пока не участвует в подборе.\n\nДля публикации осталось: "+esc(gaps.slice(0,9).join(", ")),buttons([[["✏️ Дополнить анкету","edit_profile"],["📷 Фото","addphoto"]],[["🏠 В меню","home"]]]));
 }
 return send(id,"✅ Анкета готова к подбору и участвует в поиске. Можете настроить фильтры.",buttons([[["🎯 Фильтры","filters"],["👤 Моя анкета","profile"]],[["🏠 В меню","home"]]]));
}
if(a==="photos"){
 const photos=Array.isArray(u.photos)?u.photos:[],rows=[];
 if(!photos.length)return send(id,"В анкете пока нет фото. Загрузите хотя бы одно.",buttons([[["📷 Добавить фото","addphoto"],["🏠 В меню","home"]]]));
 const media=photos.map(file=>({type:"photo",media:file}));
 try{
  if(media.length>1)await call("sendMediaGroup",{chat_id:id,media});
  else await call("sendPhoto",{chat_id:id,photo:photos[0]});
 }catch(err){console.error("Profile media preview",String(err))}
 for(let i=0;i<photos.length;i++){
  const fingerprint=Bun.hash(photos[i]).toString(36);
  const actions=[];
  if(i!==0)actions.push(["⭐ Фото "+(i+1)+" главным","photo_main:"+i+":"+fingerprint]);
  actions.push(["🗑 Убрать "+(i+1),"photo_remove:"+i+":"+fingerprint]);
  rows.push(actions);
 }
 if(photos.length<5)rows.push([["➕ Добавить фото","addphoto"]]);
 rows.push([["👤 К анкете","profile"],["🏠 В меню","home"]]);
 return send(id,"🖼 <b>Ваши фотографии</b>\nВсего: "+photos.length+" из 5.\nПервое фото — главное. Можно выбрать другое или удалить ненужные.",buttons(rows));
}
if(a.startsWith("photo_main:")||a.startsWith("photo_remove:")){
 const parts=a.split(":"),operation=parts[0],index=Number(parts[1]),fingerprint=parts[2];
 const photos=Array.isArray(u.photos)?u.photos:[];
 if(!Number.isInteger(index)||index<0||index>=photos.length||Bun.hash(photos[index]).toString(36)!==fingerprint)
  return send(id,"Список фотографий изменился. Откройте актуальное управление фото.",buttons([[["🖼 Мои фото","photos"]]]));
 if(operation==="photo_remove"){
  const updated=photos.filter((_,i)=>i!==index);
  await change(id,{photos:updated,photo:updated[0]||null});
  return send(id,updated.length?"🗑 Фото удалено из анкеты. Осталось: "+updated.length+".":"Фото удалено. Без главного фото анкета не участвует в подборе.",buttons([[["🖼 Управление фото","photos"],["📷 Добавить","addphoto"]]]));
 }
 const updated=[photos[index],...photos.filter((_,i)=>i!==index)];
 await change(id,{photos:updated,photo:updated[0]});
 return send(id,"⭐ Главное фото изменено.",buttons([[["🖼 Управление фото","photos"],["👤 Моя анкета","profile"]]]));
}
if(a==="addphoto"){await change(id,{state:"photo"});return send(id,"Отправьте 1–5 фотографий: по одной или альбомом. Первая станет ключевой.",buttons([[["✅ Готово","photo_done"]]]))}if(a==="photo_done"){
 await change(id,{state:""});
 const fresh=(await sql("SELECT * FROM mm_users WHERE id=$1",id))[0];
 if(fresh.photo){await backfill(fresh);await profileBackfill(fresh)}
 return send(id,fresh.photo?"✅ Фото сохранены! Анкета готова к подбору, если все поля заполнены.":"Фото пока не добавлено. Вернуться к загрузке можно в любое время.",buttons([[["👤 Моя анкета","profile"],["🏠 В меню","home"]]]));
}if(a==="new")return send(id,"📢 <b>Как создать заявку?</b>\nМожно ответить на восемь коротких вопросов или заполнить шаблон одним сообщением.",buttons([[["🪄 По шагам","jobwizard:start"]],[["📝 Заполнить шаблон","job_template"]],[["🏠 В меню","home"]]]));
 if(a==="job_template"){
  const filters={...(u.filters||{})};
  const sample=u.filters?.jobWizardDraft||u.filters?.draft;
  const template=sample&&Object.keys(sample).length?Object.entries(sample).map(([k,v])=>k+": "+v).join("\n"):jobTpl();
  await change(id,{state:"job",filters});
  return send(id,"📝 Заполните и отправьте шаблон одним сообщением:\n<code>"+esc(template)+"</code>");
 }
 if(a==="jobwizard:start"){
  const filters=jobWizardFilters(u.filters,{},0);
  await change(id,{state:"job_wizard",filters});
  return jobWizardPrompt({...u,filters});
 }
 if(a==="jobwizard:resume"){
  if(u.state!=="job_wizard")return send(id,"Создайте новую заявку в меню.");
  return jobWizardPrompt(u);
 }
 if(a==="jobwizard:cancel"){
  const filters={...clearJobWizard(u.filters)};delete filters.draft;delete filters.draftToken;
  await change(id,{state:"",filters});
  return send(id,"Черновик заявки удалён. Ничего не опубликовано.",buttons([[["➕ Новая заявка","new"],["🏠 В меню","home"]]]));
 }
 if(a==="jobwizard:back"||a==="jobwizard:skip"){
  if(u.state!=="job_wizard")return send(id,"Мастер заявки уже завершён.");
  const step=Number(u.filters?.jobWizardStep??0),field=jobWizardField(step);
  if(a==="jobwizard:skip"&&field?.required)return send(id,"Этот ответ обязателен.");
  const filters=jobWizardFilters(u.filters,u.filters?.jobWizardDraft||{},a==="jobwizard:back"?Math.max(0,step-1):step+1);
  if(a==="jobwizard:skip"&&field)delete filters.jobWizardDraft[field.key];
  await change(id,{filters});
  const current={...u,filters};
  return jobWizardFinished(filters.jobWizardStep)?finishJobWizard(current):jobWizardPrompt(current);
 }if(a==="publish"){let p=u.filters?.draft;if(u.state!=="job_confirm"||!p)return send(id,"Сначала проверьте и подтвердите актуальную версию заявки.");let n=await sql("SELECT count(*)::int AS total FROM mm_jobs WHERE owner=$1 AND created_at>=$2",id,weekStartMoscow().toISOString());if(!hasPaidAccess(u)&&n[0].total)return send(id,"Без подписки можно разместить одну новую заявку с понедельника по воскресенье.");n=await sql("SELECT count(*)::int AS total FROM mm_jobs WHERE owner=$1 AND status='active' AND paused=FALSE AND expires_at>NOW()",id);if(n[0].total>=10)return send(id,"Лимит: 10 активных заявок.");const token=u.filters?.draftToken||("legacy:"+id+":"+Bun.hash(JSON.stringify(p)).toString(36));
 const saved=await sql("INSERT INTO mm_jobs(owner,body,expires_at,draft_token) VALUES($1,$2::jsonb,$3,$4) ON CONFLICT DO NOTHING RETURNING *",id,JSON.stringify(p),jobExpiresAt(get(p,"дата съёмки")).toISOString(),token);
 if(!saved.length){
  const already=(await sql("SELECT id FROM mm_jobs WHERE owner=$1 AND draft_token=$2",id,token))[0];
  return send(id,already?"Заявка №"+already.id+" уже опубликована. Вторую копию не создаём.":"Заявка уже обрабатывается. Проверьте «Мои заявки».");
 }
 const row=saved[0],filters={...(u.filters||{})};delete filters.draft;delete filters.draftToken;
 await change(id,{state:"",filters});
 await send(id,"✅ Заявка №"+row.id+" опубликована.");await dispatch(row);return}if(a==="jobs"){
 const hasProfile=eligibleProfile(u.profile,u.photo);
 let js;
 if(hasProfile){
  js=await matchingJobs(u,30);
 }else{
  // Read-only previews: never auto-send or expose the external source contact.
  const recent=await sql("SELECT * FROM mm_jobs WHERE status='active' AND paused=FALSE AND expires_at>NOW() AND created_at>NOW()-INTERVAL '14 days' AND owner<>$1 ORDER BY created_at DESC LIMIT 40",id);
  js=recent.filter(job=>!isExplicitAdultCasting([get(job.body,"описание"),get(job.body,"требования"),get(job.body,"тип работы")].join(" "))).slice(0,5);
 }
 if(!js.length)return send(id,hasProfile?"Подходящих заявок по выбранным фильтрам пока нет.":"Пока нет открытых заявок для предпросмотра. Можно создать свою тестовую заявку.",buttons([[["🎯 Фильтры","filters"],["➕ Создать заявку","new"]],[["🏠 В меню","home"]]]));
 if(!hasProfile)await send(id,"🔎 <b>Предпросмотр открытых заявок</b>\nМожно посмотреть условия без фото и анкеты. Чтобы откликнуться, сначала создайте профиль и добавьте главное фото.");
 for(const j of js)await card(id,j);
 if(hasProfile&&js.length<=3)await send(id,"По вашим настройкам сейчас "+js.length+" подходящих заявок.");
 return;
}if(a==="mine"){let js=await sql("SELECT * FROM mm_jobs WHERE owner=$1 ORDER BY id DESC LIMIT 20",id);if(!js.length)return send(id,"Ваших заявок пока нет.");for(let j of js)await send(id,"№"+j.id+" — "+esc(get(j.body,"название заявки"))+" ("+(j.paused?"поиск остановлен":esc(j.status))+")",buttons([[[j.paused?"▶️ Восстановить":"⏸️ Остановить","jobpause:"+j.id],["✏️ Изменить","jobedit:"+j.id],["Закрыть","close:"+j.id]]]));return}if(a.startsWith("jobedit:")){
 const jobId=Number(a.slice("jobedit:".length));
 const job=(await sql("SELECT * FROM mm_jobs WHERE id=$1 AND owner=$2 AND status='active'",jobId,id))[0];
 if(!job)return send(id,"Эту заявку больше нельзя изменять.");
 const template=Object.entries(job.body||{}).map(([k,v])=>k+": "+v).join("\n");
 await change(id,{state:"job_edit",filters:{...(u.filters||{}),draftJobId:jobId}});
 return send(id,"Отредактируйте поля заявки №"+jobId+" и отправьте весь шаблон одним сообщением:\n<code>"+esc(template)+"</code>\n\nРедактирование не расходует лимит новых заявок.");
}
if(a.startsWith("updatejob:")){
 const jobId=Number(a.slice("updatejob:".length));
 if(u.state!=="job_edit_confirm"||Number(u.filters?.draftJobId)!==jobId)return send(id,"Этот черновик больше неактуален.");
 const draft=u.filters?.draft,errors=validJob(draft||{});
 if(errors.length)return send(id,"Заявка содержит ошибки: "+esc(errors.join("; ")));
 const jobs=await sql("UPDATE mm_jobs SET body=$1::jsonb,expires_at=$2 WHERE id=$3 AND owner=$4 AND status='active' RETURNING *",JSON.stringify(draft),jobExpiresAt(get(draft,"дата съёмки")).toISOString(),jobId,id);
 if(!jobs.length)return send(id,"Заявка была закрыта или удалена.");
 const filters={...(u.filters||{})};delete filters.draft;delete filters.draftJobId;
 await change(id,{state:"",filters});
 if(!jobs[0].paused){
  await sql("DELETE FROM mm_profile_deliveries WHERE job_id=$1",jobId);
  await dispatch(jobs[0]);
 }
 return send(id,"✅ Заявка №"+jobId+" обновлена. Новая версия доступна в поиске.");
}
if(a.startsWith("jobpause:")){const rows=await sql("UPDATE mm_jobs SET paused=NOT paused WHERE id=$1 AND owner=$2 AND status='active' RETURNING *",Number(a.slice(9)),id);
 if(rows.length&&!rows[0].paused)await dispatch(rows[0]);
 return send(id,rows.length?(rows[0].paused?"Поиск анкет по этой заявке остановлен.":"Поиск анкет по этой заявке возобновлён."):"Заявка недоступна.")}if(a.startsWith("close:")){await sql("UPDATE mm_jobs SET status='closed' WHERE id=$1 AND owner=$2",+a.slice(6),id);return send(id,"Заявка закрыта.")}if(a==="home"){
 if(u.state==="relay"){const filters={...(u.filters||{})};delete filters.relayPeer;await change(id,{state:"",filters});return begin({...u,state:"",filters});}
 return begin(u);
}
 if(a.startsWith("browse_role:")){
  const key=a.slice("browse_role:".length);
  const role=key==="all"?"":ROLES[Number(key)];
  if(role===undefined)return;
  const chosen=[...(u.filters?.profileRoles|| (u.filters?.profileRole?[u.filters.profileRole]:[]))];
  const next=key==="all"?[]:chosen.includes(role)?chosen.filter(x=>x!==role):[...chosen,role];
  const filters={...(u.filters||{}),profileRoles:next,profileRole:""};
  await change(id,{filters});return chooseBrowseRole({...u,filters});
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
if(a==="editfilters"){await change(id,{state:"filter"});return send(id,"Отправьте фильтры отдельным сообщением:\n<code>Город: Москва\nТип работы: реклама\nФормат: коммерция</code>\nЕсли строку оставить пустой, ограничение по ней отключится.")}if(a==="pause"){await change(id,{active:!u.active});if(!u.active)await backfill({...u,active:true});return send(id,u.active?"Поиск приостановлен. Анкета скрыта.":"Поиск возобновлён.")}if(a.startsWith("replyack:")){
 const jobId=Number(a.slice("replyack:".length));
 if(!Number.isSafeInteger(jobId)||jobId<=0)return send(id,"Номер заявки не найден.");
 await sql("UPDATE mm_users SET first_reply_ack_at=COALESCE(first_reply_ack_at,NOW()) WHERE id=$1",id);
 u={...u,first_reply_ack_at:new Date()};
 a="reply:"+jobId;
}
 if(a.startsWith("reply:")){
 const jobId=Number(a.slice(6));
 if(!Number.isSafeInteger(jobId)||jobId<=0)return send(id,"Некорректный номер заявки.");
 const job=(await sql("SELECT * FROM mm_jobs WHERE id=$1 AND status='active' AND paused=FALSE AND expires_at>NOW()",jobId))[0];
 if(!job)return send(id,"Поиск по заявке остановлен или заявка устарела.");
 if(!eligibleProfile(u.profile,u.photo))return send(id,"Для отклика заполните обязательные поля анкеты и добавьте главное фото.");
 if(!u.first_reply_ack_at)return send(id,"🛡 <b>Перед первым откликом</b>\n«Мир моделей» помогает найти исполнителей и съёмки, но не организует сделки, не проверяет условия и не участвует в расчётах. Сервис не гарантирует достоверность сведений об участниках: решение встретиться, передать деньги или материалы принимаете вы.\n\nПеред съёмкой уточните условия, не отправляйте незнакомым предоплату и прочитайте памятку о безопасности. О подозрительных предложениях сообщайте в поддержку.",buttons([[["✅ Понятно, продолжить","replyack:"+jobId]],[["📚 Памятка","articles"],["❌ Отмена","home"]]]));
 if(job.owner===id)return send(id,"Нельзя откликнуться на собственную заявку.");
 const duplicate=await sql("SELECT id FROM mm_responses WHERE job_id=$1 AND user_id=$2",jobId,id);
 if(duplicate.length)return send(id,"Вы уже откликались на эту заявку.");
 const n=await sql("SELECT COUNT(*)::int n FROM mm_responses WHERE user_id=$1 AND created_at>=$2",id,weekStartMoscow().toISOString());
 if(!hasPaidAccess(u)&&n[0].n>0)return send(id,"Бесплатный лимит — один отклик с понедельника по воскресенье.");
 await change(id,{state:"reply_compose",filters:{...(u.filters||{}),replyJobId:jobId}});
 return send(id,"✉️ <b>Отклик на заявку №"+jobId+"</b>\nНапишите своё сообщение заказчику одним текстом: уточните интересующие детали или укажите кодовое слово из заявки.\n\nТекст будет отправлен заказчику, а сам отклик засчитается только после отправки. Для отмены — /cancel.");
}
if(a.startsWith("invite:")){
 const target=Number(a.slice(7));
 if(!Number.isSafeInteger(target)||target<=0||target===id)return send(id,"Некорректный получатель приглашения.");
 const hashes=await currentDocumentHashes();
 if(!publicProfileAllowed(u,hashes,allConsentsCurrent,eligibleProfile))return send(id,"Чтобы отправлять приглашения, сначала завершите анкету и добавьте главное фото.");
 const p=(await sql("SELECT * FROM mm_users WHERE id=$1",target))[0];
 if(!publicProfileAllowed(p,hashes,allConsentsCurrent,eligibleProfile))return send(id,"Этот участник сейчас недоступен для приглашений.");
 const duplicate=(await sql("SELECT id FROM mm_invitations WHERE from_user=$1 AND to_user=$2 AND status IN ('sent','accepted') ORDER BY id DESC LIMIT 1",id,target))[0];
 if(duplicate)return send(id,"Вы уже отправляли приглашение этому участнику.");
 const count=await sql("SELECT COUNT(*)::int n FROM mm_invitations WHERE from_user=$1 AND created_at>=$2",id,weekStartMoscow().toISOString());
 if(!hasPaidAccess(u)&&count[0].n>=1)return send(id,"Без подписки доступно одно приглашение с понедельника по воскресенье.");
 const invited=(await sql("INSERT INTO mm_invitations(from_user,to_user) VALUES($1,$2) RETURNING id",id,target))[0];
 try{
  const notification=await send(p.id,"👋 Вам пришло приглашение на сотрудничество.");
  if(!notification?.ok)throw Error("Telegram could not deliver invitation");
  await profile(p.id,u,"Анкета приглашающего участника");
  const controls=await send(p.id,"Вы можете принять приглашение или отказаться. До принятия контакты обеих сторон скрыты.",buttons([[["✅ Принять","acceptinvite:"+invited.id],["❌ Отклонить","rejectinvite:"+invited.id]]]));
  if(!controls?.ok)throw Error("Telegram could not deliver invitation controls");
 }catch(err){
  await sql("DELETE FROM mm_invitations WHERE id=$1 AND status='sent'",invited.id);
  console.error("Invitation delivery failed",String(err));
  return send(id,"Не получилось доставить приглашение. Попробуйте позже.");
 }
 await send(id,"✅ Приглашение отправлено. Контакты откроются обеим сторонам после принятия.");
 await safetyOnce(p);
 return;
}
if(a.startsWith("rejectinvite:")){
 const invitationId=Number(a.slice("rejectinvite:".length));
 const rows=await sql("UPDATE mm_invitations SET status='declined' WHERE id=$1 AND to_user=$2 AND status='sent' RETURNING from_user",invitationId,id);
 if(!rows.length)return send(id,"Приглашение уже обработано.");
 await send(id,"Приглашение отклонено. Контакты не раскрывались.");
 await send(rows[0].from_user,"Приглашение было отклонено.");
 return;
}
if(a.startsWith("acceptinvite:")){
 const rows=await sql("UPDATE mm_invitations SET status='accepted' WHERE id=$1 AND to_user=$2 AND status='sent' RETURNING *",Number(a.slice(13)),id);
 if(!rows.length)return send(id,"Приглашение уже обработано.");
 const sender=(await sql("SELECT username,blocked,suspended FROM mm_users WHERE id=$1",rows[0].from_user))[0];
 if(!sender||sender.blocked||sender.suspended){
  await sql("UPDATE mm_invitations SET status='declined' WHERE id=$1",rows[0].id);
  return send(id,"Отправитель больше недоступен.");
 }
 await scheduleFeedback(sql,"invite",rows[0].id,rows[0].from_user,rows[0].to_user);
 const peerButtons=[{text:"💬 Написать через бота",callback_data:"relay:"+rows[0].to_user}];
 if(u.username)peerButtons.unshift({text:"✉️ Открыть Telegram",url:"https://t.me/"+u.username});
 await send(rows[0].from_user,"✅ Ваше приглашение принято! Можно обсудить детали напрямую или через бота.",{inline_keyboard:[peerButtons]});
 const senderButtons=[{text:"💬 Написать через бота",callback_data:"relay:"+rows[0].from_user}];
 if(sender.username)senderButtons.unshift({text:"✉️ Открыть Telegram",url:"https://t.me/"+sender.username});
 return send(id,"✅ Приглашение принято. Теперь можно связаться с партнёром.",{inline_keyboard:[senderButtons]});
}
if(a.startsWith("acceptresponse:")){
 const rId=Number(a.slice("acceptresponse:".length));
 const rows=await sql("UPDATE mm_responses r SET status='accepted',accepted_at=NOW() FROM mm_jobs j WHERE r.id=$1 AND r.job_id=j.id AND j.owner=$2 AND r.status='pending' RETURNING r.*",rId,id);
 if(!rows.length)return send(id,"Отклик уже обработан.");
 const j=(await sql("SELECT body FROM mm_jobs WHERE id=$1",rows[0].job_id))[0];
 await scheduleFeedback(sql,"response",rows[0].id,id,rows[0].user_id,get(j.body,"дата съёмки"));
 const applicant=(await sql("SELECT username FROM mm_users WHERE id=$1",rows[0].user_id))[0];
 const client=(await sql("SELECT username FROM mm_users WHERE id=$1",id))[0];
 const applicantButtons=[{text:"💬 Через бота",callback_data:"relay:"+rows[0].user_id}];
 if(applicant?.username)applicantButtons.unshift({text:"✉️ В Telegram",url:"https://t.me/"+applicant.username});
 await send(id,"✅ Отклик принят. Вы можете связаться с участником:",{inline_keyboard:[applicantButtons]});
 const clientButtons=[{text:"💬 Через бота",callback_data:"relay:"+id}];
 if(client?.username)clientButtons.unshift({text:"✉️ В Telegram",url:"https://t.me/"+client.username});
 await send(rows[0].user_id,"✅ Ваш отклик принят! Теперь можно обсудить детали.",{inline_keyboard:[clientButtons]});
 return;
}
if(a.startsWith("declineresponse:")){
 const rId=Number(a.slice("declineresponse:".length));
 const rows=await sql("UPDATE mm_responses r SET status='declined' FROM mm_jobs j WHERE r.id=$1 AND r.job_id=j.id AND j.owner=$2 AND r.status='pending' RETURNING r.id,r.user_id",rId,id);
 if(!rows.length)return send(id,"Отклик уже обработан.");
 try{await send(rows[0].user_id,"К сожалению, ваш отклик №"+rId+" отклонён. Другие заявки можно найти в главном меню.")}catch(e){console.error("Declined response notification",String(e))}
 return send(id,"Отклик отклонён, участнику отправлено уведомление.");
}
if(a.startsWith("reportjob:")||a.startsWith("reportuser:")||a==="report"||a==="support"){const f={...(u.filters||{})};f.reportTarget=a.startsWith("reportjob:")?{job:Number(a.slice(10))}:a.startsWith("reportuser:")?{user:Number(a.slice(11))}:{};await change(id,{state:"support",filters:f});return send(id,"Опишите причину своими словами. Можно приложить скриншот.")}}

function sourceJobDisplayText(raw){return sourcePublicText(raw).replace(/https?:\/\/\S+|www\.\S+/gi,"[ссылка скрыта]");}
function sourcePublicText(raw){return redactContacts(raw)}
let collectorInboxRunning=false;
async function consumeCollectorInbox(){
 if(collectorInboxRunning)return;
 collectorInboxRunning=true;
 try{
  await ensure();
  const messages=await sql("SELECT * FROM mm_collector_inbox WHERE processed_at IS NULL AND next_attempt_at<=NOW() ORDER BY received_at LIMIT 10");
  for(const msg of messages){
   try{
    await onSourcePost({chat:{id:msg.source_id,type:"channel"},message_id:msg.telegram_message_id,text:msg.body});
    await sql("UPDATE mm_collector_inbox SET processed_at=NOW() WHERE source_id=$1 AND telegram_message_id=$2",msg.source_id,msg.telegram_message_id);
   }catch(e){
    console.error("collector inbox error",String(e));
    await sql("UPDATE mm_collector_inbox SET attempts=attempts+1,next_attempt_at=NOW()+INTERVAL '60 seconds' WHERE source_id=$1 AND telegram_message_id=$2",msg.source_id,msg.telegram_message_id);
   }
  }
 }finally{collectorInboxRunning=false}
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
 await sql("UPDATE mm_sources SET last_seen_at=NOW() WHERE id=$1",sourceId);
 // AI is optional and budgeted: don't send ordinary unrelated chat traffic.
 let parsed=parseSourcePost(raw,{city:settings.city,topic:settings.topic});
 if(!parsed && decision.status!=="reject" && /модел|акт[её]р|кастинг|массовк|съемк|съёмк|фотограф|видеограф|визажист/i.test(raw) && extractContact(raw) && Bun.env.OPENROUTER_API_KEY && Bun.env.OPENROUTER_MODEL && await allowanceForModel(sql,sourceId)){
  parsed=await parseWithModel(raw,{city:settings.city,topic:settings.topic});
 }
 const extractedDecision=parsed?moderate(Object.entries(parsed).map(([k,v])=>k==="описание"?sourcePublicText(v):v).join(" ")):{status:"accept"};
 let state=decision.status==="reject"||extractedDecision.status==="reject"?"rejected":decision.status==="review"||extractedDecision.status==="review"?"pending":"active";
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
    if(flag)await sql("UPDATE mm_jobs SET paused=TRUE WHERE owner=$1 AND status='active'",Number(m[2]));
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
});if(dashboard)return dashboard;let u=new URL(r.url);if(u.pathname==="/health"){try{await ensure();return Response.json({ok:true,registration:Bun.env.REGISTRATION_ENABLED==="true"&&await legalReady(sql),test_mode:testMode(),legal_documents_approved:await legalDocumentsReady(sql),schema:"ready"})}catch(e){return new Response("Database unavailable",{status:503})}}if(u.pathname==="/webhook"&&r.method==="POST"){if(!secret||r.headers.get("x-telegram-bot-api-secret-token")!==secret)return new Response("Forbidden",{status:403});try{await ensure();let x=await r.json();let ok=await sql("INSERT INTO mm_updates(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id",x.update_id);if(ok.length){
  try {
    if(x.message?.from||x.message?.chat?.type!=="private")if(x.message)await onMessage(x.message);
    if(x.channel_post)await onSourcePost(x.channel_post);
    if(x.callback_query?.from)await onCallback(x.callback_query);
  }catch(e){await sql("DELETE FROM mm_updates WHERE id=$1",x.update_id);throw e}
 }
 return new Response("ok")}catch(e){console.error("Update error",e);return new Response("error",{status:500})}}return new Response("World Models Bot")}})
setInterval(()=>ensure().then(()=>feedbackTick(sql,send)).catch(e=>console.error("feedback job",String(e))),60*60*1000);
setInterval(()=>runFanoutBatch().catch(e=>console.error("fanout tick",String(e))),5000);
setInterval(()=>processResponseOutbox().catch(e=>console.error("response outbox tick",String(e))),5000);
setInterval(()=>consumeCollectorInbox().catch(e=>console.error("collector inbox",String(e))),5000);
setInterval(()=>ensure().then(()=>reviewSourceHealth(sql)).catch(e=>console.error("source health",String(e))),24*60*60*1000);
setInterval(()=>ensure().then(async()=>{
 await sql("DELETE FROM mm_updates WHERE created_at<NOW()-INTERVAL '30 days'");
 await sql("DELETE FROM mm_relay_usage WHERE hour_bucket<NOW()-INTERVAL '72 hours'");
 await sql("DELETE FROM mm_fanout_queue WHERE pending=FALSE AND completed_at<NOW()-INTERVAL '90 days'");
 }).catch(e=>console.error("maintenance",String(e))),24*60*60*1000);
setTimeout(()=>runFanoutBatch().catch(e=>console.error("fanout startup",String(e))),4000);
if(token&&secret&&Bun.env.PUBLIC_URL)(async()=>{
 const me=await call("getMe",{});
 if(!me.ok){console.error("Telegram token failed getMe validation");return}
 const actual=String(me.result?.username||"").toLowerCase(),expected=String(Bun.env.BOT_USERNAME||"").replace(/^@/,"").toLowerCase();
 console.log("Connected Telegram bot: @"+actual);
 if(expected&&expected!==actual){console.error("BOT_USERNAME does not match the configured token; check Railway settings.");return}
 const result=await call("setWebhook",{url:Bun.env.PUBLIC_URL.replace(/\/$/,"")+"/webhook",secret_token:secret,allowed_updates:["message","channel_post","callback_query"]});
 console.log("Webhook configured",!!result.ok);
 const commands=[
  {command:"start",description:"Открыть главное меню"},
  {command:"help",description:"Как пользоваться ботом"},
  {command:"demo",description:"Показать демо"},
  {command:"cancel",description:"Отменить действие"},
  {command:"mydata",description:"Экспортировать мои данные"},
  {command:"deleteaccount",description:"Удалить мой аккаунт"}
 ];
 const installed=await call("setMyCommands",{commands});
 console.log("Telegram command menu configured",!!installed.ok);
})().catch(e=>console.error("Telegram setup",String(e)));
