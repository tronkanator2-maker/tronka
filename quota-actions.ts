import {setJobVisibility} from "./job-visibility.ts";
import {getQuotaValue} from "./quota-settings.ts";
import {hasPaidAccess as paidOwner} from "./access.ts";
// Critical user actions share a PostgreSQL transaction and a per-user lock.
// SELECT COUNT followed by INSERT outside a transaction permits simultaneous
// callbacks to exceed quotas. All three flows are atomic and retry-safe.
const positiveId=value=>{
 const n=Number(value);
 return Number.isSafeInteger(n)&&n>0?n:null;
};
const isIdEqual=(a,b)=>String(a)===String(b);
const weekStamp=value=>{
 const at=value instanceof Date?value:new Date(value);
 if(!Number.isFinite(at.getTime()))throw Error("Invalid week start");
 return at.toISOString();
};

export async function withUserActionLock(db,userId,run){
 const id=positiveId(userId);
 if(!id||typeof db?.begin!=="function")throw Error("Invalid user or database transaction");
 return db.begin(async tx=>{
  const query=(sql,...values)=>tx.unsafe(sql,values);
  await query("SELECT pg_advisory_xact_lock($1::bigint)",id);
  return run(query);
 });
}

export async function createResponseWithQuota(db,{userId,jobId,message,paid=false,weekStart,ownerUnlimited=false}){
 const actor=positiveId(userId),job=positiveId(jobId);
 if(!actor||!job||typeof message!=="string"||!message.trim()||message.length>1200)
  return {status:"invalid"};
 const week=weekStamp(weekStart);
 return withUserActionLock(db,actor,async sql=>{
  // The row lock prevents a concurrent close/pause while the response commits.
  const listings=await sql("SELECT id,owner,contact,body FROM mm_jobs WHERE id=$1 AND status='active' AND paused=FALSE AND expires_at>NOW() FOR UPDATE",job);
  const listing=listings[0];
  if(!listing||isIdEqual(listing.owner,actor))return {status:"unavailable"};
  const applicants=await sql("SELECT id,blocked,suspended FROM mm_users WHERE id=$1",actor);
  if(!applicants.length||applicants[0].blocked||applicants[0].suspended)return {status:"unavailable"};
  const previous=await sql("SELECT id,status FROM mm_responses WHERE job_id=$1 AND user_id=$2",job,actor);
  if(previous.length){
   const entry=previous[0];
   if(entry.status==="pending"&&Number(listing.owner)!==0)
    await sql("INSERT INTO mm_response_outbox(response_id) VALUES($1) ON CONFLICT(response_id) DO NOTHING",entry.id);
   return {status:"duplicate",responseId:entry.id,responseStatus:entry.status,listing};
  }
  if(!paid){
   const used=await sql("SELECT COUNT(*)::int AS n FROM mm_responses WHERE user_id=$1 AND created_at>=$2",actor,week);
   if(Number(used[0]?.n||0)>=await getQuotaValue(sql,"free_responses_week"))return {status:"limit"};
  }
  // The owner-approved addendum grants the first five responses to a free
  // user's own job. FOR UPDATE above serializes applicants across accounts.
  if(Number(listing.owner)!==0&&!ownerUnlimited){
   const owners=await sql("SELECT id,access_until,trial_until,blocked,suspended FROM mm_users WHERE id=$1",listing.owner);
   const owner=owners[0];
   if(!owner||owner.blocked||owner.suspended)return {status:"unavailable"};
   if(!paidOwner(owner)){
    const inbound=await sql("SELECT COUNT(*)::int AS n FROM mm_responses WHERE job_id=$1",job);
    if(Number(inbound[0]?.n||0)>=await getQuotaValue(sql,"free_inbound_responses"))
     return {status:"job_full"};
   }
  }
  const inserted=await sql("INSERT INTO mm_responses(job_id,user_id,message) VALUES($1,$2,$3) ON CONFLICT(job_id,user_id) DO NOTHING RETURNING id",job,actor,message.trim());
  if(!inserted.length)return {status:"duplicate"};
  if(Number(listing.owner)!==0)
   await sql("INSERT INTO mm_response_outbox(response_id) VALUES($1) ON CONFLICT(response_id) DO NOTHING",inserted[0].id);
  return {status:"created",responseId:inserted[0].id,listing};
 });
}

export async function createInvitationWithQuota(db,{fromUser,toUser,paid=false,weekStart}){
 const sender=positiveId(fromUser),recipient=positiveId(toUser);
 if(!sender||!recipient||sender===recipient)return {status:"invalid"};
 const week=weekStamp(weekStart);
 return withUserActionLock(db,sender,async sql=>{
  const participants=await sql("SELECT id,active,blocked,suspended FROM mm_users WHERE id IN ($1,$2) ORDER BY id FOR SHARE",sender,recipient);
  if(participants.length!==2||participants.some(u=>u.blocked||u.suspended||u.active===false))return {status:"unavailable"};
  const previous=await sql("SELECT id,status FROM mm_invitations WHERE from_user=$1 AND to_user=$2 AND status IN ('sent','accepted') ORDER BY id DESC LIMIT 1",sender,recipient);
  if(previous.length){
   if(previous[0].status==="sent")
    await sql("INSERT INTO mm_invitation_outbox(invitation_id) VALUES($1) ON CONFLICT(invitation_id) DO NOTHING",previous[0].id);
   return {status:"duplicate",invitationId:previous[0].id,invitationStatus:previous[0].status};
  }
  if(!paid){
   const used=await sql("SELECT COUNT(*)::int AS n FROM mm_invitations WHERE from_user=$1 AND created_at>=$2",sender,week);
   if(Number(used[0]?.n||0)>=await getQuotaValue(sql,"free_invitations_week"))return {status:"limit"};
  }
  const inserted=await sql("INSERT INTO mm_invitations(from_user,to_user) VALUES($1,$2) RETURNING id",sender,recipient);
  if(!inserted.length)throw Error("Invitation insert returned no row");
  await sql("INSERT INTO mm_invitation_outbox(invitation_id) VALUES($1) ON CONFLICT(invitation_id) DO NOTHING",inserted[0].id);
  return {status:"created",invitationId:inserted[0].id};
 });
}

export async function publishJobWithQuota(db,{ownerId,body,expiresAt,draftToken,paid=false}){
 const owner=positiveId(ownerId),token=String(draftToken||"");
 if(!owner||!body||typeof body!=="object"||Array.isArray(body)||!token||token.length>180)
  return {status:"invalid"};
 const expires=new Date(expiresAt);
 if(!Number.isFinite(expires.getTime())||expires<=new Date())return {status:"invalid"};
 return withUserActionLock(db,owner,async sql=>{
  const previous=await sql("SELECT id FROM mm_jobs WHERE owner=$1 AND draft_token=$2",owner,token);
  if(previous.length)return {status:"duplicate",jobId:previous[0].id};
  const active=await sql("SELECT COUNT(*)::int AS total FROM mm_jobs WHERE owner=$1 AND status='active' AND paused=FALSE AND expires_at>NOW()",owner);
  const limit=await getQuotaValue(sql,paid?"paid_active_jobs":"free_active_jobs");
  if(Number(active[0]?.total||0)>=limit)return {status:"limit",maxActive:limit};
  const inserted=await sql("INSERT INTO mm_jobs(owner,body,expires_at,draft_token) VALUES($1,$2::jsonb,$3,$4) ON CONFLICT DO NOTHING RETURNING *",owner,JSON.stringify(body),expires.toISOString(),token);
  if(!inserted.length){
   const found=await sql("SELECT id FROM mm_jobs WHERE owner=$1 AND draft_token=$2",owner,token);
   return {status:"duplicate",jobId:found[0]?.id||null};
  }
  const listing=inserted[0];
  // Publication and scheduling are committed together. Telegram sendMessage
  // happens only AFTER commit and therefore cannot strand a published job.
  await sql(`INSERT INTO mm_fanout_queue(job_id) VALUES($1)
   ON CONFLICT(job_id) DO UPDATE SET pending=TRUE,cursor_id=0,profile_cursor_id=0,
   generation=mm_fanout_queue.generation+1,profiles_done=FALSE,attempts=0,
   completed_at=NULL,next_attempt_at=NOW()`,listing.id);
  return {status:"created",jobId:listing.id,listing};
 });
}

export async function changeJobVisibilityWithQuota(db,ownerId,action,paid=false){
 const owner=positiveId(ownerId),job=positiveId(action?.id);
 if(!owner||!job||typeof action?.paused!=="boolean")return {status:"invalid"};
 return withUserActionLock(db,owner,async sql=>{
  if(!action.paused){
   const records=await sql("SELECT id,paused,expires_at FROM mm_jobs WHERE id=$1 AND owner=$2 AND status='active' FOR UPDATE",job,owner);
   const existing=records[0];
   if(!existing||new Date(existing.expires_at)<=new Date())return {status:"missing"};
   if(!existing.paused)return {status:"already",paused:false};
   const rows=await sql("SELECT COUNT(*)::int AS total FROM mm_jobs WHERE owner=$1 AND status='active' AND paused=FALSE AND expires_at>NOW()",owner);
   const limit=await getQuotaValue(sql,paid?"paid_active_jobs":"free_active_jobs");
   if(Number(rows[0]?.total||0)>=limit)return {status:"limit",maxActive:limit,paused:true};
  }
  return setJobVisibility(sql,owner,action);
 });
}
