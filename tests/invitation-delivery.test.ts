import {test,expect} from "bun:test";
import {prepareInvitationOutbox,queueInitialInvitation,deliverPendingInvitations} from "../invitation-delivery.ts";

test("invitations are queued idempotently without Telegram calls on the webhook",async()=>{
 const statements=[];
 const sql=async(q,...args)=>{statements.push({q,args});return []};
 expect(await queueInitialInvitation(sql,71)).toBe(true);
 expect(statements).toHaveLength(1);
 expect(statements[0].q).toContain("ON CONFLICT(invitation_id) DO NOTHING");
 expect(statements[0].args).toEqual([71]);
 for(const id of [0,-1,NaN,"junk",Number.MAX_SAFE_INTEGER+1])expect(await queueInitialInvitation(sql,id)).toBe(false);
 expect(statements).toHaveLength(1);
});

test("initial delivery sends greeting, profile and controls in order",async()=>{
 const calls=[],queries=[],people=[
  {id:11,username:"valid_user",active:true,blocked:false,suspended:false,profile:{"имя":"Анна"},photo:"some"},
  {id:22,username:"valid_peer",active:true,blocked:false,suspended:false,profile:{"имя":"Никита"},photo:"some"}
 ];
 const sql=async(q)=>{
  queries.push(q);
  if(q.includes("FROM mm_invitation_outbox o"))return [{invitation_id:72,from_user:11,to_user:22,invitation_status:"sent",step:0}];
  if(q.includes("SELECT * FROM mm_users"))return people;
  return [];
 };
 const send=async(to,text,actions)=>{calls.push({type:"message",to,text,actions});return {ok:true}};
 const profile=async(to,sender)=>{calls.push({type:"profile",to,sender:sender.id});return {ok:true}};
 const safety=async u=>{calls.push({type:"safety",to:u.id});return true};
 const r=await deliverPendingInvitations(sql,send,profile,async()=>true,safety);
 expect(r).toEqual({processed:1,completed:1,failed:0});
 expect(calls.map(x=>x.type)).toEqual(["message","profile","message","safety"]);
 expect(calls[0].to).toBe(22);
 expect(calls[1].sender).toBe(11);
 expect(calls[2].actions.inline_keyboard[0].map(x=>x.callback_data)).toEqual(["acceptinvite:72","rejectinvite:72"]);
 expect(queries.some(q=>q.includes("step=1"))).toBe(true);
 expect(queries.some(q=>q.includes("step=2"))).toBe(true);
 expect(queries.some(q=>q.includes("completed_at=NOW(),step=3"))).toBe(true);
});

test("Telegram failure at profile stage resumes without resending the greeting",async()=>{
 const calls=[];
 let phase=0;
 const sql=async q=>{
  if(q.includes("FROM mm_invitation_outbox o"))return [{invitation_id:72,from_user:11,to_user:22,invitation_status:"sent",step:phase===0?0:1}];
  if(q.includes("SELECT * FROM mm_users"))return [{id:11},{id:22}];
  calls.push({type:"query",sql:q});
  return [];
 };
 const send=async()=>{calls.push({type:"message"});return {ok:true}};
 const profile=async()=>{
  calls.push({type:"profile"});
  return phase===0?{ok:false}:{ok:true};
 };
 const first=await deliverPendingInvitations(sql,send,profile,async()=>true);
 expect(first.failed).toBe(1);
 expect(calls.filter(x=>x.type==="message")).toHaveLength(1);
 expect(calls.some(x=>x.sql?.includes("next_attempt_at=NOW()"))).toBe(true);
 phase=1;
 const next=await deliverPendingInvitations(sql,send,profile,async()=>true);
 expect(next.completed).toBe(1);
 expect(calls.filter(x=>x.type==="message")).toHaveLength(2);
 expect(calls.filter(x=>x.type==="profile")).toHaveLength(2);
});

test("cancelled, declined or already accepted invitations never receive stale action buttons",async()=>{
 for(const status of ["cancelled","declined","accepted"]){
  let sent=0;
  const sql=async q=>{
   if(q.includes("FROM mm_invitation_outbox o"))return [{invitation_id:72,invitation_status:status}];
   return [];
  };
  const done=await deliverPendingInvitations(sql,async()=>{sent++;return {ok:true}},async()=>{sent++;return {ok:true}},async()=>true);
  expect(done.completed).toBe(1);
  expect(sent).toBe(0);
 }
});

test("invitation is cancelled when a participant withdraws their profile",async()=>{
 let count=0;
 const statements=[];
 const sql=async q=>{
  statements.push(q);
  if(q.includes("FROM mm_invitation_outbox o"))return [{invitation_id:72,from_user:11,to_user:22,invitation_status:"sent",step:0}];
  if(q.includes("SELECT * FROM mm_users"))return [{id:11},{id:22}];
  return [];
 };
 const done=await deliverPendingInvitations(sql,async()=>{count++;return {ok:true}},async()=>{count++;return {ok:true}},async()=>false);
 expect(done.completed).toBe(1);
 expect(count).toBe(0);
 expect(statements.some(q=>q.includes("status='cancelled'"))).toBe(true);
});

test("initial invitation table and ready index are created before workers run",async()=>{
 const statements=[];
 await prepareInvitationOutbox(async q=>{statements.push(q);return []});
 expect(statements).toHaveLength(2);
 expect(statements[0]).toContain("REFERENCES mm_invitations");
 expect(statements[1]).toContain("completed_at IS NULL");
});
