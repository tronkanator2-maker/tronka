// Explicit, retry-safe search visibility. Callback intent must not be a
// toggle: repeated presses should never undo what the user just requested.
export const searchAction=user=>user?.active===false?"search:resume":"search:stop";
export function searchMenuFor(menu,user){
 const callback=searchAction(user);
 return {inline_keyboard:(menu?.inline_keyboard||[]).map(row=>row.map(button=>
  button.callback_data==="pause"?{
   ...button,
   text:callback==="search:resume"?"▶️ Возобновить поиск":"⏸️ Остановить поиск",
   callback_data:callback
  }:button
 ))};
}
export async function setSearchActive(sql,userId,enabled){
 const id=Number(userId);
 if(!Number.isSafeInteger(id)||id<=0||typeof enabled!=="boolean")return {status:"invalid"};
 // Resuming search and scheduling the initial refresh must be one atomic
 // PostgreSQL statement; otherwise a webhook crash could lose the refresh.
 const changed=await sql(`WITH changed AS (
  UPDATE mm_users SET active=$2
  WHERE id=$1 AND active IS DISTINCT FROM $2
  RETURNING id,active
 ), queued AS (
  INSERT INTO mm_profile_refresh_queue(user_id)
  SELECT id FROM changed WHERE active=TRUE
  ON CONFLICT(user_id) DO UPDATE SET
   phase='matches',cursor_job_id=0,
   generation=mm_profile_refresh_queue.generation+1,
   attempts=0,next_attempt_at=NOW(),completed_at=NULL,pending=TRUE
  RETURNING user_id
 )
 SELECT changed.* FROM changed`,id,enabled);
 if(changed.length)return {status:"changed",active:!!changed[0].active};
 const current=await sql("SELECT id,active FROM mm_users WHERE id=$1",id);
 if(!current.length)return {status:"missing"};
 return {status:"already",active:!!current[0].active};
}
