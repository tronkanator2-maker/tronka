// Source quality controls based on the Telegram source requirements, §2.1.
export function assessSource({createdAt,lastSeenAt,all=0,rejected=0,last30=0,accepted30=0},now=new Date()){
 const start=new Date(createdAt).getTime(),last=lastSeenAt?new Date(lastSeenAt).getTime():start;
 const day=86400000;
 if(!Number.isFinite(start))return {action:"keep",reason:"unknown creation"};
 if(now.getTime()-last>=30*day)return {action:"disable",reason:"Нет сообщений 30 дней"};
 if(now.getTime()-start>=7*day && all>0 && rejected/all>.40)return {action:"disable",reason:"В испытательный период отбраковано больше 40% сообщений"};
 if(now.getTime()-start>=30*day&&last30>0&&accepted30/last30<.10)return {action:"disable",reason:"Доля полезных заявок за 30 дней ниже 10%"};
 return {action:"keep",reason:""};
}
export async function setupSourceHealth(sql){
 await sql("ALTER TABLE mm_sources ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ");
 await sql("ALTER TABLE mm_sources ADD COLUMN IF NOT EXISTS disabled_reason TEXT");
 await sql("ALTER TABLE mm_sources ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ");
 await sql("ALTER TABLE mm_sources ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'trial'");
 await sql("CREATE TABLE IF NOT EXISTS mm_ai_usage(source_id BIGINT NOT NULL,day DATE NOT NULL,requests INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(source_id,day))");
}
export async function allowanceForModel(sql,sourceId,limit=50){
 const rows=await sql("INSERT INTO mm_ai_usage(source_id,day,requests) VALUES($1,(NOW() AT TIME ZONE 'UTC')::date,1) ON CONFLICT(source_id,day) DO UPDATE SET requests=mm_ai_usage.requests+1 WHERE mm_ai_usage.requests<$2 RETURNING requests",sourceId,limit);
 return rows.length>0;
}
export async function reviewSourceHealth(sql){
 const sources=await sql("SELECT * FROM mm_sources WHERE active=TRUE ORDER BY id LIMIT 500");
 for(const source of sources){
  const now=new Date();
  const [history]=await sql("SELECT COUNT(*)::int all_count,COUNT(*) FILTER(WHERE moderation='rejected')::int rejected_count,COUNT(*) FILTER(WHERE created_at>NOW()-INTERVAL '30 days')::int last30,COUNT(*) FILTER(WHERE created_at>NOW()-INTERVAL '30 days' AND moderation='active')::int accepted30 FROM mm_source_posts WHERE source_id=$1",source.id);
  const outcome=assessSource({createdAt:source.created_at,lastSeenAt:source.last_seen_at,all:history.all_count,rejected:history.rejected_count,last30:history.last30,accepted30:history.accepted30},now);
  if(outcome.action==="disable"){
   await sql("UPDATE mm_sources SET active=FALSE,disabled_reason=$1,disabled_at=NOW(),mode='disabled' WHERE id=$2 AND active=TRUE",outcome.reason,source.id);
   console.log("Source disabled due to quality rule",String(source.id),outcome.reason);
  }else if(source.mode==="trial" && now-new Date(source.created_at)>=7*86400000){
   await sql("UPDATE mm_sources SET mode='active' WHERE id=$1 AND mode='trial'",source.id);
  }
 }
 await sql("DELETE FROM mm_ai_usage WHERE day<(NOW() AT TIME ZONE 'UTC')::date-INTERVAL '45 days'");
}
