import {test,expect} from "bun:test";
import {jobVisibilityCallback,parseJobVisibilityAction,setJobVisibility} from "../job-visibility.ts";

test("job list generates explicit pause and resume intents instead of a toggle",()=>{
 expect(jobVisibilityCallback({id:42,paused:false})).toBe("jobpause:42:pause");
 expect(jobVisibilityCallback({id:42,paused:true})).toBe("jobpause:42:resume");
 expect(jobVisibilityCallback({id:0,paused:false})).toBeNull();
 expect(jobVisibilityCallback({id:Number.MAX_SAFE_INTEGER+1,paused:false})).toBeNull();
 expect(parseJobVisibilityAction("jobpause:42:pause")).toEqual({id:42,paused:true});
 expect(parseJobVisibilityAction("jobpause:42:resume")).toEqual({id:42,paused:false});
 for(const invalid of ["jobpause:42","jobpause:42:toggle","jobpause:-1:pause","jobpause:0:resume","jobpause:1.1:pause","jobpause:999999999999999999:pause","jobpause:4:pause:again"]){
  expect(parseJobVisibilityAction(invalid)).toBeNull();
 }
});
test("state change is atomic with durable fanout scheduling on resume",async()=>{
 const calls=[];
 const sql=async(query,...args)=>{calls.push({query,args});return [{id:13,paused:false,owner:9,status:"active"}]};
 const result=await setJobVisibility(sql,9,{id:13,paused:false});
 expect(result).toEqual({status:"changed",paused:false,job:{id:13,paused:false,owner:9,status:"active"}});
 expect(calls).toHaveLength(1);
 expect(calls[0].args).toEqual([13,9,false]);
 expect(calls[0].query).toContain("UPDATE mm_jobs SET paused=$3");
 expect(calls[0].query).toContain("owner=$2");
 expect(calls[0].query).toContain("status='active'");
 expect(calls[0].query).toContain("paused IS DISTINCT FROM $3");
 expect(calls[0].query).toContain("INSERT INTO mm_fanout_queue(job_id)");
 expect(calls[0].query).toContain("SELECT id FROM changed WHERE paused=FALSE");
 expect(calls[0].query).toContain("ON CONFLICT(job_id) DO UPDATE");
 expect(calls[0].query).toContain("generation=mm_fanout_queue.generation+1");
});
test("rapid repeated presses never reverse state or queue duplicate fanout",async()=>{
 let paused=false,fanouts=0;
 const calls=[];
 const sql=async(query,...args)=>{
  calls.push({query,args});
  if(query.includes("WITH changed AS")){
   if(paused===args[2])return [];
   paused=args[2];
   if(paused===false)fanouts++;
   return [{id:77,owner:5,status:"active",paused}];
  }
  return [{id:77,paused}];
 };
 const pause={id:77,paused:true},resume={id:77,paused:false};
 expect((await setJobVisibility(sql,5,pause)).status).toBe("changed");
 expect((await setJobVisibility(sql,5,pause)).status).toBe("already");
 expect(paused).toBe(true);
 expect(fanouts).toBe(0);
 expect((await setJobVisibility(sql,5,resume)).status).toBe("changed");
 expect((await setJobVisibility(sql,5,resume)).status).toBe("already");
 expect(paused).toBe(false);
 expect(fanouts).toBe(1);
 expect(calls.filter(c=>c.query.includes("WITH changed AS"))).toHaveLength(4);
});
test("unknown, closed and other owner's jobs cannot be toggled",async()=>{
 const calls=[];
 const sql=async(query,...args)=>{calls.push({query,args});return []};
 expect(await setJobVisibility(sql,42,{id:4,paused:true})).toEqual({status:"missing"});
 expect(calls).toHaveLength(2);
 expect(calls[0].args).toEqual([4,42,true]);
 expect(calls[1].query).toContain("owner=$2 AND status='active'");
});
test("invalid user, job and desired state are rejected without SQL calls",async()=>{
 let calls=0;
 const sql=async()=>{calls++;return []};
 for(const params of [[0,{id:1,paused:true}],[5,{id:0,paused:true}],[5,{id:1,paused:"true"}],[5,null],[5,{id:Infinity,paused:false}],[5,{id:Number.MAX_SAFE_INTEGER+1,paused:false}]]){
  expect(await setJobVisibility(sql,...params)).toEqual({status:"invalid"});
 }
 expect(calls).toBe(0);
});
test("legacy buttons are not silently interpreted as a request to toggle",()=>{
 expect(parseJobVisibilityAction("jobpause:99")).toBeNull();
});
