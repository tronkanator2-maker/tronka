// Accepted invitations remain accepted even if the Telegram API is temporarily
// unavailable. A durable queue independently notifies both participants.
const validId=x=>{
 const id=Number(x);
 return Number.isSafeInteger(id)&&id>0?id:null;
};
function buttonsTo(peer,username){
 const actions=[{text:"💬 Написать через бота",callback_data:"relay:"+peer}];
 const handle=String(username||"");
 if(/^[A-Za-z0-9_]{5,32}$/.test(handle))actions.unshift({text:"✉️ Открыть Telegram",url:"https://t.me/"+handle});
 return {inline_keyboard:[actions]};
}
export async function prepareAcceptedInvitationOutbox(sql){
 await sql(`CREATE TABLE IF NOT EXISTS mm_accepted_invitation_outbox(
  invitation_id BIGINT PRIMARY KEY REFERENCES mm_invitations(id) ON DELETE CASCADE,
  sender_notified BOOLEAN NOT NULL DEFAULT FALSE,
  recipient_notified BOOLEAN NOT NULL DEFAULT FALSE,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ)`);
 await sql("CREATE INDEX IF NOT EXISTS mm_accepted_invitation_outbox_ready ON mm_accepted_invitation_outbox(next_attempt_at) WHERE completed_at IS NULL");
}
export async function acceptInvitationForRecipient(sql,inviteId,recipientId){
 const invitation=validId(inviteId),actor=validId(recipientId);
 if(!invitation||!actor)return null;
 const updated=await sql(`UPDATE mm_invitations i SET status='accepted'
  WHERE i.id=$1 AND i.to_user=$2 AND i.status='sent'
   AND EXISTS(SELECT 1 FROM mm_users s
     WHERE s.id=i.from_user AND s.blocked=FALSE AND s.suspended=FALSE)
   AND EXISTS(SELECT 1 FROM mm_users recipient
     WHERE recipient.id=i.to_user AND recipient.blocked=FALSE AND recipient.suspended=FALSE)
  RETURNING i.id,i.from_user,i.to_user`,invitation,actor);
 // If the original callback crashed after commit, requeue instead of
 // replying "already processed" while leaving one participant uninformed.
 const row=updated[0]||(await sql(`SELECT i.id,i.from_user,i.to_user
  FROM mm_invitations i WHERE i.id=$1 AND i.to_user=$2 AND i.status='accepted'
  AND EXISTS(SELECT 1 FROM mm_users sender
    WHERE sender.id=i.from_user AND sender.blocked=FALSE AND sender.suspended=FALSE)
  AND EXISTS(SELECT 1 FROM mm_users recipient
    WHERE recipient.id=i.to_user AND recipient.blocked=FALSE AND recipient.suspended=FALSE)`,invitation,actor))[0];
 if(!row)return null;
 await sql("INSERT INTO mm_accepted_invitation_outbox(invitation_id) VALUES($1) ON CONFLICT(invitation_id) DO NOTHING",row.id);
 return {id:row.id,fromUser:row.from_user,toUser:row.to_user,newlyAccepted:updated.length>0};
}
export async function deliverAcceptedInvitations(sql,send,limit=5){
 const ready=await sql(`SELECT o.*,i.from_user,i.to_user,i.status AS invitation_status
  FROM mm_accepted_invitation_outbox o
  JOIN mm_invitations i ON i.id=o.invitation_id
  WHERE o.completed_at IS NULL AND o.next_attempt_at<=NOW()
  ORDER BY o.next_attempt_at LIMIT $1`,limit);
 let completed=0,failed=0;
 for(const item of ready){
  try{
   if(item.invitation_status!=="accepted"){
    await sql("UPDATE mm_accepted_invitation_outbox SET completed_at=NOW() WHERE invitation_id=$1",item.invitation_id);
    completed++;
    continue;
   }
   const participants=await sql("SELECT id,username,blocked,suspended FROM mm_users WHERE id IN ($1,$2)",item.from_user,item.to_user);
   const sender=participants.find(x=>String(x.id)===String(item.from_user));
   const recipient=participants.find(x=>String(x.id)===String(item.to_user));
   if(!sender||!recipient||sender.blocked||sender.suspended||recipient.blocked||recipient.suspended){
    await sql("UPDATE mm_accepted_invitation_outbox SET completed_at=NOW() WHERE invitation_id=$1",item.invitation_id);
    completed++;
    continue;
   }
   if(!item.sender_notified){
    const msg=await send(sender.id,"✅ Ваше приглашение №"+item.invitation_id+" принято! Можете связаться с участником.",
     buttonsTo(recipient.id,recipient.username));
    if(!msg?.ok)throw Error("Invitation sender notification not delivered");
    await sql("UPDATE mm_accepted_invitation_outbox SET sender_notified=TRUE WHERE invitation_id=$1",item.invitation_id);
   }
   if(!item.recipient_notified){
    const msg=await send(recipient.id,"✅ Приглашение №"+item.invitation_id+" принято. Теперь можно обсудить детали.",
     buttonsTo(sender.id,sender.username));
    if(!msg?.ok)throw Error("Invitation recipient notification not delivered");
    await sql("UPDATE mm_accepted_invitation_outbox SET recipient_notified=TRUE WHERE invitation_id=$1",item.invitation_id);
   }
   await sql("UPDATE mm_accepted_invitation_outbox SET completed_at=NOW(),attempts=0 WHERE invitation_id=$1",item.invitation_id);
   completed++;
  }catch(e){
   failed++;
   console.warn("Invitation acceptance delivery deferred",String(item.invitation_id),String(e));
   await sql(`UPDATE mm_accepted_invitation_outbox SET attempts=attempts+1,
    next_attempt_at=NOW()+make_interval(secs=>LEAST(3600,POWER(2,LEAST(attempts,8))*15)::int)
    WHERE invitation_id=$1`,item.invitation_id);
  }
 }
 return {processed:ready.length,completed,failed};
}
