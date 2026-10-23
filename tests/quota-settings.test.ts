import {test,expect} from "bun:test";
import {QUOTA_DEFINITIONS,quotaKeys,validateQuota,prepareQuotaSettings,readQuotaSettings,getQuotaValue,updateQuotaSetting} from "../quota-settings.ts";

test("owner addendum defaults are bounded and available without database rows",async()=>{
 expect(quotaKeys.length).toBe(7);
 expect(QUOTA_DEFINITIONS.free_responses_week.value).toBe(1);
 expect(QUOTA_DEFINITIONS.free_invitations_week.value).toBe(1);
 expect(QUOTA_DEFINITIONS.free_active_jobs.value).toBe(1);
 expect(QUOTA_DEFINITIONS.paid_active_jobs.value).toBe(10);
 expect(QUOTA_DEFINITIONS.free_daily_jobs.value).toBe(5);
 expect(QUOTA_DEFINITIONS.free_daily_profiles.value).toBe(3);
 expect(QUOTA_DEFINITIONS.free_inbound_responses.value).toBe(5);
 const sql=async()=>[];
 const limits=await readQuotaSettings(sql);
 expect(limits.map(x=>x.key)).toEqual(quotaKeys);
 expect(limits.find(x=>x.key==="free_daily_jobs").value).toBe(5);
 expect(await getQuotaValue(sql,"paid_active_jobs")).toBe(10);
});
test("validates named integer limits and rejects unknown or prototype keys",()=>{
 expect(validateQuota("free_responses_week","2")).toEqual({key:"free_responses_week",value:2});
 expect(validateQuota("free_active_jobs",4)).toEqual({key:"free_active_jobs",value:4});
 for(const [key,value] of [
  ["__proto__",1],["constructor",1],["status",1],["free_active_jobs",0],
  ["paid_active_jobs",-1],["free_responses_week",51],["free_daily_jobs",101],
  ["free_daily_profiles",1.5],["free_daily_jobs",""],["free_daily_jobs","NaN"],
  ["free_inbound_responses",501]
 ])expect(()=>validateQuota(key,value)).toThrow();
});
test("read uses stored settings and falls back on invalid/obsolete rows",async()=>{
 const sql=async()=>[
  {key:"free_daily_jobs",value:7,updated_at:"2026-10-22T00:00:00Z"},
  {key:"free_active_jobs",value:-100},
  {key:"old_unrecognized_setting",value:22}
 ];
 const result=await readQuotaSettings(sql);
 expect(result.find(x=>x.key==="free_daily_jobs").value).toBe(7);
 expect(result.find(x=>x.key==="free_active_jobs").value).toBe(1);
 expect(result.some(x=>x.key==="old_unrecognized_setting")).toBe(false);
 expect(await getQuotaValue(async()=>[{value:3}],"free_daily_jobs")).toBe(3);
 expect(await getQuotaValue(async()=>[{value:9000}],"free_daily_jobs")).toBe(5);
});
test("owner updates return actual DB values without interpolating setting names into SQL",async()=>{
 let call=null;
 const sql=async(query,...params)=>{call={query,params};return [{key:"free_invitations_week",value:2,updated_at:"2026-10-22"}]};
 expect((await updateQuotaSetting(sql,"free_invitations_week",2)).value).toBe(2);
 expect(call.query).toContain("ON CONFLICT(key) DO UPDATE");
 expect(call.query).toContain("RETURNING key,value,updated_at");
 expect(call.params).toEqual(["free_invitations_week",2]);
 await expect(updateQuotaSetting(sql,"not_a_limit",5)).rejects.toThrow("Неизвестный лимит");
 expect(call.params).toEqual(["free_invitations_week",2]);
});
test("schema uses guarded integer settings and cannot silently edit legal documents",async()=>{
 const statements=[];
 await prepareQuotaSettings(async q=>{statements.push(q);return []});
 expect(statements).toHaveLength(1);
 expect(statements[0]).toContain("CREATE TABLE IF NOT EXISTS mm_quota_settings");
 expect(statements[0]).toContain("CHECK(value>=0)");
 expect(statements[0]).not.toContain("mm_documents");
});
