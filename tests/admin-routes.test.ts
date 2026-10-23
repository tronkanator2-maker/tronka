import {test,expect} from "bun:test";
import {adminApp} from "../admin.ts";

test("admin routes enforce login, moderator restrictions and valid action results",async()=>{
 const previous={owner:Bun.env.ADMIN_PASSWORD,moderator:Bun.env.ADMIN_MODERATOR_PASSWORD,url:Bun.env.PUBLIC_URL};
 Bun.env.ADMIN_PASSWORD="owner-secret-for-dashboard-regression";
 Bun.env.ADMIN_MODERATOR_PASSWORD="moderator-secret-for-dashboard-regression";
 delete Bun.env.PUBLIC_URL;
 const calls=[];
 const sql=async(query,...args)=>{
  calls.push({query,args});
  if(query.includes("COUNT(*) FILTER"))return [{manually_enabled:3,trial_active:2,overlap:1}];
  if(query.includes("UPDATE mm_reports_v2"))return [{id:42}];
  if(query.includes("INSERT INTO mm_guide_revisions"))return [{slug:"portfolio",version:1,title:"Портфолио",created_at:"2026-10-22"}];
  if(query.includes("INSERT INTO mm_quota_settings"))return [{key:args[0],value:args[1],updated_at:"2026-10-22"}];
  return [];
 };
 const req=(path,method="GET",data=null,cookie="")=>new Request("https://panel.example"+path,{
  method,headers:{"content-type":"application/json",...(method==="POST"?{origin:"https://panel.example"}:{}),...(cookie?{cookie}:{})},
  body:method==="POST"?JSON.stringify(data):undefined
 });
 try{
  const html=await adminApp(req("/admin"),sql);
  expect(html.status).toBe(200);
  expect(await html.text()).toContain("Пользователи");
  expect((await adminApp(req("/admin/data?section=users"),sql)).status).toBe(401);
  const own=await adminApp(req("/admin/login","POST",{password:"owner-secret-for-dashboard-regression"}),sql);
  expect(own.status).toBe(200);
  expect((await own.json()).role).toBe("owner");
  const ownerCookie=own.headers.get("set-cookie").split(";")[0];
  const quotaView=await adminApp(req("/admin/data?section=quotas","GET",null,ownerCookie),sql);
  expect(quotaView.status).toBe(200);
  expect((await quotaView.json()).quotas).toHaveLength(7);
  const changedQuota=await adminApp(req("/admin/action","POST",{action:"quota_update",key:"free_daily_jobs",value:7},ownerCookie),sql);
  expect(changedQuota.status).toBe(200);
  expect((await changedQuota.json()).setting.value).toBe(7);
  expect(calls.some(c=>c.query.includes("'quota_update'"))).toBe(true);
  const invalidQuota=await adminApp(req("/admin/action","POST",{action:"quota_update",key:"__proto__",value:7},ownerCookie),sql);
  expect(invalidQuota.status).toBe(400);
  const articles=await adminApp(req("/admin/data?section=articles","GET",null,ownerCookie),sql);
  expect(articles.status).toBe(200);
  const articleData=await articles.json();
  expect(articleData.articles).toHaveLength(4);
  const updatedArticle=await adminApp(req("/admin/action","POST",{
   action:"guide_publish",slug:"portfolio",title:"Портфолио",
   body:"Это полезные советы по подготовке портфолио для съёмок."
  },ownerCookie),sql);
  expect(updatedArticle.status).toBe(200);
  expect((await updatedArticle.json()).guide.version).toBe(1);
  expect(calls.some(x=>x.query.includes("'guide_publish'"))).toBe(true);
  const invalidArticle=await adminApp(req("/admin/action","POST",{action:"guide_publish",slug:"offer",title:"Недопустимо",body:"Нельзя редактировать юридические согласия через справку."},ownerCookie),sql);
  expect(invalidArticle.status).toBe(400);
  const finances=await adminApp(req("/admin/data?section=finance","GET",null,ownerCookie),sql);
  expect(finances.status).toBe(200);
  expect((await finances.json()).finance.recognized_revenue).toBeNull();
  const mod=await adminApp(req("/admin/login","POST",{password:"moderator-secret-for-dashboard-regression"}),sql);
  expect(mod.status).toBe(200);
  expect((await mod.json()).role).toBe("moderator");
  const moderatorCookie=mod.headers.get("set-cookie").split(";")[0];
  expect((await adminApp(req("/admin/data?section=articles","GET",null,moderatorCookie),sql)).status).toBe(403);
  expect((await adminApp(req("/admin/data?section=quotas","GET",null,moderatorCookie),sql)).status).toBe(403);
  expect((await adminApp(req("/admin/action","POST",{action:"quota_update",key:"free_responses_week",value:99},moderatorCookie),sql)).status).toBe(403);
  expect((await adminApp(req("/admin/action","POST",{
   action:"guide_publish",slug:"portfolio",title:"Тест",
   body:"Попытка модератора изменить справочные материалы."
  },moderatorCookie),sql)).status).toBe(403);

  expect((await adminApp(req("/admin/data?section=finance","GET",null,moderatorCookie),sql)).status).toBe(403);
  expect((await adminApp(req("/admin/data?section=audit","GET",null,moderatorCookie),sql)).status).toBe(403);
  expect((await adminApp(req("/admin/action","POST",{action:"document_publish",slug:"offer",title:"Bad",body:"Bad"},moderatorCookie),sql)).status).toBe(403);
  expect((await adminApp(req("/admin/action","POST",{action:"access_grant",id:12,days:90},moderatorCookie),sql)).status).toBe(403);
  const moderate=await adminApp(req("/admin/action","POST",{action:"ticket_status",id:42,status:"closed"},moderatorCookie),sql);
  expect(moderate.status).toBe(200);
  expect(calls.some(c=>c.query.includes("UPDATE mm_reports_v2"))).toBe(true);
  const missing=await adminApp(req("/admin/action","POST",{action:"source_off",id:19},ownerCookie),sql);
  expect(missing.status).toBe(404);
  const forbiddenOrigin=new Request("https://panel.example/admin/action",{method:"POST",headers:{"content-type":"application/json","origin":"https://attacker.example","cookie":ownerCookie},body:JSON.stringify({action:"block",id:1})});
  expect((await adminApp(forbiddenOrigin,sql)).status).toBe(403);
 }finally{
  if(previous.owner===undefined)delete Bun.env.ADMIN_PASSWORD;else Bun.env.ADMIN_PASSWORD=previous.owner;
  if(previous.moderator===undefined)delete Bun.env.ADMIN_MODERATOR_PASSWORD;else Bun.env.ADMIN_MODERATOR_PASSWORD=previous.moderator;
  if(previous.url===undefined)delete Bun.env.PUBLIC_URL;else Bun.env.PUBLIC_URL=previous.url;
 }
});
