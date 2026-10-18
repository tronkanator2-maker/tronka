// Deliver matching profiles in small, restart-safe pages. A cursor is saved
// only after each candidate has been checked and any Telegram send succeeds.
export async function runProfileFanoutPage(sql,job,queue,sendMatchedProfile,limit=5){
 if(!Number.isInteger(limit)||limit<1||limit>10)throw Error("Invalid profile fanout batch size");
 if(Number(job.owner)===0){
  await sql("UPDATE mm_fanout_queue SET profiles_done=TRUE,next_attempt_at=NOW() WHERE job_id=$1 AND generation=$2",job.id,queue.generation);
  return {processed:0,done:true};
 }
 const people=await sql(`SELECT * FROM mm_users
  WHERE id>$1 AND id<>$2 AND photo IS NOT NULL
  AND active=TRUE AND blocked=FALSE AND suspended=FALSE
  ORDER BY id ASC LIMIT $3`,queue.profile_cursor_id||0,job.owner,limit);
 for(const person of people){
  await sendMatchedProfile(job,person);
  await sql("UPDATE mm_fanout_queue SET profile_cursor_id=$1,attempts=0,next_attempt_at=NOW()+INTERVAL '2 seconds' WHERE job_id=$2 AND generation=$3",person.id,job.id,queue.generation);
 }
 if(people.length<limit){
  await sql("UPDATE mm_fanout_queue SET profiles_done=TRUE,next_attempt_at=NOW() WHERE job_id=$1 AND generation=$2",job.id,queue.generation);
  return {processed:people.length,done:true};
 }
 return {processed:people.length,done:false};
}
