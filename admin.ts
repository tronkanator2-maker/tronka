import {publishDocument,legalReady,latestDocuments} from "./documents.ts";
import {inferCity} from "./engine.ts";
import {adminHtml} from "./admin-ui.ts";
import {ADMIN_SECTIONS,readAdminList,readFinanceSummary,canAdminAct} from "./admin-data.ts";
// Minimal secured operational dashboard. Disabled until ADMIN_PASSWORD is configured.
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
function sessionFrom(req){
 const found=(req.headers.get("cookie")||"").match(/(?:^|;\s*)mm_admin=([a-f0-9]{64})(?:;|$)/);
 if(!found)return null;
 const session=sessions.get(found[1]);
 if(!session||session.expires<Date.now()){sessions.delete(found[1]);return null}
 return session;
}
export async function adminApp(req,sql,onApprove=null,onTicketReply=null){
 const url=new URL(req.url);
 if(!url.pathname.startsWith("/admin"))return null;
 const enabled=!!Bun.env.ADMIN_PASSWORD;
 if(!enabled)return json({error:"Админка не настроена: задайте ADMIN_PASSWORD."},503);
 if(url.pathname==="/admin"&&req.method==="GET"){
  return new Response(adminHtml,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'","x-content-type-options":"nosniff","x-frame-options":"DENY"}});
 }
 const address=req.headers.get("x-forwarded-for")?.split(",")[0]||"unknown";
 if(url.pathname==="/admin/login"&&req.method==="POST"){
  const previous=attempts.get(address)||{n:0,until:0};
  if(previous.until>Date.now())return json({error:"Слишком много попыток входа."},429);
  let body;try{body=await req.json()}catch{return json({error:"Некорректный запрос"},400)}
  const owner=equal(body?.password,Bun.env.ADMIN_PASSWORD);
  // Moderator role is optional and requires a separate configured credential.
  const moderator=!owner && !!Bun.env.ADMIN_MODERATOR_PASSWORD && Bun.env.ADMIN_MODERATOR_PASSWORD.length>=16 &&
     !equal(Bun.env.ADMIN_MODERATOR_PASSWORD,Bun.env.ADMIN_PASSWORD) && equal(body?.password,Bun.env.ADMIN_MODERATOR_PASSWORD);
  if(!owner&&!moderator){
   previous.n++;previous.until=Date.now()+(previous.n>=5?300000:1500);
   attempts.set(address,previous);return json({error:"Неверные данные."},401);
  }
  attempts.delete(address);
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  const id=Array.from(bytes).map(x=>x.toString(16).padStart(2,"0")).join("");
  sessions.set(id,{expires:Date.now()+12*3600e3,role:owner?"owner":"moderator"});
  return json({ok:true,role:owner?"owner":"moderator"},200,{"set-cookie":"mm_admin="+id+"; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=43200"});
 }
 const session=sessionFrom(req);
 if(!session)return json({error:"Требуется вход."},401);
 if(req.method==="POST"){
  const origin=req.headers.get("origin");
  let expectedOrigin=url.origin,actualOrigin;
  try{
   if(Bun.env.PUBLIC_URL)expectedOrigin=new URL(Bun.env.PUBLIC_URL).origin;
   if(origin)actualOrigin=new URL(origin).origin;
  }catch{return json({error:"Запрос отклонён."},403)}
  if(!origin||actualOrigin!==expectedOrigin)return json({error:"Запрос отклонён."},403);
 }
 if(url.pathname==="/admin/logout"&&req.method==="POST"){
  const id=req.headers.get("cookie")?.match(/mm_admin=([a-f0-9]{64})/)?.[1];
  if(id)sessions.delete(id);
  return json({ok:true},200,{"set-cookie":"mm_admin=; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0"});
 }
 if(url.pathname==="/admin/data"&&req.method==="GET"){
  const section=String(url.searchParams.get("section")||"summary");
  if(section==="finance"){
   if(session.role!=="owner")return json({error:"Только владелец может просматривать финансы"},403);
   return json({role:session.role,finance:await readFinanceSummary(sql)});
  }
  if(ADMIN_SECTIONS[section]){
   if(section==="audit"&&session.role!=="owner")return json({error:"Только владелец может просматривать журнал действий"},403);
   const rawPage=Number(url.searchParams.get("page")||1);
   const page=Number.isSafeInteger(rawPage)?Math.max(1,Math.min(10000,rawPage)):1;
   const search=String(url.searchParams.get("q")||"").trim().slice(0,80);
   return json({role:session.role,...await readAdminList(sql,section,page,search)});
  }
  if(section!=="summary")return json({error:"Раздел не найден"},404);
  const [records,documents]=await Promise.all([
   sql("SELECT (SELECT COUNT(*) FROM mm_users)::int users,(SELECT COUNT(*) FROM mm_jobs)::int jobs,(SELECT COUNT(*) FROM mm_jobs WHERE source_id IS NOT NULL)::int imported,(SELECT COUNT(*) FROM mm_responses)::int responses,(SELECT COUNT(*) FROM mm_sources WHERE active)::int active_sources,(SELECT COUNT(*) FROM mm_jobs WHERE status='pending')::int pending,(SELECT COUNT(*) FROM mm_response_outbox WHERE completed_at IS NULL)::int queued_responses,(SELECT COUNT(*) FROM mm_response_outbox WHERE completed_at IS NULL AND attempts>=3)::int struggling_responses,(SELECT COUNT(*) FROM mm_fanout_queue WHERE pending=TRUE)::int queued_job_broadcasts,(SELECT COUNT(*) FROM mm_collector_inbox WHERE processed_at IS NULL)::int unprocessed_source_posts,(SELECT COUNT(*) FROM mm_reports_v2 WHERE status='new')::int new_support_tickets,(SELECT MAX(created_at) FROM mm_updates) AS latest_webhook_at"),
   latestDocuments(sql)
  ]);
  return json({role:session.role,stats:{...(records[0]||{}),registration_enabled:Bun.env.REGISTRATION_ENABLED==="true",required_documents_ready:await legalReady(sql),published_documents:documents.length,collector_credentials_available:!!Bun.env.TG_STRING_SESSION}});
 }
 if(url.pathname==="/admin/action"&&req.method==="POST"){
  let data;try{data=await req.json()}catch{return json({error:"Некорректный запрос"},400)}
  const action=String(data?.action||"");
  if(!canAdminAct(session.role,action))return json({error:"Недостаточно прав для этого действия"},403);
  if(action==="document_publish"){
    try {
      const document=await publishDocument(sql,String(data.slug||""),String(data.title||""),String(data.body||""));
      await sql("INSERT INTO mm_admin_log(actor,action,details) VALUES(0,'document_publish',$1::jsonb)",JSON.stringify({slug:document.slug,version:document.version,role:session.role}));
      return json({ok:true,document});
    }catch(err){return json({error:String(err.message||err)},400)}
  }
  const id=Number(data?.id);
  if(!Number.isSafeInteger(id))return json({error:"Некорректный ID"},400);
  if(action==="ticket_reply"){
    const message=String(data.message||"").trim();
    if(!onTicketReply)return json({error:"Отправка ответов не настроена"},503);
    if(!message||message.length>3000)return json({error:"Введите текст до 3000 символов"},400);
    try{await onTicketReply(id,message);
      await sql("INSERT INTO mm_admin_log(actor,action,details) VALUES(0,'ticket_reply',$1::jsonb)",JSON.stringify({ticket:id,role:session.role}));
      return json({ok:true,message:"Ответ на обращение №"+id+" доставлен пользователю."})}
    catch(err){return json({error:String(err.message||err)},502)}
  }
  if(action==="ticket_status"){
    const status=String(data.status||"");
    if(!["new","in_progress","closed"].includes(status))return json({error:"Некорректный статус"},400);
    const updated=await sql("UPDATE mm_reports_v2 SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING id",status,id);
    if(!updated.length)return json({error:"Обращение не найдено"},404);
    await sql("INSERT INTO mm_admin_log(actor,action,details) VALUES(0,'ticket_status',$1::jsonb)",JSON.stringify({id,status,role:session.role}));
    return json({ok:true,message:"Статус обращения №"+id+" обновлён."});
  }
  if(action==="candidate_approve"||action==="candidate_reject"){
   const candidate=(await sql("SELECT * FROM mm_candidate_sources WHERE id=$1 AND status='needs_review'",id))[0];
   if(!candidate)return json({error:"Источник не найден в очереди"},404);
   if(action==="candidate_approve"){
     await sql("INSERT INTO mm_sources(id,title,city,topic,username,active,mode) VALUES($1,$2,$3,'',$4,TRUE,'trial') ON CONFLICT(id) DO UPDATE SET active=TRUE,mode='trial',disabled_reason=NULL",id,candidate.title||"",inferCity(candidate.title||"",""),candidate.username||null);
   }
   await sql("UPDATE mm_candidate_sources SET status=$1,reason=$2,checked_at=NOW() WHERE id=$3",action==="candidate_approve"?"active":"rejected",action==="candidate_approve"?"Вручную проверено владельцем":"Отклонено владельцем",id);
   await sql("INSERT INTO mm_admin_log(actor,action,details) VALUES(0,$1,$2::jsonb)",action,JSON.stringify({target:id,role:session.role}));
   return json({ok:true,message:action==="candidate_approve"?"Источник подключён.":"Источник отклонён."});
 }
 if(action==="access_grant"||action==="access_revoke"){
   const days=Number(data.days||0);
   if(action==="access_grant"&&![30,90,180].includes(days))return json({error:"Недопустимый срок"},400);
   const updated=action==="access_revoke"
    ?await sql("UPDATE mm_users SET access_until=NULL WHERE id=$1 RETURNING id",id)
    :await sql("UPDATE mm_users SET access_until=GREATEST(COALESCE(access_until,NOW()),NOW())+make_interval(days=>$2::int) WHERE id=$1 RETURNING id",id,days);
   if(!updated.length)return json({error:"Аккаунт не найден"},404);
   await sql("INSERT INTO mm_admin_log(actor,action,details) VALUES(0,$1,$2::jsonb)",action,JSON.stringify({target:id,days:action==="access_grant"?days:0,role:session.role}));
   return json({ok:true});
 }
 let changed=[];
 if(action==="source_add"){
  changed=await sql("INSERT INTO mm_sources(id,city,topic,active) VALUES($1,$2,$3,TRUE) ON CONFLICT(id) DO UPDATE SET city=EXCLUDED.city,topic=EXCLUDED.topic,active=TRUE,mode='trial',disabled_reason=NULL,disabled_at=NULL RETURNING id",id,String(data.city||"").slice(0,90),String(data.topic||"").slice(0,90));
 }else if(action==="source_on"){
  changed=await sql("UPDATE mm_sources SET active=TRUE,disabled_reason=NULL,disabled_at=NULL WHERE id=$1 RETURNING id",id);
 }else if(action==="source_off"){
  changed=await sql("UPDATE mm_sources SET active=FALSE WHERE id=$1 RETURNING id",id);
 }else if(action==="approve"){
  changed=await sql("UPDATE mm_jobs SET status='active' WHERE id=$1 AND status='pending' RETURNING *",id);
  if(changed.length&&onApprove)await onApprove(changed[0]);
 }else if(action==="reject"){
  changed=await sql("UPDATE mm_jobs SET status='rejected' WHERE id=$1 AND status='pending' RETURNING id",id);
 }else if(action==="block"){
  changed=await sql("UPDATE mm_users SET blocked=TRUE WHERE id=$1 RETURNING id",id);
  if(changed.length)await sql("UPDATE mm_jobs SET paused=TRUE WHERE owner=$1 AND status='active'",id);
 }else if(action==="unblock"){
  changed=await sql("UPDATE mm_users SET blocked=FALSE,suspended=FALSE WHERE id=$1 RETURNING id",id);
 }else return json({error:"Неизвестное действие"},400);
 if(!changed.length)return json({error:"Запись не найдена или уже обработана"},404);
 await sql("INSERT INTO mm_admin_log(actor,action,details) VALUES(0,$1,$2::jsonb)",action,JSON.stringify({target:id,role:session.role}));
 const messages={source_add:"Источник сохранён и включён.",source_on:"Источник включён.",source_off:"Источник отключён.",approve:"Заявка №"+id+" одобрена.",reject:"Заявка №"+id+" отклонена.",block:"Пользователь "+id+" заблокирован.",unblock:"Пользователь "+id+" разблокирован."};
 return json({ok:true,message:messages[action]||"Действие выполнено."});
 }
 return json({error:"Not found"},404);
}
