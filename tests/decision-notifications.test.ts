import {test,expect} from "bun:test";
import {prepareDecisionNotifications,updateCollaborationDecision,decisionNotice,deliverDecisionNotifications} from "../decision-notifications.ts";

test("owner decline of an open response queues status notification after database update",async()=>{
 const executed=[];
 const sql=async(q,...args)=>{
  executed.push({q,args});
  if(q.includes("UPDATE mm_responses r"))return [{id:42,recipient_id:201}];
  return [];
 };
 expect(await updateCollaborationDecision(sql,"response_declined",42,100)).toEqual({
  kind:"response_declined",id:42,recipientId:201,newlyChanged:true
 });
 expect(executed).toHaveLength(2);
 expect(executed[0].q).toContain("j.owner=$2");
 expect(executed[0].q).toContain("r.status='pending'");
 expect(executed[0].args).toEqual([42,100]);
 expect(executed[1].q).toContain("ON CONFLICT(kind,entity_id) DO NOTHING");
 expect(executed[1].args).toEqual(["response_declined",42,201]);
});
test("declined response can restore notification after crash between commit and enqueue",async()=>{
 const calls=[];
 const sql=async(q)=>{
  calls.push(q);
  if(q.includes("UPDATE mm_responses"))return [];
  if(q.includes("SELECT r.id"))return [{id:99,recipient_id:300}];
  return [];
 };
 expect(await updateCollaborationDecision(sql,"response_declined",99,100)).toEqual({
  kind:"response_declined",id:99,recipientId:300,newlyChanged:false
 });
 expect(calls).toHaveLength(3);
 expect(calls[1]).toContain("r.status='declined'");
 expect(calls[1]).toContain("j.owner=$2");
 expect(calls[2]).toContain("ON CONFLICT");
});
test("rejecting and cancelling invites verify opposite authorized actors",async()=>{
 for(const [kind,actorKey,peerKey,status] of [
  ["invitation_declined","to_user","from_user","declined"],
  ["invitation_cancelled","from_user","to_user","cancelled"]
 ]){
  const calls=[];
  const sql=async(q,...args)=>{calls.push({q,args});if(q.includes("UPDATE mm_invitations"))return [{id:12,recipient_id:800}];return []};
  expect(await updateCollaborationDecision(sql,kind,12,700)).toEqual({
   kind,id:12,recipientId:800,newlyChanged:true
  });
  expect(calls[0].q).toContain(actorKey+"=$2");
  expect(calls[0].q).toContain("status='sent'");
  expect(calls[0].q).toContain(peerKey+" AS recipient_id");
  expect(calls[0].args).toEqual([12,700,status]);
  expect(calls[1].args).toEqual([kind,12,800]);
 }
});
test("previously declined invitation can safely be requeued without changing status",async()=>{
 const sql=async(q)=>{
  if(q.includes("UPDATE mm_invitations"))return [];
  if(q.includes("SELECT id,to_user"))return [{id:13,recipient_id:502}];
  return [];
 };
 expect(await updateCollaborationDecision(sql,"invitation_cancelled",13,50)).toEqual({
  kind:"invitation_cancelled",id:13,recipientId:502,newlyChanged:false
 });
});
test("invalid actions and strangers cannot insert outbox records",async()=>{
 let calls=0;
 const sql=async()=>{calls++;return []};
 for(const kind of ["unknown","response_accepted","",null]){
  expect(await updateCollaborationDecision(sql,kind,14,50)).toBeNull();
 }
 for(const id of [-1,0,1.2,NaN,Number.MAX_SAFE_INTEGER+1]){
  expect(await updateCollaborationDecision(sql,"response_declined",id,50)).toBeNull();
 }
 expect(calls).toBe(0);
 expect(await updateCollaborationDecision(sql,"response_declined",14,50)).toBeNull();
 expect(calls).toBe(2);
});
test("status notices never expose direct Telegram contacts",()=>{
 expect(decisionNotice("response_declined",4)).toContain("отклонён");
 expect(decisionNotice("invitation_declined",5)).toContain("Контакты не раскрывались");
 expect(decisionNotice("invitation_cancelled",5)).toContain("отменено отправителем");
 expect(decisionNotice("invalid",4)).toBeNull();
});
test("worker atomically claims rows, delivers notices and records completion",async()=>{
 const calls=[],messages=[];
 const sql=async(q,...args)=>{
  calls.push({q,args});
  if(q.includes("WITH due AS"))return [{kind:"response_declined",entity_id:41,recipient_id:75}];
  if(q.includes("SELECT id,blocked,suspended"))return [{id:75,blocked:false,suspended:false}];
  return [];
 };
 const result=await deliverDecisionNotifications(sql,async(id,msg)=>{messages.push({id,msg});return {ok:true}});
 expect(result).toEqual({processed:1,completed:1,failed:0});
 expect(messages).toHaveLength(1);
 expect(messages[0].id).toBe(75);
 expect(calls[0].q).toContain("FOR UPDATE SKIP LOCKED");
 expect(calls[0].q).toContain("locked_until");
 expect(calls[0].args).toEqual([5]);
 expect(calls.some(c=>c.q.includes("completed_at=NOW(),locked_until=NULL"))).toBe(true);
});
test("unsent notice is retried with backoff, not mistakenly marked sent",async()=>{
 const calls=[];
 const sql=async(q)=>{
  calls.push(q);
  if(q.includes("WITH due AS"))return [{kind:"invitation_declined",entity_id:18,recipient_id:25}];
  if(q.includes("SELECT id,blocked,suspended"))return [{id:25,blocked:false,suspended:false}];
  return [];
 };
 const result=await deliverDecisionNotifications(sql,async()=>({ok:false,error_code:502}));
 expect(result).toEqual({processed:1,completed:0,failed:1});
 expect(calls.some(q=>q.includes("attempts=attempts+1"))).toBe(true);
 expect(calls.some(q=>q.includes("completed_at=NOW(),locked_until=NULL"))).toBe(false);
});
test("deleted or restricted recipients are never messaged",async()=>{
 for(const recipient of [undefined,{id:15,blocked:true,suspended:false},{id:15,blocked:false,suspended:true}]){
  let attempts=0;
  const sql=async q=>{
   if(q.includes("WITH due AS"))return [{kind:"response_declined",entity_id:1,recipient_id:15}];
   if(q.includes("SELECT id,blocked,suspended"))return recipient?[recipient]:[];
   return [];
  };
  const result=await deliverDecisionNotifications(sql,async()=>{attempts++;return {ok:true}});
  expect(result.completed).toBe(1);
  expect(attempts).toBe(0);
 }
});
test("queue schema and batch sizes are bounded",async()=>{
 const commands=[];
 await prepareDecisionNotifications(async q=>{commands.push(q);return []});
 expect(commands).toHaveLength(2);
 expect(commands[0]).toContain("PRIMARY KEY(kind,entity_id)");
 expect(commands[0]).toContain("invitation_cancelled");
 for(const limit of [0,-1,21,Infinity,1.1]){
  await expect(deliverDecisionNotifications(async()=>[],async()=>{},limit)).rejects.toThrow("Invalid decision notification batch size");
 }
});
