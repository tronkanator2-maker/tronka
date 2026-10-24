import {test,expect} from "bun:test";
import {prepareTrialReminders,trialRemindersEnabled,trialReminderText,trialReminderControls,muteTrialReminders,queueDueTrialReminders,deliverTrialReminders} from "../trial-reminders.ts";

test("trial reminders disabled until checkout is real and bot is no longer in sandbox",()=>{
 expect(trialRemindersEnabled({})).toBe(false);
 expect(trialRemindersEnabled({TRIAL_REMINDERS_ENABLED:"true"})).toBe(false);
 expect(trialRemindersEnabled({TRIAL_REMINDERS_ENABLED:"true",PAYMENTS_ENABLED:"true",TEST_MODE:"true"})).toBe(false);
 expect(trialRemindersEnabled({TRIAL_REMINDERS_ENABLED:"true",PAYMENTS_ENABLED:"true",TEST_MODE:"false"})).toBe(true);
});
test("two approved reminders have correct order, no invented checkout URL or false charges",()=>{
 expect(trialReminderText(3)).toContain("три дня");
 expect(trialReminderText(1)).toContain("Завтра");
 expect(trialReminderText(3)).toContain("бесплатного доступа");
 expect(trialReminderText(3)).not.toContain("списано");
 expect(trialReminderControls(3).inline_keyboard[0][0].callback_data).toBe("access_info");
 expect(trialReminderControls(3).inline_keyboard[1][0].callback_data).toBe("trial:mute");
 expect(trialReminderControls(1).inline_keyboard).toHaveLength(1);
 expect(()=>trialReminderText(0)).toThrow();
});
test("opt-out changes only reminder preference, preserving signed legal consent fields",async()=>{
 const calls=[];
 const sql=async(query,...args)=>{calls.push({query,args});return [{id:51}]};
 expect(await muteTrialReminders(sql,51)).toBe(true);
 expect(calls[0].query).toContain("jsonb_set");
 expect(calls[0].query).toContain("trial_reminders_muted");
 expect(calls[0].query).not.toContain("SET consent='{}'");
 expect(calls[0].args).toEqual([51]);
 expect(await muteTrialReminders(sql,-1)).toBe(false);
 expect(calls).toHaveLength(1);
});
test("due reminder queue requires actual trial, avoids muted/paid/blocked accounts, and deduplicates by stage",async()=>{
 const queries=[];
 const sql=async q=>{queries.push(q);return [{user_id:10},{user_id:11}]};
 expect(await queueDueTrialReminders(sql)).toBe(2);
 expect(queries[0]).toContain("CROSS JOIN (VALUES(3),(1))");
 expect(queries[0]).toContain("u.trial_until>NOW()");
 expect(queries[0]).toContain("u.access_until<=NOW()");
 expect(queries[0]).toContain("u.blocked=FALSE");
 expect(queries[0]).toContain("u.suspended=FALSE");
 expect(queries[0]).toContain("trial_reminders_muted");
 expect(queries[0]).toContain("ON CONFLICT(user_id,days_before) DO NOTHING");
});
test("success marks the exact stage sent and does not send it again",async()=>{
 const calls=[],messages=[];
 const sql=async(query,...args)=>{
  calls.push({query,args});
  if(query.includes("WITH due AS"))return [{user_id:88,days_before:3}];
  if(query.includes("FROM mm_users WHERE id=$1"))return [{
   id:88,active:true,blocked:false,suspended:false,consent:{},
   trial_until:new Date(Date.now()+2*86400000).toISOString(),access_until:null
  }];
  return [];
 };
 const result=await deliverTrialReminders(sql,async (id,message,keyboard)=>{
  messages.push({id,message,keyboard});return {ok:true}
 });
 expect(result).toEqual({processed:1,delivered:1,skipped:0,failed:0});
 expect(messages[0].id).toBe(88);
 expect(messages[0].keyboard.inline_keyboard[1][0].callback_data).toBe("trial:mute");
 expect(calls.some(x=>x.query.includes("sent_at=NOW(),completed_at=NOW()"))).toBe(true);
 expect(calls[0].query).toContain("FOR UPDATE SKIP LOCKED");
});
test("disabled, blocked or already-paid users are not notified even if queued earlier",async()=>{
 for(const options of [
  {blocked:true},{suspended:true},{active:false},
  {consent:{trial_reminders_muted:true}},
  {access_until:new Date(Date.now()+3*86400000).toISOString()},
  {trial_until:new Date(Date.now()-86400000).toISOString()},
 ]){
  let messages=0,completed=false;
  const sql=async query=>{
   if(query.includes("WITH due AS"))return [{user_id:90,days_before:1}];
   if(query.includes("FROM mm_users WHERE id=$1"))return [{
    id:90,active:true,blocked:false,suspended:false,consent:{},
    trial_until:new Date(Date.now()+36000000).toISOString(),access_until:null,...options
   }];
   if(query.includes("completed_at=NOW()"))completed=true;
   return [];
  };
  const result=await deliverTrialReminders(sql,async()=>{messages++;return {ok:true}});
  expect(result.skipped).toBe(1);
  expect(messages).toBe(0);
  expect(completed).toBe(true);
 }
});
test("Telegram 500 keeps reminder pending with exponential backoff",async()=>{
 const calls=[],warnings=[];
 const oldWarn=console.warn;console.warn=(...args)=>warnings.push(args);
 try{
 const sql=async(query,...args)=>{
  calls.push({query,args});
  if(query.includes("WITH due AS"))return [{user_id:93,days_before:1}];
  if(query.includes("FROM mm_users WHERE id=$1"))return [{
   id:93,active:true,blocked:false,suspended:false,consent:{},
   trial_until:new Date(Date.now()+12*3600000).toISOString()
  }];
  return [];
 };
 const result=await deliverTrialReminders(sql,async()=>({ok:false,error_code:500}));
 expect(result).toEqual({processed:1,delivered:0,skipped:0,failed:1});
 expect(calls.some(x=>x.query.includes("attempts=attempts+1"))).toBe(true);
 expect(calls.some(x=>x.query.includes("sent_at=NOW()"))).toBe(false);
 expect(warnings).toHaveLength(1);
 }finally{console.warn=oldWarn}
});
test("schema makes stages independently idempotent and queue worker limits batch size",async()=>{
 const q=[];
 await prepareTrialReminders(async query=>{q.push(query);return []});
 expect(q).toHaveLength(2);
 expect(q[0]).toContain("PRIMARY KEY(user_id,days_before)");
 expect(q[0]).toContain("CHECK(days_before IN (1,3))");
 for(const bad of [0,21,-1,Infinity,1.5])await expect(deliverTrialReminders(async()=>[],async()=>{},bad)).rejects.toThrow();
});
