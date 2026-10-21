// Owner-editable help articles (section 22.7 of the specification).
// These are NOT legal documents. Publication never changes legal consents/hashes.
import {GUIDES,getGuide} from "./guides.ts";
export const guideSlugs=Object.freeze(Object.keys(GUIDES));
const htmlEscape=s=>String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
export function validateGuide(slug,title,body){
 const key=String(slug||"");
 if(!Object.hasOwn(GUIDES,key))throw Error("Неизвестная статья");
 const heading=String(title||"").trim(),text=String(body||"").trim();
 if(!heading||heading.length>120)throw Error("Название статьи: от 1 до 120 символов");
 if(text.length<20||text.length>3900)throw Error("Текст статьи: от 20 до 3900 символов");
 return {slug:key,title:heading,body:text};
}
export async function prepareGuideEditor(sql){
 await sql(`CREATE TABLE IF NOT EXISTS mm_guide_revisions(
  slug TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version>0),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  editor TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(slug,version)
 )`);
}
export async function listGuideEditors(sql){
 const latest=await sql(`SELECT DISTINCT ON (slug) slug,version,title,body,created_at
 FROM mm_guide_revisions ORDER BY slug,version DESC`);
 return guideSlugs.map(slug=>{
  const row=latest.find(r=>r.slug===slug);
  return row||{slug,version:0,title:GUIDES[slug].title,body:GUIDES[slug].text.replace(/<[^>]*>/g,""),created_at:null};
 });
}
export async function readGuideEditor(sql,slug){
 if(!Object.hasOwn(GUIDES,String(slug)))return null;
 const rows=await sql("SELECT title,body,version FROM mm_guide_revisions WHERE slug=$1 ORDER BY version DESC LIMIT 1",slug);
 if(rows.length)return {title:rows[0].title,body:rows[0].body,version:rows[0].version,custom:true};
 const builtIn=getGuide(slug);
 return {...builtIn,version:0,custom:false};
}
export async function renderEditableGuide(sql,slug){
 const guide=await readGuideEditor(sql,slug);
 if(!guide)return null;
 // An owner's text is plain text, escaped before Telegram HTML rendering.
 // Built-in trusted guides have their own fixed HTML formatting.
 return guide.custom?"<b>"+htmlEscape(guide.title)+"</b>\n\n"+htmlEscape(guide.body):guide.text;
}
export async function editableGuideMenu(sql){
 const guides=await listGuideEditors(sql);
 return guides.map(g=>[g.title,"guide:"+g.slug]);
}
export async function publishGuideRevision(sql,slug,title,body,editor){
 const entry=validateGuide(slug,title,body);
 const who=String(editor||"").trim().slice(0,64)||"owner";
 // The (slug, version) primary key protects against simultaneous edits.
 for(let attempt=0;attempt<3;attempt++){
  const rows=await sql(`INSERT INTO mm_guide_revisions(slug,version,title,body,editor)
  SELECT $1,COALESCE(MAX(version),0)+1,$2,$3,$4
  FROM mm_guide_revisions WHERE slug=$1
  ON CONFLICT(slug,version) DO NOTHING RETURNING slug,version,title,created_at`,
  entry.slug,entry.title,entry.body,who);
  if(rows.length)return rows[0];
 }
 throw Error("Статью одновременно редактируют. Обновите раздел и попробуйте снова.");
}
