// Load Telegram account in one database round-trip on the common path.
// Keep the recovery behavior for oversized user-supplied JSON instead of
// silently discarding a draft.
const FILTER_LIMIT=131072;
const PROFILE_LIMIT=262144;

export async function loadTelegramUser(sql,from,log=console){
 const id=Number(from?.id);
 if(!Number.isSafeInteger(id)||id<=0)throw Error("Invalid Telegram user id");
 const rows=await sql(`INSERT INTO mm_users(id,username,first_name)
 VALUES($1,$2,$3)
 ON CONFLICT(id) DO UPDATE SET username=EXCLUDED.username,first_name=EXCLUDED.first_name
 RETURNING *,octet_length(filters::text)::int AS filters_bytes,octet_length(profile::text)::int AS profile_bytes`,
 id,from.username||null,from.first_name||"");
 const user=rows[0];
 if(!user)throw Error("Telegram account upsert returned no user");
 let recovered=false;
 if(Number(user.filters_bytes)>FILTER_LIMIT){
  await sql("INSERT INTO mm_user_recovery(user_id,field,value) SELECT id,'filters',filters FROM mm_users WHERE id=$1 ON CONFLICT(user_id,field) DO NOTHING",id);
  await sql("UPDATE mm_users SET filters='{}'::jsonb,state='' WHERE id=$1",id);
  log.warn("Oversized user filters moved to recovery",id,user.filters_bytes);
  recovered=true;
 }
 if(Number(user.profile_bytes)>PROFILE_LIMIT){
  await sql("INSERT INTO mm_user_recovery(user_id,field,value) SELECT id,'profile',profile FROM mm_users WHERE id=$1 ON CONFLICT(user_id,field) DO NOTHING",id);
  await sql("UPDATE mm_users SET profile='{}'::jsonb WHERE id=$1",id);
  log.warn("Oversized user profile moved to recovery",id,user.profile_bytes);
  recovered=true;
 }
 // The uncommon safety-recovery path must return the updated row.
 if(recovered){
  const safe=await sql("SELECT * FROM mm_users WHERE id=$1",id);
  if(!safe.length)throw Error("Telegram account not available after recovery");
  return safe[0];
 }
 const {filters_bytes,profile_bytes,...account}=user;
 return account;
}
