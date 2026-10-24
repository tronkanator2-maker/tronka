// Trial-ending reminders (§17.4). No payment is taken here.
// A separate approved payment provider is required for checkout.
// Messages are disabled by default until TRIAL_REMINDERS_ENABLED=true
// AND PAYMENTS_ENABLED=true AND test mode has been disabled.
const maxBatch=20;
export async function prepareTrialReminders(sql){
 await sql(`CREATE TABLE IF NOT EXISTS mm_trial_reminders(
   user_id BIGINT NOT NULL,
   days_before INTEGER NOT NULL CHECK(days_before IN (1,3)),
   attempts INTEGER NOT NULL DEFAULT 0,
   next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
   locked_until TIMESTAMPTZ,
   completed_at TIMESTAMPTZ,
   sent_at TIMESTAMPTZ,
   PRIMARY KEY(user_id,days_before)
 )`);
 await sql("CREATE INDEX IF NOT EXISTS mm_trial_reminders_ready ON mm_trial_reminders(next_attempt_at) WHERE completed_at IS NULL");
}
export const trialRemindersEnabled=env=>env.TRIAL_REMINDERS_ENABLED==="true"&&env.PAYMENTS_ENABLED==="true"&&env.TEST_MODE!=="true";
export function trialReminderText(daysBefore){
 if(daysBefore===3)return "⏳ Ваш пробный период «Мир моделей» заканчивается примерно через три дня. После этого начнут действовать ограничения бесплатного доступа. Откройте раздел «Подписка», чтобы посмотреть доступные тарифы. Если сообщения не нужны, нажмите «Не напоминать».";
 if(daysBefore===1)return "⏳ Завтра заканчивается пробный период «Мир моделей». Без подписки доступ будет ограничен бесплатными лимитами. Посмотреть действующие предложения и срок их действия можно в разделе «Подписка».";
 throw Error("Unknown reminder stage");
}
export const trialReminderControls=daysBefore=>({
 inline_keyboard:[
  [{text:"💳 Условия подписки",callback_data:"access_info"}],
  ...(daysBefore===3?[[{text:"🔕 Не напоминать",callback_data:"trial:mute"}]]:[])
 ]
});
export async function muteTrialReminders(sql,userId){
 const id=Number(userId);
 if(!Number.isSafeInteger(id)||id<=0)return false;
 const result=await sql(`UPDATE mm_users SET consent=jsonb_set(
  CASE WHEN jsonb_typeof(consent)='object' THEN consent ELSE '{}'::jsonb END,
  '{trial_reminders_muted}','true'::jsonb,TRUE)
 WHERE id=$1 RETURNING id`,id);
 return result.length>0;
}
export async function queueDueTrialReminders(sql){
 const rows=await sql(`INSERT INTO mm_trial_reminders(user_id,days_before)
 SELECT u.id, v.days
 FROM mm_users u
 CROSS JOIN (VALUES(3),(1)) AS v(days)
 WHERE u.trial_until IS NOT NULL
   AND u.trial_until>NOW()
   AND u.trial_until<=NOW()+make_interval(days=>v.days)
   AND (v.days=1 OR u.trial_until>NOW()+INTERVAL '1 day')
   AND (u.access_until IS NULL OR u.access_until<=NOW())
   AND u.blocked=FALSE AND u.suspended=FALSE AND u.active=TRUE
   AND COALESCE(u.consent->>'trial_reminders_muted','false')<>'true'
 ON CONFLICT(user_id,days_before) DO NOTHING
 RETURNING user_id`);
 return rows.length;
}
export async function deliverTrialReminders(sql,send,limit=5){
 if(!Number.isSafeInteger(limit)||limit<1||limit>maxBatch)throw Error("Invalid trial reminder batch");
 const due=await sql(`WITH due AS(
  SELECT user_id,days_before FROM mm_trial_reminders
  WHERE completed_at IS NULL AND next_attempt_at<=NOW()
    AND (locked_until IS NULL OR locked_until<NOW())
  ORDER BY next_attempt_at,user_id,days_before DESC LIMIT $1 FOR UPDATE SKIP LOCKED
 )
 UPDATE mm_trial_reminders r SET locked_until=NOW()+INTERVAL '90 seconds'
 FROM due WHERE r.user_id=due.user_id AND r.days_before=due.days_before
 RETURNING r.user_id,r.days_before`,limit);
 let delivered=0,skipped=0,failed=0;
 for(const task of due){
  try{
   const accounts=await sql("SELECT id,trial_until,access_until,consent,blocked,suspended,active FROM mm_users WHERE id=$1",task.user_id);
   const user=accounts[0],trialDate=user?.trial_until?new Date(user.trial_until):null;
   const valid=!!user && !user.blocked&&!user.suspended&&user.active!==false
    &&user.consent?.trial_reminders_muted!==true
    &&trialDate&&trialDate.getTime()>Date.now()
    &&(!user.access_until||new Date(user.access_until).getTime()<=Date.now());
   if(valid){
    const result=await send(user.id,trialReminderText(task.days_before),trialReminderControls(task.days_before));
    if(!result?.ok)throw Error("Telegram trial notice rejected");
    delivered++;
    await sql("UPDATE mm_trial_reminders SET sent_at=NOW(),completed_at=NOW(),locked_until=NULL WHERE user_id=$1 AND days_before=$2",task.user_id,task.days_before);
   }else{
    skipped++;
    await sql("UPDATE mm_trial_reminders SET completed_at=NOW(),locked_until=NULL WHERE user_id=$1 AND days_before=$2",task.user_id,task.days_before);
   }
  }catch(error){
   failed++;
   console.warn("Trial reminder deferred",String(task.user_id),task.days_before,String(error));
   await sql(`UPDATE mm_trial_reminders SET attempts=attempts+1,locked_until=NULL,
     next_attempt_at=NOW()+make_interval(secs=>LEAST(3600,POWER(2,LEAST(attempts,8))*15)::int)
    WHERE user_id=$1 AND days_before=$2`,task.user_id,task.days_before);
  }
 }
 return {processed:due.length,delivered,skipped,failed};
}
