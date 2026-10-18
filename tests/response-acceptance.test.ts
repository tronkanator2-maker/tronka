import {test,expect} from "bun:test";
import {prepareAcceptedResponseOutbox,acceptResponseForOwner,deliverAcceptedResponses} from "../response-acceptance.ts";

test("accepting a response persists status and queues notifications before sending",async()=>{
 const calls=[];
 const sql=async(text,...args)=>{
  calls.push({text,args});
  if(text.includes("UPDATE mm_responses r"))return [{id:17,job_id:42,user_id:99}];
  return [];
 };
 const result=await acceptResponseForOwner(sql,17,55);
 expect(result).toEqual({id:17,jobId:42,userId:99,newlyAccepted:true});
 expect(calls.length).toBe(2);
 expect(calls[0].text).toContain("j.owner=$2");
 expect(calls[0].text).toContain("r.status='pending'");
 expect(calls[0].args).toEqual([17,55]);
 expect(calls[1].text).toContain("ON CONFLICT(response_id) DO NOTHING");
 expect(calls[1].args).toEqual([17]);
});

test("a retry after update succeeded but webhook failed requeues the accepted response",async()=>{
 const calls=[];
 const sql=async(text,...args)=>{
  calls.push({text,args});
  if(text.includes("UPDATE mm_responses r"))return [];
  if(text.includes("SELECT r.id"))return [{id:17,job_id:42,user_id:99}];
  return [];
 };
 expect(await acceptResponseForOwner(sql,17,55)).toEqual({id:17,jobId:42,userId:99,newlyAccepted:false});
 expect(calls.length).toBe(3);
 expect(calls[1].text).toContain("r.status='accepted'");
 expect(calls[1].text).toContain("j.owner=$2");
 expect(calls[2].text).toContain("ON CONFLICT");
});

test("non-owners and invalid callbacks cannot enqueue another user's accepted response",async()=>{
 let calls=0;
 const sql=async text=>{calls++;return []};
 for(const id of [0,-1,NaN,Infinity,"bad",Number.MAX_SAFE_INTEGER+1])
  expect(await acceptResponseForOwner(sql,id,55)).toBeNull();
 expect(await acceptResponseForOwner(sql,1,0)).toBeNull();
 expect(calls).toBe(0);
 expect(await acceptResponseForOwner(sql,17,55)).toBeNull();
 expect(calls).toBe(2);
});

test("worker checks PostgreSQL queue flags and marks each delivered recipient separately",async()=>{
 const sqlStatements=[],sent=[];
 const sql=async(query,...args)=>{
  sqlStatements.push({query,args});
  if(query.includes("FROM mm_accepted_response_outbox o"))return [{
   response_id:17,owner:55,user_id:99,response_status:"accepted",
   owner_notified:false,applicant_notified:false
  }];
  if(query.includes("SELECT id,username FROM mm_users"))return [{id:55,username:"studio_owner"},{id:99,username:"model_anna"}];
  return [];
 };
 const deliver=async(id,text,keyboard)=>{sent.push({id,text,keyboard});return {ok:true}};
 const result=await deliverAcceptedResponses(sql,deliver);
 expect(result).toEqual({processed:1,completed:1,failed:0});
 expect(sent.map(x=>x.id)).toEqual([55,99]);
 expect(sent[0].keyboard.inline_keyboard[0].some(x=>x.callback_data==="relay:99")).toBe(true);
 expect(sent[1].keyboard.inline_keyboard[0].some(x=>x.callback_data==="relay:55")).toBe(true);
 expect(sqlStatements.some(x=>x.query.includes("owner_notified=TRUE"))).toBe(true);
 expect(sqlStatements.some(x=>x.query.includes("applicant_notified=TRUE"))).toBe(true);
 expect(sqlStatements.some(x=>x.query.includes("completed_at=NOW()"))).toBe(true);
});

test("partial Telegram failure retries only the missing person instead of repeating owner notice",async()=>{
 const sent=[],updates=[];
 let phase=0;
 const sql=async(query,...args)=>{
  updates.push(query);
  if(query.includes("FROM mm_accepted_response_outbox o"))return [{
   response_id:17,owner:55,user_id:99,response_status:"accepted",
   owner_notified:phase===1,applicant_notified:false
  }];
  if(query.includes("SELECT id,username"))return [{id:55,username:"valid_user"},{id:99,username:"valid_model"}];
  return [];
 };
 const deliver=async(id)=>{
  sent.push(id);
  if(id===99&&phase===0)return {ok:false,error_code:403};
  return {ok:true};
 };
 const first=await deliverAcceptedResponses(sql,deliver);
 expect(first.failed).toBe(1);
 expect(sent).toEqual([55,99]);
 expect(updates.some(q=>q.includes("next_attempt_at=NOW()"))).toBe(true);
 phase=1;
 const second=await deliverAcceptedResponses(sql,deliver);
 expect(second.completed).toBe(1);
 expect(sent).toEqual([55,99,99]);
});

test("outbox setup enforces durable state and retry scheduling",async()=>{
 const queries=[];
 await prepareAcceptedResponseOutbox(async sql=>{queries.push(sql);return []});
 expect(queries).toHaveLength(2);
 expect(queries[0]).toContain("mm_accepted_response_outbox");
 expect(queries[0]).toContain("ON DELETE CASCADE");
 expect(queries[1]).toContain("WHERE completed_at IS NULL");
});
