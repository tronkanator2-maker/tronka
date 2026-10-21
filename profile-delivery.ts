// Resumable three-step delivery for matched-profile cards.
// Legacy completed receipts are migrated with TRUE defaults. New receipts
// explicitly start with FALSE so a transient Telegram error can resume just
// the missing step. Concurrent calls for one pair coalesce within one process.
const inFlight=new Map();
const positive=x=>{
 const n=Number(x);
 return Number.isSafeInteger(n)&&n>0?n:null;
};
export async function prepareProfileDeliveryProgress(sql){
 await sql("ALTER TABLE mm_profile_deliveries ADD COLUMN IF NOT EXISTS notice_sent BOOLEAN NOT NULL DEFAULT TRUE");
 await sql("ALTER TABLE mm_profile_deliveries ADD COLUMN IF NOT EXISTS media_sent BOOLEAN NOT NULL DEFAULT TRUE");
 await sql("ALTER TABLE mm_profile_deliveries ADD COLUMN IF NOT EXISTS card_sent BOOLEAN NOT NULL DEFAULT TRUE");
}
async function performDelivery(sql,jobId,userId,sendNotice,sendCard){
 await sql(`INSERT INTO mm_profile_deliveries(job_id,user_id,notice_sent,media_sent,card_sent)
 VALUES($1,$2,FALSE,FALSE,FALSE)
 ON CONFLICT(job_id,user_id) DO NOTHING`,jobId,userId);
 const rows=await sql(`SELECT notice_sent,media_sent,card_sent FROM mm_profile_deliveries
 WHERE job_id=$1 AND user_id=$2`,jobId,userId);
 const row=rows[0];
 if(!row)throw Error("Matched profile delivery receipt missing");
 if(row.notice_sent&&row.media_sent&&row.card_sent)return false;
 if(!row.notice_sent){
  const notice=await sendNotice();
  if(!notice?.ok)throw Error("Matched profile heading not delivered");
  await sql("UPDATE mm_profile_deliveries SET notice_sent=TRUE WHERE job_id=$1 AND user_id=$2",jobId,userId);
 }
 if(!row.card_sent){
  const done=await sendCard({
   skipMedia:row.media_sent===true,
   onMediaSent:async()=>{
    if(row.media_sent)return;
    await sql("UPDATE mm_profile_deliveries SET media_sent=TRUE WHERE job_id=$1 AND user_id=$2",jobId,userId);
    row.media_sent=true;
   }
  });
  if(!done?.ok)throw Error("Matched profile details not delivered");
  await sql("UPDATE mm_profile_deliveries SET card_sent=TRUE WHERE job_id=$1 AND user_id=$2",jobId,userId);
 }
 return true;
}
export async function deliverMatchedProfileProgress(sql,jobId,personId,sendNotice,sendCard){
 const j=positive(jobId),u=positive(personId);
 if(!j||!u)throw Error("Invalid matched profile ID");
 const key=j+":"+u;
 const existing=inFlight.get(key);
 if(existing)return existing;
 const task=performDelivery(sql,j,u,sendNotice,sendCard);
 inFlight.set(key,task);
 try{return await task}finally{if(inFlight.get(key)===task)inFlight.delete(key)}
}
