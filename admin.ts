import {publishDocument} from "./documents.ts";
// Minimal secured operational dashboard. Disabled until both ADMIN_PASSWORD and ADMIN_TOTP_SECRET are configured.
// Session tokens are only kept in memory; no user data is exposed to unauthenticated requests.
const sessions = new Map();
const attempts = new Map();
const json = (data,status=200,headers={}) => new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...headers}});
function equal(a,b){
  const aa=new TextEncoder().encode(String(a)), bb=new TextEncoder().encode(String(b));
  let diff=aa.length^bb.length;
  for(let i=0;i<Math.max(aa.length,bb.length);i++)diff|=(aa[i]||0)^(bb[i]||0);
  return diff===0;
}
function decodeBase32(input){
 const chars="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
 let acc=0,bits=0,result=[];
 for(const c of String(input||"").toUpperCase().replace(/[\s=-]/g,"")){
  const n=chars.indexOf(c);if(n<0)return null;
  acc=(acc<<5)|n;bits+=5;
  if(bits>=8){bits-=8;result.push((acc>>bits)&255)}
 }
 return result.length?new Uint8Array(result):null;
}
async function totp(secret,step){
 const bytes=decodeBase32(secret);if(!bytes)return null;
 const key=await crypto.subtle.importKey("raw",bytes,{name:"HMAC",hash:"SHA-1"},false,["sign"]);
 const counter=BigInt(step), input=new Uint8Array(8);
 for(let i=7;i>=0;i--)input[i]=Number((counter>>BigInt((7-i)*8))&255n);
 const hash=new Uint8Array(await crypto.subtle.sign("HMAC",key,input));
 const idx=hash[hash.length-1]&15;
 const n=(((hash[idx]&127)<<24)|(hash[idx+1]<<16)|(hash[idx+2]<<8)|hash[idx+3])%1000000;
 return String(n).padStart(6,"0");
}
async function otpValid(secret,code){
 if(!/^\d{6}$/.test(String(code||"")))return false;
 const step=Math.floor(Date.now()/30000);
 for(let delta=-1;delta<=1;delta++)if(equal(await totp(secret,step+delta),code))return true;
 return false;
}
function sessionFrom(req){
 const found=(req.headers.get("cookie")||"").match(/(?:^|;\s*)mm_admin=([a-f0-9]{64})(?:;|$)/);
 if(!found)return null;
 const session=sessions.get(found[1]);
 if(!session||session.expires<Date.now()){sessions.delete(found[1]);return null}
 return session;
}
const appHtml = [
 '<!doctype html><html lang="ru"><head><meta charset="utf-8">',
 '<meta name="viewport" content="width=device-width, initial-scale=1">',
 '<title>Мир моделей — управление</title>',
 '<style>body{font-family:system-ui;background:#0e1523;color:#eef3ff;margin:0;padding:32px}main{max-width:1100px;margin:auto}header{display:flex;justify-content:space-between;align-items:center}h1{margin:0 0 12px}p{color:#a8b5ce}.panel{background:#192436;border:1px solid #304057;border-radius:14px;padding:22px;margin:16px 0}input,button,select,textarea{background:#25344c;border:1px solid #526680;color:#fff;border-radius:8px;padding:11px;margin:5px;font:inherit}button{cursor:pointer}button:hover{background:#375072}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.6 monospace}code{color:#8abaff}.small{font-size:13px;color:#a8b5ce}#msg{color:#ffd292}</style>',
 '</head><body><main><header><h1>🎬 Мир моделей</h1><span class="small">Панель управления</span></header>',
 '<p>Модерация · пользователи · заявки · источники · обращения</p>',
 '<section class="panel" id="login"><h2>Вход</h2><form id="form"><input name="password" placeholder="Пароль" type="password" required><input name="otp" placeholder="Код 2FA" inputmode="numeric" maxlength="6" required><button>Войти</button></form></section>',
 '<section id="dashboard" style="display:none"><div class="panel"><button data-op="refresh">Обновить</button><button data-op="logout">Выйти</button><p id="counters"></p></div>',
 '<div class="panel"><h2>Юридические документы</h2><p>Публикуйте только утверждённые юристом тексты. Новая редакция сохранится отдельно от предыдущей.</p><form id="documentForm"><select name="slug"><option value="offer">Оферта</option><option value="rules">Правила</option><option value="privacy">Политика конфиденциальности</option><option value="processing">Обработка данных</option><option value="distribution">Распространение анкеты</option><option value="esignature">Электронная подпись</option><option value="safety">Безопасность</option><option value="portfolio">Портфолио</option></select><input name="title" placeholder="Название"><textarea name="body" placeholder="Полный текст утверждённого документа" rows="8" required></textarea><button>Опубликовать новую версию</button></form><p><a href="/documents">Открыть документы</a></p></div>',
 '<div class="panel"><h2>Источники Telegram</h2><form id="source"><input name="id" placeholder="-100... ID источника" required><input name="city" placeholder="Город"><input name="topic" placeholder="Тема"><button>Добавить / включить</button></form><pre id="sources"></pre></div>',
 '<div class="panel"><h2>Модерация</h2><form id="decision"><input name="id" placeholder="№ заявки" required><select name="action"><option value="approve">Одобрить</option><option value="reject">Отклонить</option></select><button>Применить</button></form><pre id="pending"></pre></div>',
 '<div class="panel"><h2>Обращения</h2><form id="ticketForm"><input name="id" placeholder="Номер обращения" required><textarea name="message" placeholder="Ответ пользователю от имени бота" rows="3" required></textarea><button>Ответить</button></form><form id="ticketStatus"><input name="id" placeholder="Номер обращения" required><select name="status"><option value="in_progress">В работе</option><option value="closed">Закрыто</option><option value="new">Новое</option></select><button>Изменить статус</button></form><pre id="reports"></pre></div>',
 '<div class="panel"><h2>Пользователи</h2><form id="usersForm"><input name="id" placeholder="Telegram ID" required><select name="action"><option value="block">Заблокировать</option><option value="unblock">Разблокировать</option></select><button>Применить</button></form><pre id="users"></pre></div></section><p id="msg"></p>',
 '<script>',
 'const $=x=>document.getElementById(x);',
 'async function api(path,body){const r=await fetch("/admin/"+path,{method:body?"POST":"GET",headers:{"content-type":"application/json"},body:body?JSON.stringify(body):undefined,credentials:"same-origin"});const d=await r.json();if(!r.ok)throw Error(d.error||"Ошибка");return d}',
 'const view=(id,obj)=>{$(id).textContent=typeof obj==="string"?obj:JSON.stringify(obj,null,2)};',
 'async function refresh(){try{const d=await api("data");$("login").style.display="none";$("dashboard").style.display="block";view("counters",d.stats);view("sources",d.sources);view("pending",d.pending);view("reports",d.reports);view("users",d.users);$("msg").textContent=""}catch(e){$("dashboard").style.display="none";$("login").style.display="block";$("msg").textContent=e.message}}',
 '$("form").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{await api("login",{password:f.get("password"),otp:f.get("otp")});e.target.reset();refresh()}catch(err){$("msg").textContent=err.message}};',
 '$("documentForm").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);if(!confirm("Вы уверены, что документ юридически утверждён?"))return;try{const result=await api("action",{action:"document_publish",slug:f.get("slug"),title:f.get("title"),body:f.get("body")});$("msg").textContent="Опубликована версия "+result.document.version;refresh()}catch(err){$("msg").textContent=err.message}};',
 '$("source").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{await api("action",{action:"source_add",id:f.get("id"),city:f.get("city"),topic:f.get("topic")});refresh()}catch(err){$("msg").textContent=err.message}};',
 '$("ticketForm").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{await api("action",{action:"ticket_reply",id:f.get("id"),message:f.get("message")});e.target.reset();refresh()}catch(err){$("msg").textContent=err.message}};',
 '$("ticketStatus").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{await api("action",{action:"ticket_status",id:f.get("id"),status:f.get("status")});refresh()}catch(err){$("msg").textContent=err.message}};',
 'for(const formId of ["decision","usersForm"]){$(formId).onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{await api("action",{action:f.get("action"),id:f.get("id")});refresh()}catch(err){$("msg").textContent=err.message}}}',
 'document.querySelector("[data-op=refresh]").onclick=refresh;',
 'document.querySelector("[data-op=logout]").onclick=async()=>{await api("logout",{});refresh()};',
 'refresh();</script></main></body></html>'
].join("");
export async function adminApp(req,sql,onApprove=null,onTicketReply=null){
 const url=new URL(req.url);
 if(!url.pathname.startsWith("/admin"))return null;
 const enabled=!!Bun.env.ADMIN_PASSWORD&&!!Bun.env.ADMIN_TOTP_SECRET;
 if(!enabled)return json({error:"Админка не настроена: нужны ADMIN_PASSWORD и ADMIN_TOTP_SECRET."},503);
 if(url.pathname==="/admin"&&req.method==="GET"){
  return new Response(appHtml,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'","x-content-type-options":"nosniff","x-frame-options":"DENY"}});
 }
 const address=req.headers.get("x-forwarded-for")?.split(",")[0]||"unknown";
 if(url.pathname==="/admin/login"&&req.method==="POST"){
  const previous=attempts.get(address)||{n:0,until:0};
  if(previous.until>Date.now())return json({error:"Слишком много попыток входа."},429);
  let body;try{body=await req.json()}catch{return json({error:"Некорректный запрос"},400)}
  const valid=equal(body?.password,Bun.env.ADMIN_PASSWORD)&&await otpValid(Bun.env.ADMIN_TOTP_SECRET,body?.otp);
  if(!valid){
   previous.n++;previous.until=Date.now()+(previous.n>=5?300000:1500);
   attempts.set(address,previous);return json({error:"Неверные данные."},401);
  }
  attempts.delete(address);
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  const id=Array.from(bytes).map(x=>x.toString(16).padStart(2,"0")).join("");
  sessions.set(id,{expires:Date.now()+12*3600e3});
  return json({ok:true},200,{"set-cookie":"mm_admin="+id+"; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=43200"});
 }
 const session=sessionFrom(req);
 if(!session)return json({error:"Требуется вход."},401);
 if(req.method==="POST"){
  const origin=req.headers.get("origin");
  if(!origin||origin!==url.origin)return json({error:"Запрос отклонён."},403);
 }
 if(url.pathname==="/admin/logout"&&req.method==="POST"){
  const id=req.headers.get("cookie")?.match(/mm_admin=([a-f0-9]{64})/)?.[1];
  if(id)sessions.delete(id);
  return json({ok:true},200,{"set-cookie":"mm_admin=; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0"});
 }
 if(url.pathname==="/admin/data"&&req.method==="GET"){
  const [[stats],sources,pending,reports,users]=await Promise.all([
    sql("SELECT (SELECT count(*) FROM mm_users)::int users,(SELECT count(*) FROM mm_jobs)::int jobs,(SELECT count(*) FROM mm_jobs WHERE source_id IS NOT NULL)::int imported,(SELECT count(*) FROM mm_responses)::int responses,(SELECT count(*) FROM mm_sources WHERE active)::int active_sources,(SELECT count(*) FROM mm_jobs WHERE status='pending')::int pending"),
    sql("SELECT id,title,city,topic,active,created_at FROM mm_sources ORDER BY created_at DESC LIMIT 100"),
    sql("SELECT id,body,source_id,created_at FROM mm_jobs WHERE status='pending' ORDER BY id LIMIT 30"),
    sql("SELECT id,reporter,target_user,target_job,kind,status,body,created_at,updated_at FROM mm_reports_v2 ORDER BY id DESC LIMIT 40"),
    sql("SELECT id,username,first_name,active,blocked,suspended,created_at FROM mm_users ORDER BY created_at DESC LIMIT 40")
  ]);
  return json({stats,sources,pending,reports,users});
 }
 if(url.pathname==="/admin/action"&&req.method==="POST"){
  let data;try{data=await req.json()}catch{return json({error:"Некорректный запрос"},400)}
  const action=String(data?.action||"");
  if(action==="document_publish"){
    try {
      const document=await publishDocument(sql,String(data.slug||""),String(data.title||""),String(data.body||""));
      await sql("INSERT INTO mm_admin_log(actor,action,details) VALUES(0,'document_publish',$1::jsonb)",JSON.stringify({slug:document.slug,version:document.version}));
      return json({ok:true,document});
    }catch(err){return json({error:String(err.message||err)},400)}
  }
  const id=Number(data?.id);
  if(!Number.isSafeInteger(id))return json({error:"Некорректный ID"},400);
  if(action==="ticket_reply"){
    const message=String(data.message||"").trim();
    if(!onTicketReply)return json({error:"Отправка ответов не настроена"},503);
    if(!message||message.length>3000)return json({error:"Введите текст до 3000 символов"},400);
    try{await onTicketReply(id,message);return json({ok:true})}
    catch(err){return json({error:String(err.message||err)},502)}
  }
  if(action==="ticket_status"){
    const status=String(data.status||"");
    if(!["new","in_progress","closed"].includes(status))return json({error:"Некорректный статус"},400);
    const updated=await sql("UPDATE mm_reports_v2 SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING id",status,id);
    if(!updated.length)return json({error:"Обращение не найдено"},404);
    await sql("INSERT INTO mm_admin_log(actor,action,details) VALUES(0,'ticket_status',$1::jsonb)",JSON.stringify({id,status}));
    return json({ok:true});
  }
  if(action==="source_add")await sql("INSERT INTO mm_sources(id,city,topic,active) VALUES($1,$2,$3,TRUE) ON CONFLICT(id) DO UPDATE SET city=EXCLUDED.city,topic=EXCLUDED.topic,active=TRUE",id,String(data.city||"").slice(0,90),String(data.topic||"").slice(0,90));
  else if(action==="source_off")await sql("UPDATE mm_sources SET active=FALSE WHERE id=$1",id);
  else if(action==="approve"){const jobs=await sql("UPDATE mm_jobs SET status='active' WHERE id=$1 AND status='pending' RETURNING *",id);if(jobs.length&&onApprove)await onApprove(jobs[0])}
  else if(action==="reject")await sql("UPDATE mm_jobs SET status='rejected' WHERE id=$1 AND status='pending'",id);
  else if(action==="block"){await sql("UPDATE mm_users SET blocked=TRUE WHERE id=$1",id);await sql("UPDATE mm_jobs SET paused=TRUE WHERE owner=$1 AND status='active'",id);}
  else if(action==="unblock")await sql("UPDATE mm_users SET blocked=FALSE,suspended=FALSE WHERE id=$1",id);
  else return json({error:"Неизвестное действие"},400);
  await sql("INSERT INTO mm_admin_log(actor,action,details) VALUES(0,$1,$2::jsonb)",action,JSON.stringify({target:id}));
  return json({ok:true});
 }
 return json({error:"Not found"},404);
}
