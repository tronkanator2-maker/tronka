import {test,expect} from "bun:test";
import {prepareProfileRefreshQueue,queueProfileRefresh,runProfileRefreshBatch} from "../profile-refresh.ts";

test("profile refresh is durable and idempotently resets pending work on repeated saves",async()=>{
 const queries=[];
 const sql=async(query,...args)=>{queries.push({query,args});return []};
 await prepareProfileRefreshQueue(sql);
 expect(queries).toHaveLength(2);
 expect(queries[0].query).toContain("REFERENCES mm_users(id) ON DELETE CASCADE");
 expect(queries[0].query).toContain("generation BIGINT");
 expect(queries[1].query).toContain("WHERE pending=TRUE");
 for(const id of [0,-1,NaN,"oops",Number.MAX_SAFE_INTEGER+1])expect(await queueProfileRefresh(sql,id)).toBe(false);
 expect(queries).toHaveLength(2);
 expect(await queueProfileRefresh(sql,1478)).toBe(true);
 expect(queries).toHaveLength(3);
 expect(queries[2].query).toContain("ON CONFLICT(user_id) DO UPDATE");
 expect(queries[2].query).toContain("generation=mm_profile_refresh_queue.generation+1");
 expect(queries[2].args).toEqual([1478]);
});

test("publishing a complete profile delivers only bounded matching batches",async()=>{
 const calls=[];
 const user={user_id:35,id:35,generation:4,phase:"matches",cursor_job_id:0,
  active:true,blocked:false,suspended:false,photo:"file",profile:{"имя":"Анна"},filters:{profileRoles:["модель"]}};
 const sql=async(query,...args)=>{
  calls.push({query,args});
  if(query.includes("FROM mm_profile_refresh_queue q JOIN"))return [user];
  if(query.includes("SELECT * FROM mm_jobs"))return [{id:12,owner:15},{id:20,owner:22}];
  return [];
 };
 const sent=[];
 const r=await runProfileRefreshBatch(sql,async(job,who)=>sent.push(["match",job.id,who.id]),async()=>{throw Error("should not deliverTo")},async()=>true);
 expect(r).toEqual({processed:2,done:false,phase:"matches"});
 expect(sent).toEqual([["match",12,35],["match",20,35]]);
 expect(calls.filter(x=>x.query.includes("SET cursor_job_id=$3"))).toHaveLength(2);
 const listing=calls.find(x=>x.query.includes("SELECT * FROM mm_jobs"));
 expect(listing.args).toEqual([35,0,5]);
 expect(listing.query).toContain("AND owner<>0");
 expect(listing.query).toContain("LIMIT $3");
});

test("refresh transitions from matching owners into job delivery and then completes",async()=>{
 let phase="matches";
 const updates=[];
 const user={user_id:35,id:35,generation:4,phase,cursor_job_id:0,active:true,blocked:false,suspended:false,photo:"file"};
 const sql=async(query)=>{
  if(query.includes("FROM mm_profile_refresh_queue q JOIN"))return [{...user,phase}];
  if(query.includes("SELECT * FROM mm_jobs"))return [];
  updates.push(query);
  return [];
 };
 let r=await runProfileRefreshBatch(sql,async()=>{},async()=>{},async()=>true);
 expect(r).toEqual({processed:0,done:false,next:"jobs"});
 expect(updates.some(x=>x.includes("phase='jobs'"))).toBe(true);
 phase="jobs";
 r=await runProfileRefreshBatch(sql,async()=>{},async()=>{},async()=>true);
 expect(r).toEqual({processed:0,done:true});
 expect(updates.some(x=>x.includes("pending=FALSE,completed_at=NOW()"))).toBe(true);
});

test("job fanout to a matching user never happens synchronously inside the webhook",async()=>{
 const participant={user_id:35,id:35,generation:9,phase:"jobs",cursor_job_id:15,active:true,blocked:false,suspended:false,photo:"x",filters:{city:"Москва"}};
 const sent=[];
 const sql=async query=>{
  if(query.includes("FROM mm_profile_refresh_queue q JOIN"))return [participant];
  if(query.includes("SELECT * FROM mm_jobs"))return [{id:16},{id:17}];
  return [];
 };
 const r=await runProfileRefreshBatch(sql,async()=>{throw Error("should not send matched profile")},async(user,job)=>sent.push([user.id,job.id]),async()=>true);
 expect(r.processed).toBe(2);
 expect(r.phase).toBe("jobs");
 expect(sent).toEqual([[35,16],[35,17]]);
});

test("a transient Telegram error saves a retry cursor without acknowledging the failed job",async()=>{
 const log=[],user={user_id:35,id:35,generation:4,phase:"matches",cursor_job_id:13,active:true,blocked:false,suspended:false,photo:"photo"};
 const sql=async query=>{
  log.push(query);
  if(query.includes("FROM mm_profile_refresh_queue q JOIN"))return [user];
  if(query.includes("SELECT * FROM mm_jobs"))return [{id:14,owner:55}];
  return [];
 };
 const r=await runProfileRefreshBatch(sql,async()=>{throw Error("Telegram 502")},async()=>{},async()=>true);
 expect(r).toEqual({processed:0,done:false,retry:true});
 expect(log.some(x=>x.includes("next_attempt_at=NOW()+make_interval"))).toBe(true);
 expect(log.some(x=>x.includes("SET cursor_job_id=$3"))).toBe(false);
});

test("blocked, incomplete or inactive user profiles produce no public notifications",async()=>{
 for(const disabled of [{active:false,blocked:false,suspended:false,photo:"file"}, {active:true,blocked:true,suspended:false,photo:"file"}, {active:true,blocked:false,suspended:false,photo:null}]){
  let sent=0,updates=[];
  const sql=async q=>{
   if(q.includes("FROM mm_profile_refresh_queue q JOIN"))return [{user_id:3,id:3,generation:2,phase:"matches",cursor_job_id:0,...disabled}];
   updates.push(q);
   return [];
  };
  const r=await runProfileRefreshBatch(sql,async()=>{sent++},async()=>{sent++},async()=>true);
  expect(r.done).toBe(true);
  expect(sent).toBe(0);
  expect(updates.some(q=>q.includes("pending=FALSE"))).toBe(true);
 }
});

test("worker caps per-tick job count at ten and rejects unbounded batches",async()=>{
 const sql=async()=>[];
 for(const n of [-1,0,11,Infinity,NaN])await expect(runProfileRefreshBatch(sql,async()=>{},async()=>{},async()=>true,n)).rejects.toThrow("Invalid profile refresh batch size");
 expect(await runProfileRefreshBatch(sql,async()=>{},async()=>{},async()=>true,10)).toEqual({processed:0,done:true});
});
