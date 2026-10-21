// Durable notification queue for declined responses and rejected/cancelled
// invitations. A Telegram failure must not silently lose a status change.
const decisionKinds=new Set(["response_declined","invitation_declined","invitation_cancelled"]);
const positiveId=x=>{const n=Number(x);return Number.isSafeInteger(n)&&n>0?n:null};

export async function prepareDecisionNotifications(sql){
 await sql(`CREATE TABLE IF NOT EXISTS mm_decision_notifications(
  kind TEXT NOT NULL CHECK(kind IN ('response_declined','invitation_declined','invitation_cancelled')),
  entity_id BIGINT NOT NULL,
  recipient_id BIGINT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  PRIMARY KEY(kind,entity_id)
 )`);
 await sql("CREATE INDEX IF NOT EXISTS mm_decision_notifications_due ON mm_decision_notifications(next_attempt_at) WHERE completed_at IS NULL");
}

/** Returns no record if actor does not own this decision. */
export async function updateCollaborationDecision(sql,kind,entity,actor){
 if(!decisionKinds.has(kind))return null;
 const id=positiveId(entity),userId=positiveId(actor);
 if(!id||!userId)return null;
 let changed=[],existing=[];
 if(kind==="response_declined"){
  changed=await sql(`UPDATE mm_responses r SET status='declined'
   FROM mm_jobs j
   WHERE r.id=$1 AND r.job_id=j.id AND j.owner=$2 AND r.status='pending'
   RETURNING r.id,r.user_id AS recipient_id`,id,userId);
  if(!changed.length)existing=await sql(`SELECT r.id,r.user_id AS recipient_id
   FROM mm_responses r JOIN mm_jobs j ON r.job_id=j.id
   WHERE r.id=$1 AND j.owner=$2 AND r.status='declined'`,id,userId);
 }else{
  const status=kind==="invitation_cancelled"?"cancelled":"declined";
  const actorField=kind==="invitation_cancelled"?"from_user":"to_user";
  const targetField=kind==="invitation_cancelled"?"to_user":"from_user";
  changed=await sql(`UPDATE mm_invitations SET status=$3
   WHERE id=$1 AND ${actorField}=$2 AND status='sent'
   RETURNING id,${targetField} AS recipient_id`,id,userId,status);
  if(!changed.length)existing=await sql(`SELECT id,${targetField} AS recipient_id
   FROM mm_invitations WHERE id=$1 AND ${actorField}=$2 AND status=$3`,id,userId,status);
 }
 const row=changed[0]||existing[0];
 if(!row)return null;
 await sql(`INSERT INTO mm_decision_notifications(kind,entity_id,recipient_id)
 VALUES($1,$2,$3) ON CONFLICT(kind,entity_id) DO NOTHING`,kind,row.id,row.recipient_id);
 return {kind,id:row.id,recipientId:row.recipient_id,newlyChanged:changed.length>0};
}

export function decisionNotice(kind,id){
 if(!decisionKinds.has(kind))return null;
 if(kind==="response_declined")return "К сожалению, ваш отклик №"+id+" отклонён. Другие заявки можно найти в главном меню.";
 if(kind==="invitation_declined")return "Приглашение №"+id+" было отклонено. Контакты не раскрывались.";
 return "Входящее приглашение №"+id+" отменено отправителем. Контакты не раскрывались.";
}

export async function deliverDecisionNotifications(sql,send,limit=5){
 if(!Number.isInteger(limit)||limit<1||limit>20)throw Error("Invalid decision notification batch size");
 const rows=await sql(`WITH due AS (
  SELECT kind,entity_id FROM mm_decision_notifications
  WHERE completed_at IS NULL AND next_attempt_at<=NOW()
    AND (locked_until IS NULL OR locked_until<NOW())
  ORDER BY next_attempt_at LIMIT $1 FOR UPDATE SKIP LOCKED
 )
 UPDATE mm_decision_notifications n SET locked_until=NOW()+INTERVAL '45 seconds'
 FROM due WHERE n.kind=due.kind AND n.entity_id=due.entity_id
 RETURNING n.kind,n.entity_id,n.recipient_id`,limit);
 let completed=0,failed=0;
 for(const row of rows){
  try{
   const recipients=await sql("SELECT id,blocked,suspended FROM mm_users WHERE id=$1",row.recipient_id);
   const recipient=recipients[0];
   if(recipient&&!recipient.blocked&&!recipient.suspended){
    const sent=await send(row.recipient_id,decisionNotice(row.kind,row.entity_id));
    if(!sent?.ok)throw Error("Telegram did not deliver status notification");
   }
   // Deleted or blocked recipients cannot receive notifications; do not retry forever.
   await sql("UPDATE mm_decision_notifications SET completed_at=NOW(),locked_until=NULL WHERE kind=$1 AND entity_id=$2",row.kind,row.entity_id);
   completed++;
  }catch(error){
   failed++;
   console.warn("Decision notification deferred",row.kind,String(row.entity_id),String(error));
   await sql(`UPDATE mm_decision_notifications SET locked_until=NULL,
    attempts=attempts+1,
    next_attempt_at=NOW()+make_interval(secs=>LEAST(3600,POWER(2,LEAST(attempts,8))*15)::int)
    WHERE kind=$1 AND entity_id=$2`,row.kind,row.entity_id);
  }
 }
 return {processed:rows.length,completed,failed};
}
