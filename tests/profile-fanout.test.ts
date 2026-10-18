import {test,expect} from "bun:test";
import {runProfileFanoutPage} from "../profile-fanout.ts";

test("profile fanout checks only a bounded page and saves each successful cursor",async()=>{
 const calls=[];
 const people=Array.from({length:5},(_,i)=>({id:10+i,photo:"file"}));
 const sql=async(query,...args)=>{
  calls.push({query,args});
  return query.includes("SELECT * FROM mm_users")?people:[];
 };
 const delivered=[];
 const result=await runProfileFanoutPage(sql,{id:7,owner:2},{profile_cursor_id:9,generation:4},async(_job,person)=>delivered.push(person.id));
 expect(result).toEqual({processed:5,done:false});
 expect(delivered).toEqual([10,11,12,13,14]);
 expect(calls[0].args).toEqual([9,2,5]);
 expect(calls[0].query).toContain("ORDER BY id ASC LIMIT $3");
 expect(calls.filter(call=>call.query.includes("profile_cursor_id=$1")).map(call=>call.args)).toEqual([[10,7,4],[11,7,4],[12,7,4],[13,7,4],[14,7,4]]);
 expect(calls.some(call=>call.query.includes("profiles_done=TRUE"))).toBe(false);
});

test("transient Telegram failure leaves the failed candidate for retry",async()=>{
 const calls=[];
 const sql=async(query,...args)=>{
  calls.push({query,args});
  return query.includes("SELECT * FROM mm_users")?[{id:10},{id:11},{id:12}]:[];
 };
 await expect(runProfileFanoutPage(sql,{id:7,owner:2},{profile_cursor_id:9,generation:4},async(_job,person)=>{
  if(person.id===11)throw Error("Telegram 502");
 })).rejects.toThrow("Telegram 502");
 expect(calls.filter(call=>call.query.includes("profile_cursor_id=$1")).map(call=>call.args)).toEqual([[10,7,4]]);
 expect(calls.some(call=>call.query.includes("profiles_done=TRUE"))).toBe(false);
});

test("last short page completes profile phase without revisiting old candidates",async()=>{
 const calls=[];
 const sql=async(query,...args)=>{
  calls.push({query,args});
  return query.includes("SELECT * FROM mm_users")?[{id:16}]:[];
 };
 const result=await runProfileFanoutPage(sql,{id:7,owner:2},{profile_cursor_id:14,generation:4},async()=>{});
 expect(result).toEqual({processed:1,done:true});
 expect(calls[0].args).toEqual([14,2,5]);
 expect(calls.some(call=>call.query.includes("profiles_done=TRUE"))).toBe(true);
 for(const invalid of [0,11,NaN])await expect(runProfileFanoutPage(sql,{id:7,owner:2},{profile_cursor_id:0,generation:4},async()=>{},invalid)).rejects.toThrow("Invalid profile fanout batch size");
});

test("imported jobs skip the owner-profile phase immediately",async()=>{
 const calls=[];
 const sql=async(query,...args)=>{calls.push({query,args});return []};
 const result=await runProfileFanoutPage(sql,{id:8,owner:0},{profile_cursor_id:0,generation:4},async()=>{throw Error("not applicable")});
 expect(result).toEqual({processed:0,done:true});
 expect(calls).toHaveLength(1);
 expect(calls[0].query).toContain("profiles_done=TRUE");
 expect(calls[0].args).toEqual([8,4]);
});
