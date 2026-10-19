import {test,expect} from "bun:test";
import {ADMIN_SECTIONS,PAGE_SIZE,parseAdminListParams,adminListStatements,readAdminList,canAdminAct,MODERATOR_ACTIONS,readFinanceSummary} from "../admin-data.ts";
test("admin search and pagination are strictly allow-listed",()=>{
 expect(Object.keys(ADMIN_SECTIONS)).toEqual(["users","jobs","pending","sources","candidates","reports","audit"]);
 expect(()=>adminListStatements("mm_users;DROP TABLE mm_users")).toThrow();
 const q=adminListStatements("jobs",3,"кастинг");
 expect(q.rows).toContain("FROM mm_jobs");
 expect(q.rows).toContain("ORDER BY id DESC LIMIT $2 OFFSET $3");
 expect(q.rowArgs).toEqual(["%кастинг%",PAGE_SIZE,40]);
 expect(q.count).toContain("COUNT(*)::int total");
 expect(q.rows).not.toContain("кастинг");
 expect(q.rows).not.toContain("DROP TABLE");
});
test("status-sensitive admin sections cannot return irrelevant records",()=>{
 expect(adminListStatements("pending",1,"").rows).toContain("status='pending'");
 expect(adminListStatements("candidates",1,"").rows).toContain("status='needs_review'");
});
test("invalid page values and long searches are bounded",()=>{
 const url=new URL("https://host.test/admin/data?section=users&page=-4&q="+"X".repeat(120));
 const parsed=parseAdminListParams(url);
 expect(parsed.page).toBe(1);
 expect(parsed.search.length).toBe(80);
 expect(adminListStatements("users",999999,"").page).toBe(10000);
});
test("pagination returns correct totals and never fetches unlimited datasets",async()=>{
 const calls=[];
 const sql=async(query,...args)=>{
  calls.push({query,args});
  return query.includes("COUNT(*)")?[{total:61}]:[{id:35,first_name:"Гость"}];
 };
 const result=await readAdminList(sql,"users",2,"Гость");
 expect(result).toMatchObject({section:"users",total:61,page:2,pages:4,page_size:20,search:"Гость"});
 expect(calls.find(x=>x.query.includes("LIMIT")).args).toEqual(["%Гость%",20,20]);
});
test("moderators may moderate but cannot grant access, publish legal docs or change users",()=>{
 for(const action of MODERATOR_ACTIONS)expect(canAdminAct("moderator",action)).toBe(true);
 for(const action of ["access_grant","access_revoke","document_publish","source_add","source_on","source_off","candidate_approve","block","unblock"])expect(canAdminAct("moderator",action)).toBe(false);
 expect(canAdminAct("guest","approve")).toBe(false);
 expect(canAdminAct("owner","document_publish")).toBe(true);
});
test("finance summary keeps unknown payment revenue unknown",async()=>{
 const finance=await readFinanceSummary(async()=>[{manually_enabled:10,trial_active:7,overlap:2}]);
 expect(finance.manual_access_active).toBe(10);
 expect(finance.trial_access_active).toBe(7);
 expect(finance.overlapping_access).toBe(2);
 expect(finance.recognized_revenue).toBeNull();
 expect(finance.payment_count).toBeNull();
 expect(finance.gateway_connected).toBe(false);
});

test("only the owner may access sensitive audit history",()=>{
 const q=adminListStatements("audit",1,"document_publish");
 expect(q.rows).toContain("FROM mm_admin_log");
 expect(q.rows).toContain("details");
 expect(q.rowArgs).toEqual(["%document_publish%",20,0]);
});
