import {test,expect} from "bun:test";
import {exportAccount,deleteAccount} from "../privacy.ts";
test("exports only the requesting user's profile and related tables",async()=>{
 const calls=[];
 const fake=async (q,...args)=>{
  calls.push({q,args});
  if(q.includes("FROM mm_users"))return [{id:17,username:"author",phone:"confirmed-number",profile:{name:"Sample"}}];
  return [];
 };
 const text=await exportAccount(fake,17);
 const archive=JSON.parse(text);
 expect(archive.account.id).toBe(17);
 expect(archive.account.username).toBe("author");
 expect(archive.tickets).toEqual([]);
 expect(calls.some(x=>x.q.includes("message,created_at FROM mm_responses"))).toBe(true);
 expect(calls.every(x=>x.args[0]===17)).toBe(true);
});
test("deletes dependent records before root account, never touches other users",async()=>{
 const calls=[];
 await deleteAccount(async(query,...args)=>{calls.push({query,args});return []},99);
 const asText=calls.map(x=>x.query).join("\n");
 expect(asText).toContain("mm_consent_events");
 expect(asText).toContain("mm_support_messages");
 expect(asText).toContain("mm_reviews");
 expect(asText).toContain("mm_trial_ledger");
 expect(asText).toContain("mm_response_outbox");
 expect(asText).toContain("mm_fanout_queue");
 expect(asText).toContain("mm_relay_usage");
 expect(calls.at(-1).query).toContain("DELETE FROM mm_users WHERE id=$1");
 expect(calls.every(x=>x.args[0]===99)).toBe(true);
});

test("exports recovery copies so users can see their retained profile backups",async()=>{
 const calls=[];
 const sql=async(query,...args)=>{
  calls.push({query,args});
  if(query.startsWith("SELECT * FROM mm_users"))return [{id:18,profile:{},filters:{}}];
  if(query.includes("FROM mm_user_recovery"))return [{field:"profile",value:{"имя":"Анна"},saved_at:"2026-10-22"}];
  return [];
 };
 const report=JSON.parse(await exportAccount(sql,18));
 expect(report.account.id).toBe(18);
 expect(report.recovery).toHaveLength(1);
 expect(report.recovery[0].value["имя"]).toBe("Анна");
 expect(calls.some(c=>c.query.includes("SELECT field,value,saved_at FROM mm_user_recovery WHERE user_id=$1"))).toBe(true);
 expect(calls.every(c=>c.args[0]===18)).toBe(true);
});
test("account deletion erases old support records and oversized JSON recovery",async()=>{
 const statements=[];
 await deleteAccount(async(q,...args)=>{statements.push({q,args});return []},290);
 expect(statements.some(x=>x.q==="DELETE FROM mm_reports WHERE user_id=$1")).toBe(true);
 expect(statements.some(x=>x.q==="DELETE FROM mm_user_recovery WHERE user_id=$1")).toBe(true);
 expect(statements.every(x=>x.args[0]===290)).toBe(true);
 const root=statements.findIndex(x=>x.q==="DELETE FROM mm_users WHERE id=$1");
 for(const type of ["mm_reports","mm_user_recovery","mm_decision_notifications","mm_telegram_update_queue"]){
  expect(statements.findIndex(x=>x.q.startsWith("DELETE FROM "+type))).toBeLessThan(root);
 }
});
test("removes queued private Telegram messages and callbacks before they could recreate the account",async()=>{
 const statements=[];
 await deleteAccount(async(q,...args)=>{statements.push({q,args});return []},9876543210);
 const queue=statements.find(x=>x.q.startsWith("DELETE FROM mm_telegram_update_queue"));
 expect(queue).toBeDefined();
 expect(queue.q).toContain("payload#>>'{message,from,id}'=$2");
 expect(queue.q).toContain("payload#>>'{message,chat,type}'='private'");
 expect(queue.q).toContain("payload#>>'{callback_query,from,id}'=$2");
 expect(queue.q).toContain("payload#>>'{edited_message,from,id}'=$2");
 expect(queue.args).toEqual([9876543210,"9876543210"]);
 expect(statements.every(x=>x.args[0]===9876543210)).toBe(true);
});
test("removes orphan decision notices both to and about deleted participant",async()=>{
 const statements=[];
 await deleteAccount(async(q,...args)=>{statements.push({q,args});return []},290);
 const decision=statements.find(x=>x.q.startsWith("DELETE FROM mm_decision_notifications"));
 expect(decision.q).toContain("recipient_id=$1");
 expect(decision.q).toContain("kind='response_declined'");
 expect(decision.q).toContain("r.user_id=$1 OR j.owner=$1");
 expect(decision.q).toContain("kind IN ('invitation_declined','invitation_cancelled')");
 expect(decision.q).toContain("from_user=$1 OR to_user=$1");
 expect(statements.at(-1).q).toBe("DELETE FROM mm_users WHERE id=$1");
});
