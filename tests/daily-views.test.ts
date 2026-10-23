import {test,expect} from "bun:test";
import {moscowCalendarDay,prepareDailyViews,claimDailyView,releaseUnsentDailyView,dailyLimitText} from "../daily-views.ts";

function fakeDatabase(limits={job:5,profile:3}){
 const views=new Set(),queries=[];
 const sql=async(query,...args)=>{
  queries.push({query,args});
  if(query.includes("pg_advisory_xact_lock"))return [];
  if(query.includes("SELECT value FROM mm_quota_settings")){
   return [{value:query?limits[args[0]==="free_daily_jobs"?"job":"profile"]:0}];
  }
  if(query.startsWith("SELECT 1 FROM mm_daily_views")){
   const [user,kind,item,day]=args;
   return views.has([user,kind,item,day].join(":"))?[{exists:1}]:[];
  }
  if(query.startsWith("SELECT COUNT(*)")){
   const [user,kind,day]=args;
   return [{n:[...views].filter(key=>key.startsWith(user+":"+kind+":")&&key.endsWith(":"+day)).length}];
  }
  if(query.startsWith("INSERT INTO mm_daily_views")){
   const [user,kind,item,day]=args,key=[user,kind,item,day].join(":");
   if(views.has(key))return [];
   views.add(key);return [{item_id:item}];
  }
  if(query.startsWith("DELETE FROM mm_daily_views")){
   const [user,kind,item,day]=args;views.delete([user,kind,item,day].join(":"));return [];
  }
  return [];
 };
 return {db:{begin:async fn=>fn({unsafe:(q,args)=>sql(q,...args)})},sql,views,queries};
}

test("Moscow midnight resets the day, including cross-UTC-boundary cases",()=>{
 expect(moscowCalendarDay("2026-10-18T20:59:59Z")).toBe("2026-10-18");
 expect(moscowCalendarDay("2026-10-18T21:00:01Z")).toBe("2026-10-19");
 expect(moscowCalendarDay("2026-01-01T00:10:00Z")).toBe("2026-01-01");
 expect(moscowCalendarDay("2026-12-31T22:10:00Z")).toBe("2027-01-01");
 expect(()=>moscowCalendarDay("invalid-date")).toThrow();
});
test("five different jobs use five free slots, reopen never spends a sixth",async()=>{
 const f=fakeDatabase();const at=new Date("2026-10-18T14:00:00Z");
 for(let id=1;id<=5;id++){
  const view=await claimDailyView(f.db,{userId:19,kind:"job",itemId:id,at});
  expect(view.allowed).toBe(true);expect(view.already).toBe(false);
 }
 const sixth=await claimDailyView(f.db,{userId:19,kind:"job",itemId:6,at});
 expect(sixth).toEqual({allowed:false,reason:"limit",limit:5,day:"2026-10-18"});
 expect((await claimDailyView(f.db,{userId:19,kind:"job",itemId:1,at})).already).toBe(true);
 expect(f.views.size).toBe(5);
});
test("three unique profiles are separate from five unique jobs",async()=>{
 const f=fakeDatabase();const at=new Date("2026-10-18T12:00:00Z");
 for(let id=1;id<=3;id++)expect((await claimDailyView(f.db,{userId:33,kind:"profile",itemId:id,at})).allowed).toBe(true);
 expect((await claimDailyView(f.db,{userId:33,kind:"profile",itemId:4,at})).allowed).toBe(false);
 expect((await claimDailyView(f.db,{userId:33,kind:"job",itemId:88,at})).allowed).toBe(true);
 expect(f.views.size).toBe(4);
});
test("tomorrow permits a new item without losing yesterday's audit",async()=>{
 const f=fakeDatabase({job:1,profile:1});
 const one={userId:1,kind:"job",itemId:1,at:new Date("2026-10-18T20:59:00Z")};
 expect((await claimDailyView(f.db,one)).allowed).toBe(true);
 expect((await claimDailyView(f.db,{...one,itemId:2})).allowed).toBe(false);
 expect((await claimDailyView(f.db,{...one,itemId:2,at:new Date("2026-10-18T21:01:00Z")})).allowed).toBe(true);
 expect(f.views.size).toBe(2);
});
test("paid accounts bypass quota and never write viewing records",async()=>{
 const f=fakeDatabase({job:0,profile:0});
 expect((await claimDailyView(f.db,{userId:1,kind:"job",itemId:7,paid:true})).allowed).toBe(true);
 expect(f.queries).toHaveLength(0);
 expect(f.views.size).toBe(0);
});
test("failure before Telegram message can refund a newly claimed view",async()=>{
 const f=fakeDatabase({job:1,profile:1});
 const at=new Date("2026-10-18T14:00:00Z");
 const view=await claimDailyView(f.db,{userId:9,kind:"job",itemId:7,at});
 expect(view.allowed).toBe(true);
 expect(await releaseUnsentDailyView(f.sql,{userId:9,kind:"job",itemId:7,day:view.day})).toBe(true);
 expect((await claimDailyView(f.db,{userId:9,kind:"job",itemId:8,at})).allowed).toBe(true);
 expect(f.views.size).toBe(1);
});
test("invalid view targets never touch SQL; schema is bounded and private",async()=>{
 const f=fakeDatabase();
 for(const args of [
  {userId:0,kind:"job",itemId:1},{userId:1,kind:"job",itemId:0},
  {userId:1,kind:"url",itemId:1},{userId:1,kind:"profile",itemId:1.5},
  {userId:Number.MAX_SAFE_INTEGER+1,kind:"job",itemId:1}
 ])expect((await claimDailyView(f.db,args)).reason).toBe("invalid");
 expect(f.queries.length).toBe(0);
 const schema=[];
 await prepareDailyViews(async query=>{schema.push(query);return []});
 expect(schema).toHaveLength(2);
 expect(schema[0]).toContain("PRIMARY KEY(user_id,kind,item_id,day)");
 expect(schema[0]).toContain("CHECK(kind IN ('job','profile'))");
 expect(dailyLimitText("job",5)).toContain("Москве");
 expect(dailyLimitText("profile",3)).toContain("3");
});
