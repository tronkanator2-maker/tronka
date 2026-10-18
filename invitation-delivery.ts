// The initial invitation is sent via a durable 3-step worker.
// This keeps a Telegram callback fast and avoids deleting accepted invitations
// when only one of the recipient's messages fails to deliver.
export async function prepareInvitationOutbox(sql){
 await sql(`CREATE TABLE IF NOT EXISTS mm_invitation_outbox(
  invitation_id BIGINT PRIMARY KEY REFERENCES mm_invitations(id) ON DELETE CASCADE,
  step INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ)`);
 await sql("CREATE INDEX IF NOT EXISTS mm_invitation_outbox_ready ON mm_invitation_outbox(next_attempt_at) WHERE completed_at IS NULL");
}
export async function queueInitialInvitation(sql,invitationId){
 const id=Number(invitationId);
 if(!Number.isSafeInteger(id)||id<=0)return false;
 await sql("INSERT INTO mm_invitation_outbox(invitation_id) VALUES($1) ON CONFLICT(invitation_id) DO NOTHING",id);
 return true;
}
export async function deliverPendingInvitations(sql,send,showProfile,isEligible,limit=5){
 const ready=await sql(`SELECT o.*,i.from_user,i.to_user,i.status AS invitation_status
  FROM mm_invitation_outbox o
  JOIN mm_invitations i ON i.id=o.invitation_id
  WHERE o.completed_at IS NULL AND o.next_attempt_at<=NOW()
  ORDER BY o.next_attempt_at LIMIT $1`,limit);
 let completed=0,failed=0;
 for(const item of ready){
  try{
   if(item.invitation_status!=="sent"){
    await sql("UPDATE mm_invitation_outbox SET completed_at=NOW() WHERE invitation_id=$1",item.invitation_id);
    completed++;
    continue;
   }
   const people=await sql("SELECT * FROM mm_users WHERE id IN ($1,$2)",item.from_user,item.to_user);
   const sender=people.find(x=>String(x.id)===String(item.from_user));
   const recipient=people.find(x=>String(x.id)===String(item.to_user));
   if(!sender||!recipient||!await isEligible(sender,recipient)){
    // Neither party should be contacted about an invalid/withdrawn profile.
    await sql("UPDATE mm_invitations SET status='cancelled' WHERE id=$1 AND status='sent'",item.invitation_id);
    await sql("UPDATE mm_invitation_outbox SET completed_at=NOW() WHERE invitation_id=$1",item.invitation_id);
    completed++;
    continue;
   }
   if(item.step<=0){
    const notice=await send(recipient.id,"👋 Вам пришло приглашение №"+item.invitation_id+" на сотрудничество. Посмотрите анкету и выберите действие.");
    if(!notice?.ok)throw Error("Invitation greeting could not be sent");
    await sql("UPDATE mm_invitation_outbox SET step=1,attempts=0,next_attempt_at=NOW() WHERE invitation_id=$1",item.invitation_id);
   }
   if(item.step<=1){
    const shown=await showProfile(recipient.id,sender,"Анкета приглашающего участника");
    if(!shown?.ok)throw Error("Invitation profile could not be sent");
    await sql("UPDATE mm_invitation_outbox SET step=2,attempts=0,next_attempt_at=NOW() WHERE invitation_id=$1",item.invitation_id);
   }
   const actions={inline_keyboard:[[
    {text:"✅ Принять",callback_data:"acceptinvite:"+item.invitation_id},
    {text:"❌ Отклонить",callback_data:"rejectinvite:"+item.invitation_id}
   ]]};
   const controls=await send(recipient.id,"Приглашение №"+item.invitation_id+". До принятия контакты сторон скрыты.",actions);
   if(!controls?.ok)throw Error("Invitation action buttons could not be sent");
   await sql("UPDATE mm_invitation_outbox SET completed_at=NOW(),step=3,attempts=0 WHERE invitation_id=$1",item.invitation_id);
   completed++;
  }catch(error){
   failed++;
   console.warn("Initial invitation delivery deferred",String(item.invitation_id),String(error));
   await sql(`UPDATE mm_invitation_outbox SET attempts=attempts+1,
    next_attempt_at=NOW()+make_interval(secs=>LEAST(3600,POWER(2,LEAST(attempts,8))*15)::int)
    WHERE invitation_id=$1`,item.invitation_id);
  }
 }
 return {processed:ready.length,completed,failed};
}
