// Relay access is granted only by an accepted collaboration (invitation or job response).
export async function relayAuthorized(sql,from,to){
 const a=Number(from),b=Number(to);
 if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a<=0||b<=0||a===b)return false;
 const rows=await sql(`SELECT (
  EXISTS(SELECT 1 FROM mm_users sender JOIN mm_users recipient ON recipient.id=$2
   WHERE sender.id=$1
    AND sender.blocked=FALSE AND sender.suspended=FALSE
    AND recipient.blocked=FALSE AND recipient.suspended=FALSE)
  AND (
   EXISTS(SELECT 1 FROM mm_invitations
          WHERE status='accepted'
          AND ((from_user=$1 AND to_user=$2) OR (from_user=$2 AND to_user=$1)))
   OR EXISTS(SELECT 1 FROM mm_responses r JOIN mm_jobs j ON j.id=r.job_id
             WHERE r.status='accepted'
             AND ((r.user_id=$1 AND j.owner=$2) OR (r.user_id=$2 AND j.owner=$1)))
  )
 ) AS allowed`,a,b);
 return rows[0]?.allowed===true;
}
export async function prepareRelay(sql){
 await sql("CREATE TABLE IF NOT EXISTS mm_relay_usage(user_id BIGINT NOT NULL,hour_bucket TIMESTAMPTZ NOT NULL,used INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,hour_bucket))");
}
export async function consumeRelayQuota(sql,id,limit=20){
 const rows=await sql(`INSERT INTO mm_relay_usage(user_id,hour_bucket,used)
 VALUES($1,date_trunc('hour',NOW()),1)
 ON CONFLICT(user_id,hour_bucket) DO UPDATE
 SET used=mm_relay_usage.used+1
 WHERE mm_relay_usage.used<$2
 RETURNING used`,id,limit);
 return rows.length>0;
}
