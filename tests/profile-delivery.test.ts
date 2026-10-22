import {test,expect} from "bun:test";
import {prepareProfileDeliveryProgress,deliverMatchedProfileProgress} from "../profile-delivery.ts";

const mockDb=(initial=null)=>{
 const calls=[];
 let receipt=initial?{...initial}:null;
 const sql=async(q,...args)=>{
  calls.push({q,args});
  if(q.includes("INSERT INTO mm_profile_deliveries")){
   if(!receipt)receipt={notice_sent:false,media_sent:false,card_sent:false};
   return [];
  }
  if(q.includes("SELECT notice_sent,media_sent,card_sent"))return receipt?[{...receipt}]:[];
  if(q.includes("SET notice_sent=TRUE"))receipt.notice_sent=true;
  if(q.includes("SET media_sent=TRUE"))receipt.media_sent=true;
  if(q.includes("SET card_sent=TRUE"))receipt.card_sent=true;
  return [];
 };
 return {sql,calls,getReceipt:()=>receipt};
};
test("previously completed profile cards are not resent after migration",async()=>{
 const db=mockDb({notice_sent:true,media_sent:true,card_sent:true});
 let sent=0;
 expect(await deliverMatchedProfileProgress(db.sql,300,400,async()=>{sent++;return {ok:true}},async()=>{sent++;return {ok:true}})).toBe(false);
 expect(sent).toBe(0);
 expect(db.calls.filter(x=>x.q.includes("UPDATE mm_profile_deliveries"))).toHaveLength(0);
});
test("fresh match is delivered once and remembers all three phases",async()=>{
 const db=mockDb(),seen=[];
 const notice=async()=>{seen.push("heading");return {ok:true}};
 const card=async({skipMedia,onMediaSent})=>{
  seen.push("skip="+skipMedia);
  if(!skipMedia){seen.push("media");await onMediaSent()}
  seen.push("details");
  return {ok:true};
 };
 expect(await deliverMatchedProfileProgress(db.sql,301,401,notice,card)).toBe(true);
 expect(seen).toEqual(["heading","skip=false","media","details"]);
 expect(db.getReceipt()).toEqual({notice_sent:true,media_sent:true,card_sent:true});
 expect(await deliverMatchedProfileProgress(db.sql,301,401,notice,card)).toBe(false);
 expect(seen).toHaveLength(4);
});
test("after a failed text card, retry skips previously sent header and photos",async()=>{
 const db=mockDb(),seen=[];
 let tries=0;
 const notice=async()=>{seen.push("heading");return {ok:true}};
 const card=async({skipMedia,onMediaSent})=>{
  seen.push("skip="+skipMedia);
  if(!skipMedia){seen.push("media");await onMediaSent()}
  tries++;
  if(tries===1)throw Error("Telegram 502 at card text");
  seen.push("details");
  return {ok:true};
 };
 await expect(deliverMatchedProfileProgress(db.sql,302,402,notice,card)).rejects.toThrow("Telegram 502 at card text");
 expect(db.getReceipt()).toEqual({notice_sent:true,media_sent:true,card_sent:false});
 expect(await deliverMatchedProfileProgress(db.sql,302,402,notice,card)).toBe(true);
 expect(seen).toEqual(["heading","skip=false","media","skip=true","details"]);
});
test("a failed heading is not marked as delivered and retries before card",async()=>{
 const db=mockDb();
 let attempts=0,details=0;
 const notice=async()=>{attempts++;return attempts===1?{ok:false}:{ok:true}};
 const card=async({onMediaSent})=>{details++;await onMediaSent();return {ok:true}};
 await expect(deliverMatchedProfileProgress(db.sql,303,403,notice,card)).rejects.toThrow("heading not delivered");
 expect(details).toBe(0);
 expect(db.getReceipt()).toEqual({notice_sent:false,media_sent:false,card_sent:false});
 expect(await deliverMatchedProfileProgress(db.sql,303,403,notice,card)).toBe(true);
 expect(attempts).toBe(2);
 expect(details).toBe(1);
});
test("two simultaneous fanout workers coalesce one Telegram send in a single process",async()=>{
 const db=mockDb(),events=[];
 const promise1=deliverMatchedProfileProgress(db.sql,304,404,async()=>{
  events.push("heading");
  await new Promise(resolve=>setTimeout(resolve,5));
  return {ok:true};
 },async({onMediaSent})=>{events.push("card");await onMediaSent();return {ok:true}});
 const promise2=deliverMatchedProfileProgress(db.sql,304,404,async()=>{throw Error("duplicate")},async()=>{throw Error("duplicate")});
 expect(await Promise.all([promise1,promise2])).toEqual([true,true]);
 expect(events).toEqual(["heading","card"]);
 expect(db.getReceipt().card_sent).toBe(true);
});
test("invalid job and Telegram recipient IDs never access database",async()=>{
 let calls=0;
 const db=async()=>{calls++;return []};
 for(const [j,u] of [[0,123],[-1,1],[1,0],[1,Infinity],[2,Number.MAX_SAFE_INTEGER+1],[2,"not-a-user"]]){
  await expect(deliverMatchedProfileProgress(db,j,u,async()=>{},async()=>{})).rejects.toThrow("Invalid matched profile ID");
 }
 expect(calls).toBe(0);
});
test("old delivery rows default to completed; fresh inserts explicitly mark stages false",async()=>{
 const statements=[];
 await prepareProfileDeliveryProgress(async q=>{statements.push(q);return []});
 expect(statements).toHaveLength(3);
 for(const field of ["notice_sent","media_sent","card_sent"]){
  expect(statements.some(q=>q.includes("ADD COLUMN IF NOT EXISTS "+field+" BOOLEAN NOT NULL DEFAULT TRUE"))).toBe(true);
 }
 const db=mockDb();
 await deliverMatchedProfileProgress(db.sql,305,405,async()=>({ok:true}),async({onMediaSent})=>{await onMediaSent();return {ok:true}});
 expect(db.calls[0].q).toContain("VALUES($1,$2,FALSE,FALSE,FALSE)");
});
