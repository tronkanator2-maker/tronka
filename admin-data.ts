// Strictly allow-listed database-backed pagination for the admin interface.
export const PAGE_SIZE=20;
export const ADMIN_SECTIONS=Object.freeze({
 users:{from:"mm_users",fields:"id,username,first_name,active,blocked,suspended,access_until,trial_until,created_at",search:["id::text","COALESCE(username,'')","COALESCE(first_name,'')"]},
 jobs:{from:"mm_jobs",fields:"id,owner,body,status,paused,source_id,created_at,expires_at",search:["id::text","owner::text","COALESCE(body::text,'')","COALESCE(status,'')"]},
 pending:{from:"mm_jobs",fields:"id,owner,body,status,source_id,created_at",where:"status='pending'",search:["id::text","owner::text","COALESCE(body::text,'')"]},
 sources:{from:"mm_sources",fields:"id,title,username,city,topic,active,mode,last_seen_at,disabled_reason,created_at",search:["id::text","COALESCE(title,'')","COALESCE(username,'')","COALESCE(city,'')","COALESCE(topic,'')"]},
 candidates:{from:"mm_candidate_sources",fields:"id,username,title,reason,unique30,total30,checked_at",where:"status='needs_review'",search:["id::text","COALESCE(username,'')","COALESCE(title,'')"]},
 reports:{from:"mm_reports_v2",fields:"id,reporter,target_user,target_job,kind,status,body,created_at,updated_at",search:["id::text","reporter::text","COALESCE(body,'')","COALESCE(status,'')"]}
});
export function parseAdminListParams(url){
 const section=String(url.searchParams.get("section")||"summary");
 const rawPage=Number(url.searchParams.get("page")||1);
 const page=Number.isSafeInteger(rawPage)?Math.min(10000,Math.max(1,rawPage)):1;
 const search=String(url.searchParams.get("q")||"").trim().slice(0,80);
 return {section,page,search};
}
export function adminListStatements(section,page=1,search=""){
 const spec=ADMIN_SECTIONS[section];
 if(!spec)throw new Error("Раздел не найден");
 const p=Number.isSafeInteger(page)?Math.max(1,Math.min(10000,page)):1;
 const q=String(search||"").trim().slice(0,80);
 const terms=[];
 if(spec.where)terms.push("("+spec.where+")");
 if(q)terms.push("("+spec.search.map(x=>x+" ILIKE $1").join(" OR ")+")");
 const where=terms.length?" WHERE "+terms.join(" AND "):"";
 const args=q?["%"+q+"%"]:[];
 const limit="$"+(args.length+1),offset="$"+(args.length+2);
 return {rows:"SELECT "+spec.fields+" FROM "+spec.from+where+" ORDER BY id DESC LIMIT "+limit+" OFFSET "+offset,
 count:"SELECT COUNT(*)::int total FROM "+spec.from+where,
 args,rowArgs:[...args,PAGE_SIZE,(p-1)*PAGE_SIZE],page:p,search:q};
}
export async function readAdminList(sql,section,page,search){
 const q=adminListStatements(section,page,search);
 const [rows,counts]=await Promise.all([sql(q.rows,...q.rowArgs),sql(q.count,...q.args)]);
 const total=Number(counts[0]?.total||0),pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
 return {section,items:rows,total,page:q.page,pages,page_size:PAGE_SIZE,search:q.search};
}
export const MODERATOR_ACTIONS=Object.freeze(["approve","reject","ticket_reply","ticket_status","candidate_reject"]);
export function canAdminAct(role,action){
 return role==="owner" || (role==="moderator" && MODERATOR_ACTIONS.includes(action));
}
export async function readFinanceSummary(sql){
 const [users]=await sql("SELECT COUNT(*) FILTER (WHERE access_until>NOW())::int manually_enabled,COUNT(*) FILTER (WHERE trial_until>NOW())::int trial_active,COUNT(*) FILTER (WHERE access_until>NOW() AND trial_until>NOW())::int overlap FROM mm_users");
 return {
  manual_access_active:Number(users?.manually_enabled||0),
  trial_access_active:Number(users?.trial_active||0),
  overlapping_access:Number(users?.overlap||0),
  gateway_connected:false,recognized_revenue:null,payment_count:null,
  note:"Платежи не подключены: выручка и транзакции неизвестны. Продление доступа вручную не является оплатой."
 };
}
