// Privacy controls for the data stored by Мир моделей. No external third-party records.
const toNumber=n=>typeof n==="bigint"?n.toString():n;
export async function exportAccount(sql,id){
 const [user]=await sql("SELECT * FROM mm_users WHERE id=$1",id);
 if(!user)return null;
 const [jobs,responses,invitations,reviews,tickets,consents,recovery,dailyViews]=await Promise.all([
  sql("SELECT id,body,status,created_at,expires_at FROM mm_jobs WHERE owner=$1 ORDER BY id",id),
  sql("SELECT id,job_id,status,message,created_at FROM mm_responses WHERE user_id=$1 ORDER BY id",id),
  sql("SELECT id,from_user,to_user,status,created_at FROM mm_invitations WHERE from_user=$1 OR to_user=$1 ORDER BY id",id),
  sql("SELECT id,author,target,score,shoot_status,body,answer,created_at FROM mm_reviews WHERE author=$1 OR target=$1 ORDER BY id",id),
  sql("SELECT id,reporter,target_user,target_job,kind,status,body,created_at FROM mm_reports_v2 WHERE reporter=$1 ORDER BY id",id),
  sql("SELECT consent,checked,document_versions,document_hashes,recorded_at FROM mm_consent_events WHERE telegram_user=$1 ORDER BY id",id),
  sql("SELECT field,value,saved_at FROM mm_user_recovery WHERE user_id=$1 ORDER BY field",id),
  sql("SELECT kind,item_id,day,created_at FROM mm_daily_views WHERE user_id=$1 ORDER BY day,kind,item_id",id)
 ]);
 const data={
  exported_at:new Date().toISOString(),
  service:"Мир моделей",
  note:"This archive contains only information held by Мир моделей. Telegram chats with other people remain outside this archive.",
  account:user,jobs,responses,invitations,reviews,tickets,consents,recovery,dailyViews
 };
 return JSON.stringify(data,(_,v)=>toNumber(v),2);
}
export async function deleteAccount(sql,id){
 // Ignore log/report snapshots of 3rd parties that cannot be erased from their Telegram chats.
 // Remove dependent rows before parents to keep the process safe to repeat after interruption.
 // Drop queued Telegram payloads for this account first. They can contain
 // private text, contact details, photos, and commands that could recreate
 // the deleted account if processed by a worker on a later restart.
 // Compare numeric Telegram ids as strings to support full BIGINT precision.
 await sql(`DELETE FROM mm_telegram_update_queue
  WHERE payload#>>'{message,from,id}'=$2
     OR (payload#>>'{message,chat,type}'='private' AND payload#>>'{message,chat,id}'=$2)
     OR payload#>>'{callback_query,from,id}'=$2
     OR payload#>>'{edited_message,from,id}'=$2`,id,String(id));
 // The old mm_reports table and recovery snapshots are also private records.
 await sql("DELETE FROM mm_reports WHERE user_id=$1",id);
 await sql("DELETE FROM mm_user_recovery WHERE user_id=$1",id);
 await sql("DELETE FROM mm_daily_views WHERE user_id=$1",id);
 // Decision outbox has no FK because it stores several entity kinds.
 // Remove both notices addressed to the user and those referencing the user's
 // responses/invitations before deleting the source rows.
 await sql(`DELETE FROM mm_decision_notifications
  WHERE recipient_id=$1
    OR (kind='response_declined' AND entity_id IN
       (SELECT r.id FROM mm_responses r LEFT JOIN mm_jobs j ON j.id=r.job_id
        WHERE r.user_id=$1 OR j.owner=$1))
    OR (kind IN ('invitation_declined','invitation_cancelled') AND entity_id IN
       (SELECT id FROM mm_invitations WHERE from_user=$1 OR to_user=$1))`,id);

 await sql("DELETE FROM mm_support_messages WHERE ticket_id IN (SELECT id FROM mm_reports_v2 WHERE reporter=$1 OR target_user=$1 OR target_job IN (SELECT id FROM mm_jobs WHERE owner=$1))",id);
 await sql("DELETE FROM mm_reports_v2 WHERE reporter=$1 OR target_user=$1 OR target_job IN (SELECT id FROM mm_jobs WHERE owner=$1)",id);
 await sql("DELETE FROM mm_consent_events WHERE telegram_user=$1",id);
 await sql("DELETE FROM mm_review_drafts WHERE user_id=$1",id);
 await sql("DELETE FROM mm_feedback_checks WHERE actor=$1 OR target=$1",id);
 await sql("DELETE FROM mm_reviews WHERE author=$1 OR target=$1",id);
 await sql("DELETE FROM mm_invitations WHERE from_user=$1 OR to_user=$1",id);
 await sql("DELETE FROM mm_referrals WHERE inviter=$1 OR invitee=$1",id);
 await sql("DELETE FROM mm_trial_ledger WHERE first_user=$1",id);
 await sql("DELETE FROM mm_relay_usage WHERE user_id=$1",id);
 await sql("DELETE FROM mm_admin_log WHERE actor=$1 OR details->>\'target\'=$2",id,String(id));
 await sql("DELETE FROM mm_profile_deliveries WHERE user_id=$1 OR job_id IN (SELECT id FROM mm_jobs WHERE owner=$1)",id);
 await sql("DELETE FROM mm_deliveries WHERE user_id=$1 OR job_id IN (SELECT id FROM mm_jobs WHERE owner=$1)",id);
 await sql("DELETE FROM mm_response_outbox WHERE response_id IN (SELECT id FROM mm_responses WHERE user_id=$1 OR job_id IN (SELECT id FROM mm_jobs WHERE owner=$1))",id);
 await sql("DELETE FROM mm_fanout_queue WHERE job_id IN (SELECT id FROM mm_jobs WHERE owner=$1)",id);
 await sql("DELETE FROM mm_responses WHERE user_id=$1 OR job_id IN (SELECT id FROM mm_jobs WHERE owner=$1)",id);
 await sql("UPDATE mm_source_posts SET job_id=NULL WHERE job_id IN (SELECT id FROM mm_jobs WHERE owner=$1)",id);
 await sql("DELETE FROM mm_jobs WHERE owner=$1",id);
 await sql("DELETE FROM mm_users WHERE id=$1",id);
}
export async function sendAccountExport(token,id,payload){
 const form=new FormData();
 form.set("chat_id",String(id));
 form.set("caption","Экспорт данных из «Мира моделей». Храните файл в безопасном месте.");
 form.set("document",new Blob([payload],{type:"application/json"}),"mir-modeley-my-data.json");
 const res=await fetch("https://api.telegram.org/bot"+token+"/sendDocument",{method:"POST",body:form,signal:AbortSignal.timeout(15000)});
 const answer=await res.json();
 return !!answer.ok;
}
