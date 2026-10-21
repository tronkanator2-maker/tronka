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

test("relay checks that BOTH accounts remain unblocked and unsuspended",async()=>{
 let statement="";
 const sql=async(q)=>{statement=q;return [{allowed:true}]};
 expect(await relayAuthorized(sql,111,222)).toBe(true);
 expect(statement).toContain("FROM mm_users sender JOIN mm_users recipient");
 expect(statement).toContain("sender.blocked=FALSE");
 expect(statement).toContain("sender.suspended=FALSE");
 expect(statement).toContain("recipient.blocked=FALSE");
 expect(statement).toContain("recipient.suspended=FALSE");
 expect(statement).toContain("sender.id=$1");
 expect(statement).toContain("recipient.id=$2");
 // A previously accepted collaboration is insufficient when either party is blocked.
 expect(statement).toContain("AND (");
 expect(statement).toContain("status='accepted'");
 const rejected=async()=>[{allowed:false}];
 expect(await relayAuthorized(rejected,111,222)).toBe(false);
});
test("relay validates numeric Telegram IDs without truncating larger identifiers",async()=>{
 let calls=0;const sql=async()=>{calls++;return [{allowed:true}]};
 for(const invalid of [[1.5,3],[3,Infinity],[3,Number.MAX_SAFE_INTEGER+1],[-1,4],[3,3]])
  expect(await relayAuthorized(sql,...invalid)).toBe(false);
 expect(calls).toBe(0);
});
