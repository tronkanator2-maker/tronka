// Durable, idempotent delivery of accepted-response notifications.
// The accepted status is persisted before Telegram API calls; on transient failures
// the worker retries the side(s) that have not yet been notified.
const safeId=value=>{
 const n=Number(value);
 return Number.isSafeInteger(n)&&n>0?n:null;
};
const safeUsername=value=>/^[A-Za-z0-9_]{5,32}$/.test(String(value||""))?String(value):null;

export async function prepareAcceptedResponseOutbox(sql){
 await sql(`CREATE TABLE IF NOT EXISTS mm_accepted_response_outbox(
  response_id BIGINT PRIMARY KEY REFERENCES mm_responses(id) ON DELETE CASCADE,
  owner_notified BOOLEAN NOT NULL DEFAULT FALSE,
  applicant_notified BOOLEAN NOT NULL DEFAULT FALSE,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ)`);
 await sql("CREATE INDEX IF NOT EXISTS mm_accepted_response_outbox_ready ON mm_accepted_response_outbox(next_attempt_at) WHERE completed_at IS NULL");
}

export async function acceptResponseForOwner(sql,responseId,ownerId){
 const id=safeId(responseId),owner=safeId(ownerId);
 if(!id||!owner)return null;
 const changed=await sql(`UPDATE mm_responses r SET status='accepted',accepted_at=NOW()
  FROM mm_jobs j WHERE r.id=$1 AND r.job_id=j.id AND j.owner=$2
  AND r.status='pending' RETURNING r.id,r.job_id,r.user_id`,id,owner);
 // An HTTP failure after the status change but before enqueue must be
 // recoverable by tapping the SAME callback a second time.
 const response=changed[0]||(await sql(`SELECT r.id,r.job_id,r.user_id FROM mm_responses r
  JOIN mm_jobs j ON r.job_id=j.id WHERE r.id=$1 AND j.owner=$2
  AND r.status='accepted'`,id,owner))[0];
 if(!response)return null;
 await sql("INSERT INTO mm_accepted_response_outbox(response_id) VALUES($1) ON CONFLICT(response_id) DO NOTHING",response.id);
 return {id:response.id,jobId:response.job_id,userId:response.user_id,newlyAccepted:changed.length>0};
}

function connectionControls(targetId,username){
 const line=[{text:"💬 Написать через бота",callback_data:"relay:"+targetId}];
 const handle=safeUsername(username);
 if(handle)line.unshift({text:"✉️ Открыть Telegram",url:"https://t.me/"+handle});
 return {inline_keyboard:[line]};
}

export async function deliverAcceptedResponses(sql,send,limit=5){
 const ready=await sql(`SELECT o.*,r.user_id,r.status AS response_status,j.owner
  FROM mm_accepted_response_outbox o JOIN mm_responses r ON r.id=o.response_id
  JOIN mm_jobs j ON j.id=r.job_id
  WHERE o.completed_at IS NULL AND o.next_attempt_at<=NOW()
  ORDER BY o.next_attempt_at LIMIT $1`,limit);
 let completed=0,failed=0;
 for(const item of ready){
  try{
   if(item.response_status!=="accepted"){
    await sql("UPDATE mm_accepted_response_outbox SET completed_at=NOW() WHERE response_id=$1",item.response_id);
    completed++;
    continue;
   }
   const people=await sql("SELECT id,username FROM mm_users WHERE id IN ($1,$2)",item.owner,item.user_id);
   const owner=people.find(p=>String(p.id)===String(item.owner));
   const applicant=people.find(p=>String(p.id)===String(item.user_id));
   if(!owner||!applicant){
    await sql("UPDATE mm_accepted_response_outbox SET completed_at=NOW() WHERE response_id=$1",item.response_id);
    completed++;
    continue;
   }
   if(!item.owner_notified){
    const notice=await send(owner.id,"✅ Отклик №"+item.response_id+" принят. Вы можете связаться с участником:",
     connectionControls(applicant.id,applicant.username));
    if(!notice?.ok)throw Error("Owner acceptance notice not delivered");
    await sql("UPDATE mm_accepted_response_outbox SET owner_notified=TRUE WHERE response_id=$1",item.response_id);
   }
   if(!item.applicant_notified){
    const notice=await send(applicant.id,"✅ Ваш отклик №"+item.response_id+" принят! Теперь можно обсудить детали.",
     connectionControls(owner.id,owner.username));
    if(!notice?.ok)throw Error("Applicant acceptance notice not delivered");
    await sql("UPDATE mm_accepted_response_outbox SET applicant_notified=TRUE WHERE response_id=$1",item.response_id);
   }
   await sql("UPDATE mm_accepted_response_outbox SET completed_at=NOW(),attempts=0 WHERE response_id=$1",item.response_id);
   completed++;
  }catch(err){
   failed++;
   console.warn("Acceptance delivery deferred for response",String(item.response_id),String(err));
   await sql(`UPDATE mm_accepted_response_outbox SET
    attempts=attempts+1,next_attempt_at=NOW()+make_interval(
    secs=>LEAST(3600,POWER(2,LEAST(attempts,8))*15)::int)
    WHERE response_id=$1`,item.response_id);
  }
 }
 return {processed:ready.length,completed,failed};
}
