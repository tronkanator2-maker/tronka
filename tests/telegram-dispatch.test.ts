import {test,expect} from "bun:test";
import {dispatchTelegramUpdate} from "../telegram-dispatch.ts";

function fakeUpdate(id=1234){
 return {update_id:id,callback_query:{id:"callback-id",from:{id:42},data:"profile_save"}};
}
test("a failed callback is NOT marked completed and remains retriable",async()=>{
 const writes=[],errors=[];
 const sql=async(q,...args)=>{writes.push({q,args});return []};
 let attempts=0,ackCount=0;
 const deps={
  sql,onMessage:async()=>{},onSourcePost:async()=>{},
  onCallback:async()=>{attempts++;if(attempts===1)throw Error("temporary database timeout")},
  acknowledge:async()=>{ackCount++},
  log:{warn:()=>{},error:(...args)=>errors.push(args)}
 };
 await expect(dispatchTelegramUpdate(fakeUpdate(),deps)).rejects.toThrow("temporary database timeout");
 expect(writes.filter(x=>x.q.includes("INSERT INTO mm_updates"))).toHaveLength(0);
 expect(errors).toHaveLength(1);
 expect(attempts).toBe(1);
 expect(await dispatchTelegramUpdate(fakeUpdate(),deps)).toEqual({duplicate:false});
 expect(writes.filter(x=>x.q.includes("INSERT INTO mm_updates"))).toHaveLength(1);
 expect(attempts).toBe(2);
 expect(ackCount).toBe(2);
});
test("callback acknowledgement errors do not lose the underlying action",async()=>{
 let actionCount=0,warningCount=0,writeCount=0;
 const outcome=await dispatchTelegramUpdate(fakeUpdate(77),{
  sql:async q=>{if(q.includes("INSERT INTO mm_updates"))writeCount++;return []},
  onMessage:async()=>{},onSourcePost:async()=>{},
  onCallback:async()=>{actionCount++},
  acknowledge:async()=>{throw Error("callback query too old")},
  log:{warn:()=>{warningCount++},error:()=>{}}
 });
 expect(outcome).toEqual({duplicate:false});
 expect(actionCount).toBe(1);
 expect(warningCount).toBe(1);
 expect(writeCount).toBe(1);
});
test("idempotently ignores already completed Telegram updates",async()=>{
 let called=0,queried=0;
 const result=await dispatchTelegramUpdate(fakeUpdate(88),{
  sql:async()=>{queried++;return [{id:88}]},
  onMessage:async()=>{called++},onSourcePost:async()=>{called++},
  onCallback:async()=>{called++},acknowledge:async()=>{called++}
 });
 expect(result).toEqual({duplicate:true});
 expect(queried).toBe(1);
 expect(called).toBe(0);
});
test("message processing failures are retried rather than marked complete",async()=>{
 let writes=0;
 const update={update_id:12,message:{from:{id:123},chat:{type:"private"},text:"Имя: Анна"}};
 const deps={
  sql:async q=>{if(q.includes("INSERT INTO mm_updates"))writes++;return []},
  onMessage:async()=>{throw Error("Postgres temporarily offline")},
  onSourcePost:async()=>{},onCallback:async()=>{},acknowledge:async()=>{}
 };
 await expect(dispatchTelegramUpdate(update,deps)).rejects.toThrow("Postgres temporarily offline");
 expect(writes).toBe(0);
});
test("source posts are processed and only then marked completed",async()=>{
 const calls=[],update={update_id:99,channel_post:{message_id:123,chat:{id:-9,type:"channel"},text:"Ищу модель"}};
 const deps={
  sql:async q=>{calls.push(q.includes("INSERT INTO")?"mark":"lookup");return []},
  onMessage:async()=>{calls.push("private")},onSourcePost:async()=>{calls.push("source")},
  onCallback:async()=>{calls.push("callback")},acknowledge:async()=>{}
 };
 expect(await dispatchTelegramUpdate(update,deps)).toEqual({duplicate:false});
 expect(calls).toEqual(["lookup","source","mark"]);
});
test("malformed update ids are rejected before any database work",async()=>{
 let calls=0;
 const deps={
  sql:async()=>{calls++;return []},onMessage:async()=>{},onSourcePost:async()=>{},
  onCallback:async()=>{},acknowledge:async()=>{}
 };
 for(const value of [null,-1,1.1,"2",NaN,Number.MAX_SAFE_INTEGER+1]){
  await expect(dispatchTelegramUpdate({update_id:value},deps)).rejects.toThrow("Invalid Telegram update id");
 }
 expect(calls).toBe(0);
});
