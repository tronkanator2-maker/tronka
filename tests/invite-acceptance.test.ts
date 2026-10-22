import {test,expect} from "bun:test";
import {prepareAcceptedInvitationOutbox,acceptInvitationForRecipient,deliverAcceptedInvitations} from "../invite-acceptance.ts";

test("only the invitation recipient can accept and enqueue an active sender's invite",async()=>{
 const queries=[];
 const sql=async(statement,...args)=>{
  queries.push({statement,args});
  if(statement.includes("UPDATE mm_invitations i"))return [{id:7,from_user:11,to_user:22}];
  return [];
 };
 expect(await acceptInvitationForRecipient(sql,7,22)).toEqual({id:7,fromUser:11,toUser:22,newlyAccepted:true});
 expect(queries).toHaveLength(2);
 expect(queries[0].statement).toContain("i.to_user=$2");
 expect(queries[0].statement).toContain("i.status='sent'");
 expect(queries[0].statement).toContain("s.blocked=FALSE");
 expect(queries[0].statement).toContain("s.suspended=FALSE");
 expect(queries[0].args).toEqual([7,22]);
 expect(queries[1].statement).toContain("ON CONFLICT(invitation_id) DO NOTHING");
});

test("an already-accepted invite recovers queued notifications after a webhook timeout",async()=>{
 const queries=[];
 const sql=async(statement)=>{
  queries.push(statement);
  if(statement.includes("UPDATE mm_invitations i"))return [];
  if(statement.includes("SELECT i.id"))return [{id:7,from_user:11,to_user:22}];
  return [];
 };
 expect(await acceptInvitationForRecipient(sql,7,22)).toEqual({id:7,fromUser:11,toUser:22,newlyAccepted:false});
 expect(queries).toHaveLength(3);
 expect(queries[1]).toContain("i.to_user=$2");
 expect(queries[1]).toContain("i.status='accepted'");
 expect(queries[2]).toContain("ON CONFLICT");
});

test("other users and malformed invitation actions cannot create notification jobs",async()=>{
 let calls=0;
 const sql=async()=>{calls++;return []};
 for(const id of [0,-1,NaN,Infinity,"not-id",Number.MAX_SAFE_INTEGER+1])
  expect(await acceptInvitationForRecipient(sql,id,22)).toBeNull();
 expect(await acceptInvitationForRecipient(sql,7,0)).toBeNull();
 expect(calls).toBe(0);
 expect(await acceptInvitationForRecipient(sql,7,22)).toBeNull();
 expect(calls).toBe(2);
});

test("worker sends both collaboration invitations and records delivery checkpoints",async()=>{
 const queries=[],sent=[];
 const sql=async(q)=>{
  queries.push(q);
  if(q.includes("FROM mm_accepted_invitation_outbox o"))
   return [{invitation_id:7,from_user:11,to_user:22,invitation_status:"accepted",sender_notified:false,recipient_notified:false}];
  if(q.includes("SELECT id,username,blocked,suspended"))
   return [{id:11,username:"studio_1",blocked:false,suspended:false},{id:22,username:"model_2",blocked:false,suspended:false}];
  return [];
 };
 const deliver=async(id,body,markup)=>{sent.push({id,body,markup});return {ok:true}};
 const result=await deliverAcceptedInvitations(sql,deliver);
 expect(result).toEqual({processed:1,completed:1,failed:0});
 expect(sent.map(x=>x.id)).toEqual([11,22]);
 expect(sent[0].markup.inline_keyboard[0].some(x=>x.callback_data==="relay:22")).toBe(true);
 expect(sent[1].markup.inline_keyboard[0].some(x=>x.callback_data==="relay:11")).toBe(true);
 expect(queries.some(x=>x.includes("sender_notified=TRUE"))).toBe(true);
 expect(queries.some(x=>x.includes("recipient_notified=TRUE"))).toBe(true);
 expect(queries.some(x=>x.includes("completed_at=NOW()"))).toBe(true);
});

test("only the recipient is retried when sender already received their notification",async()=>{
 let first=true;
 const sent=[],calls=[];
 const sql=async(q)=>{
  calls.push(q);
  if(q.includes("FROM mm_accepted_invitation_outbox o"))
   return [{invitation_id:7,from_user:11,to_user:22,invitation_status:"accepted",sender_notified:!first,recipient_notified:false}];
  if(q.includes("SELECT id,username,blocked,suspended"))
   return [{id:11,username:"studio_1",blocked:false,suspended:false},{id:22,username:"model_2",blocked:false,suspended:false}];
  return [];
 };
 const deliver=async(id)=>{
  sent.push(id);
  if(first&&id===22)return {ok:false,error_code:403};
  return {ok:true};
 };
 const failed=await deliverAcceptedInvitations(sql,deliver);
 expect(failed.failed).toBe(1);
 expect(sent).toEqual([11,22]);
 expect(calls.some(q=>q.includes("next_attempt_at=NOW()"))).toBe(true);
 first=false;
 const recovered=await deliverAcceptedInvitations(sql,deliver);
 expect(recovered.completed).toBe(1);
 expect(sent).toEqual([11,22,22]);
});

test("deleted or blocked parties are never sent direct-contact buttons",async()=>{
 let deliveries=0;
 const sql=async(q)=>{
  if(q.includes("FROM mm_accepted_invitation_outbox o"))
   return [{invitation_id:7,from_user:11,to_user:22,invitation_status:"accepted",sender_notified:false,recipient_notified:false}];
  if(q.includes("SELECT id,username,blocked,suspended"))
   return [{id:11,username:"studio_1",blocked:true,suspended:false},{id:22,username:"model_2",blocked:false,suspended:false}];
  return [];
 };
 const r=await deliverAcceptedInvitations(sql,async()=>{deliveries++;return {ok:true}});
 expect(r.completed).toBe(1);
 expect(deliveries).toBe(0);
});

test("invitation outbox table and pending index are created at setup",async()=>{
 const commands=[];
 await prepareAcceptedInvitationOutbox(async q=>{commands.push(q);return []});
 expect(commands).toHaveLength(2);
 expect(commands[0]).toContain("ON DELETE CASCADE");
 expect(commands[1]).toContain("completed_at IS NULL");
});

test("invitation acceptance checks both accounts for blocked and suspended statuses",async()=>{
 const queries=[];
 const sql=async (query,...args)=>{queries.push({query,args});return []};
 expect(await acceptInvitationForRecipient(sql,37,44)).toBeNull();
 expect(queries.length).toBe(2);
 const active=queries[0].query;
 expect(active).toContain("s.id=i.from_user AND s.blocked=FALSE AND s.suspended=FALSE");
 expect(active).toContain("recipient.id=i.to_user AND recipient.blocked=FALSE AND recipient.suspended=FALSE");
 expect(active).toContain("i.to_user=$2");
 const retry=queries[1].query;
 expect(retry).toContain("sender.blocked=FALSE");
 expect(retry).toContain("recipient.blocked=FALSE");
 expect(retry).toContain("sender.suspended=FALSE");
 expect(retry).toContain("recipient.suspended=FALSE");
});
