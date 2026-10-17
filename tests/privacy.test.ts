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
 expect(calls.at(-1).query).toContain("DELETE FROM mm_users WHERE id=$1");
 expect(calls.every(x=>x.args[0]===99)).toBe(true);
});
