import {test,expect} from "bun:test";
import {loadTelegramUser} from "../telegram-user.ts";

test("normal Telegram callback needs one SQL round trip, not three",async()=>{
 const calls=[];
 const from={id:123456789,username:"model_lera",first_name:"Лера"};
 const row={id:123456789,username:"model_lera",first_name:"Лера",blocked:false,active:true,filters:{city:"Москва"},profile:{"имя":"Лера"},filters_bytes:128,profile_bytes:256};
 const sql=async(query,...args)=>{calls.push({query,args});return [row]};
 const user=await loadTelegramUser(sql,from);
 expect(user).toEqual({id:123456789,username:"model_lera",first_name:"Лера",blocked:false,active:true,filters:{city:"Москва"},profile:{"имя":"Лера"}});
 expect(calls).toHaveLength(1);
 expect(calls[0].query).toContain("ON CONFLICT(id) DO UPDATE");
 expect(calls[0].query).toContain("RETURNING *,octet_length(filters::text)");
 expect(calls[0].args).toEqual([123456789,"model_lera","Лера"]);
});
test("account flags, consents, draft and photos survive account loading intact",async()=>{
 const row={id:42,filters:{profileDraft:{"имя":"Маша"},jobWizardDraft:{"город":"Москва"}},consent:{offer:true},
  blocked:true,suspended:true,photo:"telegram-photo",photos:["telegram-photo"],state:"job_wizard",trial_until:"2026-10-26",
  filters_bytes:500,profile_bytes:900};
 const user=await loadTelegramUser(async()=>[row],{id:42});
 expect(user.filters).toEqual(row.filters);
 expect(user.consent).toEqual(row.consent);
 expect(user.blocked).toBe(true);
 expect(user.state).toBe("job_wizard");
 expect(user.photos).toEqual(["telegram-photo"]);
 expect(user).not.toHaveProperty("filters_bytes");
 expect(user).not.toHaveProperty("profile_bytes");
});
test("oversized filters are backed up before clearing and returned as corrected data",async()=>{
 const calls=[],warn=[];
 const sql=async(q,...args)=>{
  calls.push({q,args});
  if(q.includes("INSERT INTO mm_users"))return [{id:52,filters_bytes:131073,profile_bytes:3,filters:{massive:true},profile:{name:"Ann"},state:"job_wizard"}];
  if(q.includes("SELECT * FROM mm_users"))return [{id:52,filters:{},profile:{name:"Ann"},state:""}];
  return [];
 };
 const user=await loadTelegramUser(sql,{id:52},{warn:(...args)=>warn.push(args)});
 expect(user.filters).toEqual({});
 expect(user.profile).toEqual({name:"Ann"});
 expect(user.state).toBe("");
 expect(calls.map(c=>c.q)).toEqual(expect.arrayContaining([
  "INSERT INTO mm_user_recovery(user_id,field,value) SELECT id,'filters',filters FROM mm_users WHERE id=$1 ON CONFLICT(user_id,field) DO NOTHING",
  "UPDATE mm_users SET filters='{}'::jsonb,state='' WHERE id=$1"
 ]));
 expect(calls).toHaveLength(4);
 expect(warn).toHaveLength(1);
});
test("oversized profile is archived while filters and draft are preserved",async()=>{
 const log=[];
 const sql=async q=>{
  log.push(q);
  if(q.includes("INSERT INTO mm_users"))return [{id:99,filters_bytes:60,profile_bytes:262145}];
  if(q.includes("SELECT * FROM mm_users"))return [{id:99,filters:{profileDraft:{name:"test"}},profile:{}}];
  return [];
 };
 const u=await loadTelegramUser(sql,{id:99});
 expect(u.filters.profileDraft.name).toBe("test");
 expect(u.profile).toEqual({});
 expect(log.some(q=>q.includes("SELECT id,'profile',profile"))).toBe(true);
 expect(log.some(q=>q.includes("SET profile='{}'::jsonb"))).toBe(true);
 expect(log.some(q=>q.includes("SET filters='{}'::jsonb"))).toBe(false);
});
test("invalid IDs and incomplete upserts do not produce ghost accounts",async()=>{
 let called=0;
 const sql=async()=>{called++;return []};
 for(const id of [0,-1,1.5,Infinity,NaN,Number.MAX_SAFE_INTEGER+1,"somebody"])
  await expect(loadTelegramUser(sql,{id})).rejects.toThrow("Invalid Telegram user id");
 expect(called).toBe(0);
 await expect(loadTelegramUser(sql,{id:34})).rejects.toThrow("upsert returned no user");
 expect(called).toBe(1);
});
