// Idempotent job visibility controls. Explicit actions prevent double taps
// on Telegram inline keyboards from reverting a deliberate pause/resume.
export function jobVisibilityCallback(job){
 const id=Number(job?.id);
 if(!Number.isSafeInteger(id)||id<=0)return null;
 return "jobpause:"+id+":"+(job?.paused?"resume":"pause");
}
export function parseJobVisibilityAction(value){
 const matched=/^jobpause:([1-9]\d{0,18}):(pause|resume)$/.exec(String(value||""));
 if(!matched)return null;
 const id=Number(matched[1]);
 return Number.isSafeInteger(id)&&id>0?{id,paused:matched[2]==="pause"}:null;
}
export async function setJobVisibility(sql,ownerId,action){
 const actor=Number(ownerId);
 if(!Number.isSafeInteger(actor)||actor<=0||!action||
   !Number.isSafeInteger(action.id)||action.id<=0||typeof action.paused!=="boolean")return {status:"invalid"};
 // A single PostgreSQL statement atomically persists the visibility change
 // AND queues a resumed job for fanout. Any later webhook retry sees the same
 // state and cannot reset the fanout cursor for another delivery.
 const changed=await sql(`WITH changed AS (
   UPDATE mm_jobs SET paused=$3
   WHERE id=$1 AND owner=$2 AND status='active'
     AND paused IS DISTINCT FROM $3
   RETURNING *
 ), queued AS (
   INSERT INTO mm_fanout_queue(job_id)
   SELECT id FROM changed WHERE paused=FALSE
   ON CONFLICT(job_id) DO UPDATE SET
     pending=TRUE,cursor_id=0,profile_cursor_id=0,
     generation=mm_fanout_queue.generation+1,profiles_done=FALSE,
     attempts=0,completed_at=NULL,next_attempt_at=NOW()
   RETURNING job_id
 )
 SELECT changed.* FROM changed`,action.id,actor,action.paused);
 if(changed.length)return {status:"changed",paused:!!changed[0].paused,job:changed[0]};
 const current=await sql("SELECT id,paused FROM mm_jobs WHERE id=$1 AND owner=$2 AND status='active'",action.id,actor);
 if(!current.length)return {status:"missing"};
 return current[0].paused===action.paused
  ?{status:"already",paused:action.paused}
  :{status:"conflict",paused:!!current[0].paused};
}
