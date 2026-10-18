// Background profile-matching queue. Webhooks enqueue only; no Telegram
// fan-out blocks saving a profile or photo. Work is bounded to five jobs/tick.
const validUserId=value=>{
 const n=Number(value);
 return Number.isSafeInteger(n)&&n>0?n:null;
};
export async function prepareProfileRefreshQueue(sql){
 await sql(`CREATE TABLE IF NOT EXISTS mm_profile_refresh_queue(
  user_id BIGINT PRIMARY KEY REFERENCES mm_users(id) ON DELETE CASCADE,
  phase TEXT NOT NULL DEFAULT 'matches',
  cursor_job_id BIGINT NOT NULL DEFAULT 0,
  generation BIGINT NOT NULL DEFAULT 1,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  pending BOOLEAN NOT NULL DEFAULT TRUE)`);
 await sql("CREATE INDEX IF NOT EXISTS mm_profile_refresh_ready ON mm_profile_refresh_queue(next_attempt_at) WHERE pending=TRUE");
}
export async function queueProfileRefresh(sql,id){
 const userId=validUserId(id);
 if(!userId)return false;
 await sql(`INSERT INTO mm_profile_refresh_queue(user_id) VALUES($1)
 ON CONFLICT(user_id) DO UPDATE SET
 phase='matches',cursor_job_id=0,generation=mm_profile_refresh_queue.generation+1,
 attempts=0,next_attempt_at=NOW(),completed_at=NULL,pending=TRUE`,userId);
 return true;
}
export async function runProfileRefreshBatch(sql,sendMatchedProfile,deliverTo,allowed,limit=5){
 if(!Number.isInteger(limit)||limit<1||limit>10)throw Error("Invalid profile refresh batch size");
 const rows=await sql(`SELECT q.*,u.id AS actor_id,u.active,u.blocked,u.suspended,u.photo,u.profile,u.consent
 FROM mm_profile_refresh_queue q JOIN mm_users u ON u.id=q.user_id
 WHERE q.pending=TRUE AND q.next_attempt_at<=NOW()
 ORDER BY q.next_attempt_at LIMIT 1`);
 const item=rows[0];
 if(!item)return {processed:0,done:true};
 const userId=item.user_id,generation=item.generation;
 const finish=async()=>{
  await sql("UPDATE mm_profile_refresh_queue SET pending=FALSE,completed_at=NOW() WHERE user_id=$1 AND generation=$2",userId,generation);
  return {processed:0,done:true};
 };
 if(!item.active||item.blocked||item.suspended||!item.photo||!await allowed(item))return finish();
 const phase=item.phase==="jobs"?"jobs":"matches";
 const jobs=await sql(`SELECT * FROM mm_jobs WHERE id>$2 AND owner<>$1
  AND status='active' AND paused=FALSE AND expires_at>NOW()
  AND created_at>NOW()-INTERVAL '14 days'`+(phase==="matches"?" AND owner<>0":"")+
  " ORDER BY id ASC LIMIT $3",userId,item.cursor_job_id,limit);
 if(!jobs.length){
  if(phase==="matches"){
   await sql("UPDATE mm_profile_refresh_queue SET phase='jobs',cursor_job_id=0,next_attempt_at=NOW(),attempts=0 WHERE user_id=$1 AND generation=$2",userId,generation);
   return {processed:0,done:false,next:"jobs"};
  }
  return finish();
 }
 let processed=0;
 for(const job of jobs){
  try{
   if(phase==="matches")await sendMatchedProfile(job,item);
   else await deliverTo(item,job);
   await sql("UPDATE mm_profile_refresh_queue SET cursor_job_id=$3,attempts=0,next_attempt_at=NOW() WHERE user_id=$1 AND generation=$2",userId,generation,job.id);
   processed++;
  }catch(error){
   console.warn("Profile refresh deferred",String(userId),String(job.id),String(error));
   await sql(`UPDATE mm_profile_refresh_queue SET attempts=attempts+1,
    next_attempt_at=NOW()+make_interval(secs=>LEAST(3600,POWER(2,LEAST(attempts,8))*15)::int)
    WHERE user_id=$1 AND generation=$2`,userId,generation);
   return {processed,done:false,retry:true};
  }
 }
 return {processed,done:false,phase};
}
