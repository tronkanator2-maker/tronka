import {parseDate} from "./engine.ts";

const safe = x => String(x??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const options = rows => ({inline_keyboard:rows.map(row=>row.map(([text,callback_data])=>({text,callback_data})))});
export function feedbackDueDate(shoot, now=new Date()){
  const m=String(shoot||"").match(/\b\d{1,2}\.\d{1,2}\.\d{4}\b/);
  const date=m?parseDate(m[0]):null;
  return new Date(date&&date>=new Date(now.getTime()-86400000)?date.getTime()+2*86400000:now.getTime()+5*86400000);
}
export async function setupFeedback(sql){
 await sql("ALTER TABLE mm_responses ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'");
 await sql("ALTER TABLE mm_responses ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ");
 await sql("CREATE TABLE IF NOT EXISTS mm_feedback_checks(id BIGSERIAL PRIMARY KEY,origin TEXT NOT NULL,relation_id BIGINT NOT NULL,actor BIGINT NOT NULL,target BIGINT NOT NULL,due_at TIMESTAMPTZ NOT NULL,sent_at TIMESTAMPTZ,reminded_at TIMESTAMPTZ,finished_at TIMESTAMPTZ,postpones INTEGER NOT NULL DEFAULT 0,UNIQUE(origin,relation_id,actor))");
 await sql("CREATE TABLE IF NOT EXISTS mm_review_drafts(user_id BIGINT PRIMARY KEY,check_id BIGINT,review_id BIGINT,stage TEXT NOT NULL,score INTEGER,shoot_status TEXT,body TEXT NOT NULL DEFAULT '')");
 await sql("CREATE TABLE IF NOT EXISTS mm_reviews(id BIGSERIAL PRIMARY KEY,author BIGINT NOT NULL,target BIGINT NOT NULL,origin TEXT NOT NULL,relation_id BIGINT NOT NULL,score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),shoot_status TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',answer TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(author,origin,relation_id))");
 await sql("CREATE INDEX IF NOT EXISTS mm_reviews_target_created ON mm_reviews(target,created_at DESC)");
}
export async function scheduleFeedback(sql,kind,relation,a,b,dateText=""){
 if(!a||!b||a===b)return;
 const due=feedbackDueDate(dateText).toISOString();
 for(const [actor,target] of [[a,b],[b,a]])await sql("INSERT INTO mm_feedback_checks(origin,relation_id,actor,target,due_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(origin,relation_id,actor) DO NOTHING",kind,relation,actor,target,due);
}
export async function feedbackTick(sql,send){
 const rows=await sql("SELECT * FROM mm_feedback_checks WHERE finished_at IS NULL AND due_at<=NOW() AND (sent_at IS NULL OR (reminded_at IS NULL AND sent_at<NOW()-INTERVAL '3 days')) ORDER BY due_at LIMIT 50");
 for(const c of rows){
  try {
   await send(c.actor,c.sent_at?"Напоминание: расскажите, состоялась ли съёмка.":"Как прошло сотрудничество? Съёмка состоялась?",options([[["✅ Состоялась","feedback:yes:"+c.id],["❌ Не состоялась","feedback:no:"+c.id]]]));
   if(c.sent_at)await sql("UPDATE mm_feedback_checks SET reminded_at=NOW() WHERE id=$1 AND reminded_at IS NULL",c.id);
   else await sql("UPDATE mm_feedback_checks SET sent_at=NOW() WHERE id=$1 AND sent_at IS NULL",c.id);
  }catch(e){console.error("feedback notification",String(e))}
 }
 await sql("UPDATE mm_feedback_checks SET finished_at=NOW() WHERE finished_at IS NULL AND reminded_at IS NOT NULL AND reminded_at<NOW()-INTERVAL '3 days'");
}
async function askScore(send,id,checkId){return send(id,"Поставьте оценку от 1 до 5. Текст необязателен.",options([[["1 ⭐","feedback:rate:"+checkId+":1"],["2 ⭐","feedback:rate:"+checkId+":2"],["3 ⭐","feedback:rate:"+checkId+":3"],["4 ⭐","feedback:rate:"+checkId+":4"],["5 ⭐","feedback:rate:"+checkId+":5"]]]))}
async function publish(sql,send,id,checkId,text){
 const d=(await sql("SELECT d.*,c.target,c.origin,c.relation_id,c.finished_at FROM mm_review_drafts d JOIN mm_feedback_checks c ON c.id=d.check_id WHERE d.user_id=$1 AND c.id=$2",id,checkId))[0];
 if(!d||d.finished_at||!d.score)return send(id,"Отзыв уже закрыт или оценка не выбрана.");
 const body=String(text===null?d.body:text).trim().slice(0,300);
 const rows=await sql("INSERT INTO mm_reviews(author,target,origin,relation_id,score,shoot_status,body) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(author,origin,relation_id) DO NOTHING RETURNING *",id,d.target,d.origin,d.relation_id,d.score,d.shoot_status,body);
 await sql("UPDATE mm_feedback_checks SET finished_at=NOW() WHERE id=$1",checkId);
 await sql("DELETE FROM mm_review_drafts WHERE user_id=$1",id);
 await send(id,rows.length?"Спасибо! Отзыв опубликован.":"Вы уже оставили отзыв.");
 if(rows.length)await send(d.target,"О вас оставили отзыв: "+d.score+"/5\n"+safe(body),options([[["Ответить на отзыв","feedback:answer:"+rows[0].id]]]));
}
export async function feedbackCallback(a,id,sql,send){
 if(!a.startsWith("feedback:")&&!a.startsWith("allreviews:"))return false;
 if(a.startsWith("allreviews:")){
  const parts=a.split(":"),target=Number(parts[1]),offset=Math.max(0,Math.min(Number(parts[2])||0,500));
  const data=await sql("SELECT id,author,score,shoot_status,body,answer FROM mm_reviews WHERE target=$1 ORDER BY created_at DESC LIMIT 5 OFFSET $2",target,offset);
  const count=(await sql("SELECT COUNT(*)::int n FROM mm_reviews WHERE target=$1",target))[0].n;
  const title="<b>⭐ Отзывы ("+count+")</b>\n\n";
  const body=data.map(x=>"⭐".repeat(x.score)+" · "+safe(x.shoot_status)+"\n"+safe(x.body||"Без текста")+(x.answer?"\nОтвет: "+safe(x.answer):"")+"\nАвтор: "+x.author).join("\n\n")||"Отзывов пока нет.";
  const nav=[];if(offset>0)nav.push(["◀️","allreviews:"+target+":"+Math.max(0,offset-5)]);if(offset+5<count)nav.push(["▶️","allreviews:"+target+":"+(offset+5)]);
  await send(id,title+body,nav.length?options([nav]):undefined);return true;
 }
 const p=a.split(":");
 if(p[1]==="yes"||p[1]==="no"){
  const checkId=Number(p[2]),yes=p[1]==="yes";
  const check=(await sql("SELECT * FROM mm_feedback_checks WHERE id=$1 AND actor=$2 AND finished_at IS NULL",checkId,id))[0];
  if(!check){await send(id,"Этот опрос уже закрыт.");return true}
  await sql("INSERT INTO mm_review_drafts(user_id,check_id,stage,shoot_status) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET check_id=EXCLUDED.check_id,review_id=NULL,stage=EXCLUDED.stage,shoot_status=EXCLUDED.shoot_status,score=NULL,body=''",id,checkId,yes?"rating":"reason",yes?"состоялась":"не состоялась");
  if(yes)await askScore(send,id,checkId);
  else await send(id,"Что произошло? Если съёмку перенесли — укажите новую дату ДД.ММ.ГГГГ. Если не состоялась — кратко опишите причину.");
  return true;
 }
 if(p[1]==="rate"){
  const checkId=Number(p[2]),score=Number(p[3]);if(!Number.isInteger(score)||score<1||score>5)return true;
  const d=(await sql("SELECT * FROM mm_review_drafts WHERE user_id=$1 AND check_id=$2 AND stage='rating'",id,checkId))[0];
  if(!d)return send(id,"Сначала выберите результат съёмки."),true;
  await sql("UPDATE mm_review_drafts SET stage='comment',score=$1 WHERE user_id=$2",score,id);
  await send(id,"Оценка "+score+"/5. Напишите отзыв до 300 символов или выберите «Без текста».",options([[["Без текста","feedback:skip:"+checkId]]]));
  return true;
 }
 if(p[1]==="skip"){await publish(sql,send,id,Number(p[2]),null);return true}
 if(p[1]==="answer"){
  const rid=Number(p[2]);const r=(await sql("SELECT id FROM mm_reviews WHERE id=$1 AND target=$2 AND answer IS NULL",rid,id))[0];
  if(!r){await send(id,"На этот отзыв уже ответили.");return true}
  await sql("INSERT INTO mm_review_drafts(user_id,review_id,stage) VALUES($1,$2,'answer') ON CONFLICT(user_id) DO UPDATE SET check_id=NULL,review_id=EXCLUDED.review_id,stage='answer',score=NULL,body=''",id,rid);
  await send(id,"Напишите ответ до 300 символов. Изменить опубликованный ответ нельзя.");return true;
 }
 return false;
}
export async function feedbackText(id,text,sql,send){
 const draft=(await sql("SELECT * FROM mm_review_drafts WHERE user_id=$1",id))[0];if(!draft)return false;
 const body=String(text||"").trim().slice(0,300);
 if(!body){await send(id,"Напишите текст.");return true}
 if(draft.stage==="answer"){
  const r=await sql("UPDATE mm_reviews SET answer=$1 WHERE id=$2 AND target=$3 AND answer IS NULL RETURNING id",body,draft.review_id,id);
  await sql("DELETE FROM mm_review_drafts WHERE user_id=$1",id);
  await send(id,r.length?"Ответ сохранён.":"Отзыв недоступен.");return true;
 }
 if(draft.stage==="reason"){
  const match=body.match(/\b\d{1,2}\.\d{1,2}\.\d{4}\b/),date=match?parseDate(match[0]):null;
  const c=(await sql("SELECT * FROM mm_feedback_checks WHERE id=$1 AND actor=$2",draft.check_id,id))[0];if(!c)return false;
  if(date&&date>new Date()&&c.postpones<2){
   await sql("UPDATE mm_feedback_checks SET postpones=postpones+1,due_at=$1,sent_at=NULL,reminded_at=NULL WHERE id=$2",new Date(date.getTime()+172800000).toISOString(),c.id);
   await sql("DELETE FROM mm_review_drafts WHERE user_id=$1",id);
   await send(id,"Проверка перенесена на два дня после новой даты съёмки.");return true;
  }
  await sql("UPDATE mm_review_drafts SET body=$1,stage='rating' WHERE user_id=$2",body,id);
  await askScore(send,id,draft.check_id);return true;
 }
 if(draft.stage==="comment"){await publish(sql,send,id,draft.check_id,body);return true}
 return false;
}
export async function feedbackSummary(target,sql){
 const c=(await sql("SELECT COUNT(*)::int n,ROUND(AVG(score)::numeric,1) avg FROM mm_reviews WHERE target=$1",target))[0];
 if(!c.n)return {text:"⭐ Отзывов пока нет",count:0};
 const recent=await sql("SELECT score,body FROM mm_reviews WHERE target=$1 ORDER BY created_at DESC LIMIT 2",target);
 return {text:"⭐ "+c.avg+" · "+c.n+" отзывов\n"+recent.map(x=>"«"+safe(x.body||"Без текста")+"» ("+x.score+"/5)").join("\n"),count:c.n};
}
