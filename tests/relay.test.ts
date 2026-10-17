import {test,expect} from "bun:test";
import {relayAuthorized,consumeRelayQuota} from "../relay.ts";
test("relay refuses invalid and self-recipient IDs without touching database",async()=>{
 let calls=0;const sql=async()=>{calls++;return [{allowed:true}]};
 for(const [from,to] of [[5,5],[0,8],[-1,9],[123,"bad"]])expect(await relayAuthorized(sql,from,to)).toBe(false);
 expect(calls).toBe(0);
});
test("relay grants access only after accepted invitation or response",async()=>{
 const queries=[];
 const positive=async(query,...args)=>{queries.push({query,args});return [{allowed:true}]};
 expect(await relayAuthorized(positive,111,222)).toBe(true);
 expect(queries[0].query).toContain("status='accepted'");
 expect(queries[0].query).toContain("mm_invitations");
 expect(queries[0].query).toContain("mm_responses");
 expect(queries[0].args).toEqual([111,222]);
 const negative=async()=>[{allowed:false}];
 expect(await relayAuthorized(negative,111,222)).toBe(false);
});
test("relay rate limit is controlled by database transaction",async()=>{
 let sqltext="",args=[];
 expect(await consumeRelayQuota(async(sql,...p)=>{sqltext=sql;args=p;return [{used:3}]},13,20)).toBe(true);
 expect(sqltext).toContain("ON CONFLICT");
 expect(sqltext).toContain("WHERE mm_relay_usage.used<$2");
 expect(args).toEqual([13,20]);
 expect(await consumeRelayQuota(async()=>[],13,20)).toBe(false);
});
