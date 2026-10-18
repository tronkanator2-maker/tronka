// Versioned public documents. No legal text is invented or published by default.
export const requiredDocumentSlugs=["offer","rules","privacy","processing","distribution","esignature"];
const names={
 offer:"Публичная оферта",
 rules:"Правила сервиса",
 privacy:"Политика конфиденциальности",
 processing:"Согласие на обработку персональных данных",
 distribution:"Согласие на распространение анкеты",
 esignature:"Соглашение о простой электронной подписи",
 overview:"Полный обзор функционала сервиса",
 parent:"Согласие родителя или опекуна",
 safety:"Безопасность",
 portfolio:"Памятка успешного портфолио"
};
export const escapeDocument=s=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const previewFields={
 offer:["Исполнитель услуги и реквизиты","Состав услуг и порядок размещения анкеты или заявки","Стоимость, расчёты, отмена и возвраты","Дата начала действия и контакты оператора"],
 rules:["Критерии размещения анкет и заявок","Запрещённый контент и порядок модерации","Порядок жалоб, ограничений и обжалования","Ответственность сторон и контакты поддержки"],
 privacy:["Оператор данных и его реквизиты","Состав данных и цели обработки","Сроки хранения, удаление и получатели данных","Способы обращения субъекта данных"],
 processing:["Оператор и конкретные цели обработки","Категории данных и перечень операций","Срок действия, отзыв и способ обращения","Контакты для вопросов о данных"],
 distribution:["Какие данные анкеты будут опубликованы","Кому и на каких ресурсах они могут передаваться","Срок распространения и порядок отзыва","Контакт для изменения или удаления анкеты"],
 esignature:["Как участник подтверждает электронное действие","Какие коды или записи подтверждают его авторство","Срок хранения доказательств и способ оспаривания","Контакты оператора"]
};
const pageHeaders={"content-type":"text/html; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"};
function previewDocument(slug){
 const title=names[slug]||"Документ",fields=previewFields[slug]||[];
 const checklist=fields.map(x=>"<li><strong>[Заполнить перед запуском]</strong> "+escapeDocument(x)+"</li>").join("");
 const body="<div style='padding:14px;border:2px solid #f0ad4e;border-radius:10px;background:#332b1b'><strong>ПРЕЗЕНТАЦИОННАЯ ЗАГЛУШКА · НЕ ЮРИДИЧЕСКИЙ ДОКУМЕНТ</strong><p>Этот экран показывает место и структуру раздела. Здесь нет утверждённых условий, и его нельзя использовать как согласие или основание для обработки данных. Перед публичным запуском владелец и юрист должны заменить заглушку полным текстом.</p></div><h2>Что заполнить</h2><ul>"+checklist+"</ul><p><strong>Статус:</strong> не утверждено и не опубликовано. Заглушка не засчитывается при проверке обязательных документов сервиса.</p><a href='/documents'>К списку документов</a>";
 return new Response(wrap(title,body),{headers:pageHeaders});
}
export async function prepareDocuments(sql){
 await sql("CREATE TABLE IF NOT EXISTS mm_documents(slug TEXT NOT NULL,version INTEGER NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,sha256 TEXT NOT NULL,published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(slug,version))");
 await sql("CREATE INDEX IF NOT EXISTS mm_documents_latest ON mm_documents(slug,published_at DESC)");
 await sql("CREATE TABLE IF NOT EXISTS mm_consent_events(id BIGSERIAL PRIMARY KEY,telegram_user BIGINT NOT NULL,consent TEXT NOT NULL,checked BOOLEAN NOT NULL,document_versions JSONB NOT NULL,document_hashes JSONB NOT NULL,recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
}
async function hash(body){
 const b=new TextEncoder().encode(body);
 const digest=await crypto.subtle.digest("SHA-256",b);
 return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,"0")).join("");
}
export async function publishDocument(sql,slug,title,body){
 if(!Object.hasOwn(names,slug))throw Error("Неизвестный тип документа");
 const text=String(body??"").trim(),label=String(title||names[slug]).trim().slice(0,150);
 if(text.length<120||text.length>100000)throw Error("Текст документа слишком короткий или длинный");
 const digest=await hash(text);
 const latest=(await sql("SELECT COALESCE(MAX(version),0)::int AS n FROM mm_documents WHERE slug=$1",slug))[0].n;
 const published=await sql("INSERT INTO mm_documents(slug,version,title,body,sha256) VALUES($1,$2,$3,$4,$5) RETURNING slug,version,sha256",slug,latest+1,label,text,digest);
 return published[0];
}
export async function latestDocuments(sql){
 return sql("SELECT DISTINCT ON(slug) slug,version,title,sha256,published_at FROM mm_documents ORDER BY slug,version DESC");
}
export async function legalReady(sql){
 const found=new Set((await latestDocuments(sql)).map(x=>x.slug));
 return requiredDocumentSlugs.every(k=>found.has(k));
}
export async function documentHashes(sql){
 const rows=await latestDocuments(sql);
 const versions={},hashes={};
 for(const d of rows){versions[d.slug]=d.version;hashes[d.slug]=d.sha256}
 return {versions,hashes};
}
export async function recordConsent(sql,id,slug,checked){
 const {versions,hashes}=await documentHashes(sql);
 if(!requiredDocumentSlugs.every(k=>versions[k]))return false;
 await sql("INSERT INTO mm_consent_events(telegram_user,consent,checked,document_versions,document_hashes) VALUES($1,$2,$3,$4::jsonb,$5::jsonb)",id,slug,checked,JSON.stringify(versions),JSON.stringify(hashes));
 return true;
}
const wrap=(title,body)=>"<!doctype html><html lang='ru'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'><title>"+escapeDocument(title)+"</title><style>body{font:16px/1.65 system-ui,sans-serif;background:#0f1726;color:#f1f5ff;margin:0 auto;padding:25px;max-width:850px}article{background:#1b2638;border:1px solid #354559;border-radius:16px;padding:25px}a{color:#a5c4ff}h1{font-size:27px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}</style></head><body><article><h1>"+escapeDocument(title)+"</h1>"+body+"</article></body></html>";
export async function publicDocumentRoute(req,sql){
 const path=new URL(req.url).pathname;
 if(req.method!=="GET"||!path.startsWith("/documents"))return null;
 const entries=await latestDocuments(sql);
 if(path==="/documents"||path==="/documents/"){
  const list=entries.map(d=>"<li><a href='/documents/"+encodeURIComponent(d.slug)+"'>"+escapeDocument(d.title)+"</a> <small>опубликована версия "+d.version+"</small></li>").join("");
  const approved=new Set(entries.map(d=>d.slug));
  const missing=requiredDocumentSlugs.filter(slug=>!approved.has(slug));
  const drafts=missing.map(slug=>"<li><a href='/documents/"+slug+"'>"+escapeDocument(names[slug])+"</a> <small>презентационная заглушка · не утверждено</small></li>").join("");
  const notice=missing.length?"<div style='padding:14px;border:2px solid #f0ad4e;border-radius:10px;background:#332b1b'><strong>Предпросмотр для согласования</strong><p>Разделы-заглушки помогают показать интерфейс заказчику. Они не являются правовыми документами и не открывают регистрацию в боевом режиме.</p></div>":"";
  const sections=(entries.length?"<h2>Опубликованные версии</h2><ul>"+list+"</ul>":"")+(missing.length?"<h2>Не утверждены</h2><ul>"+drafts+"</ul>":"");
  return new Response(wrap("Документы сервиса",notice+(sections||"<p>Обязательные документы опубликованы.</p>")),{headers:pageHeaders});
 }
 let slug;try{slug=decodeURIComponent(path.slice("/documents/".length))}catch{return new Response("Not found",{status:404})}
 if(!Object.hasOwn(names,slug))return new Response("Not found",{status:404});
 const docs=await sql("SELECT * FROM mm_documents WHERE slug=$1 ORDER BY version DESC LIMIT 1",slug);
 if(!docs.length)return requiredDocumentSlugs.includes(slug)?previewDocument(slug):new Response(wrap("Документ отсутствует","<p>Документ пока не опубликован.</p>"),{status:404,headers:pageHeaders});
 const d=docs[0];
 return new Response(wrap(d.title,"<p>Версия "+d.version+" · Контрольная сумма: "+escapeDocument(d.sha256)+"</p><pre>"+escapeDocument(d.body)+"</pre><a href='/documents'>Все документы</a>"),{headers:pageHeaders});
}


/** Stored separately for each consent: changing the underlying policy requires fresh consent. */
export function consentIsCurrent(consents, documentHashes, consentIndex){
 const i=String(consentIndex), key=i+"_hashes";
 if(!consents?.[i] || !consents?.[key] || !documentHashes)return false;
 return requiredDocumentSlugs.every(slug=>typeof documentHashes[slug]==="string" && documentHashes[slug]===consents[key][slug]);
}
export function allConsentsCurrent(consents, documentHashes){
 return [0,1,2].every(n=>consentIsCurrent(consents,documentHashes,n));
}
