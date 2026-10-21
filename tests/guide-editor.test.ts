import {test,expect} from "bun:test";
import {guideSlugs,validateGuide,prepareGuideEditor,listGuideEditors,readGuideEditor,renderEditableGuide,editableGuideMenu,publishGuideRevision} from "../guide-editor.ts";

test("only four nonlegal help topics may be edited",()=>{
 expect(guideSlugs).toEqual(["getting-started","portfolio","safe-casting","posting"]);
 const valid=validateGuide("safe-casting","Безопасность съёмок","Уточните условия до встречи и не платите за обещания кастинга.");
 expect(valid.slug).toBe("safe-casting");
 for(const bad of ["offer","privacy","rules","distribution","esignature","processing","__proto__","toString","unknown"]){
  expect(()=>validateGuide(bad,"Заголовок","Обновленный справочный текст для пользователей.")).toThrow("Неизвестная статья");
 }
});
test("validates title and body sizes before any DB write",()=>{
 for(const [title,body] of [
  ["","Это достаточно длинный текст для примера."],
  ["x".repeat(121),"Это достаточно длинный текст для примера."],
  ["Название","мал"],
  ["Название","x".repeat(3901)]
 ]){
  expect(()=>validateGuide("portfolio",title,body)).toThrow();
 }
});
test("falls back to checked-in articles until the owner publishes replacements",async()=>{
 const sql=async()=>[];
 const item=await readGuideEditor(sql,"portfolio");
 expect(item.custom).toBe(false);
 expect(item.text).toContain("портфолио");
 expect(await renderEditableGuide(sql,"safe-casting")).toContain("предоплату");
 expect(await renderEditableGuide(sql,"offer")).toBeNull();
});
test("published help text is escaped as plain text, not interpreted as arbitrary HTML",async()=>{
 const sql=async()=>[{title:"Совет <b>важно</b> & успех",body:"Текст <script>alert(1)</script> & правила\nГотово",version:4}];
 const html=await renderEditableGuide(sql,"portfolio");
 expect(html).toContain("&lt;b&gt;важно&lt;/b&gt;");
 expect(html).toContain("&lt;script&gt;");
 expect(html).toContain("&amp;");
 expect(html).not.toContain("<script>");
 expect(html).toContain("<b>Совет");
});
test("the menu uses current owner-authored headings while retaining all four actions",async()=>{
 const sql=async()=>[{slug:"portfolio",title:"Как снять портфолио",body:"Авторский текст инструкции в справке.",version:3,created_at:"2026-10-22"}];
 const menu=await editableGuideMenu(sql);
 expect(menu.length).toBe(4);
 expect(menu).toContainEqual(["Как снять портфолио","guide:portfolio"]);
 expect(menu.some(([title,action])=>action==="guide:safe-casting"&&title==="Безопасность съёмок")).toBe(true);
 const list=await listGuideEditors(sql);
 expect(list.find(g=>g.slug==="portfolio").version).toBe(3);
 expect(list.find(g=>g.slug==="posting").version).toBe(0);
});
test("publishing an article creates a new version with owner attribution",async()=>{
 const calls=[];
 const sql=async(query,...args)=>{calls.push({query,args});return [{slug:"portfolio",version:5,title:"Портфолио",created_at:"2026-10-22"}]};
 const result=await publishGuideRevision(sql,"portfolio","Портфолио","Советы для подготовки профессионального портфолио и фотографий.","owner");
 expect(result.version).toBe(5);
 expect(calls).toHaveLength(1);
 expect(calls[0].query).toContain("MAX(version)");
 expect(calls[0].query).toContain("ON CONFLICT(slug,version) DO NOTHING");
 expect(calls[0].query).toContain("RETURNING slug,version,title,created_at");
 expect(calls[0].args).toEqual(["portfolio","Портфолио","Советы для подготовки профессионального портфолио и фотографий.","owner"]);
});
test("concurrent version conflict retries a bounded number of times",async()=>{
 let attempts=0;
 const sql=async()=>{attempts++;if(attempts===1)return [];return [{slug:"portfolio",version:2}]};
 expect((await publishGuideRevision(sql,"portfolio","Портфолио","Советы для портфолио в профессиональной студии.","owner")).version).toBe(2);
 expect(attempts).toBe(2);
 attempts=0;
 await expect(publishGuideRevision(async()=>{attempts++;return []},"portfolio","Портфолио","Это достаточно длинное описание для проверки.","owner")).rejects.toThrow("одновременно");
 expect(attempts).toBe(3);
});
test("guide editor schema is versioned without overwriting approved documents",async()=>{
 const q=[];
 await prepareGuideEditor(async query=>{q.push(query);return []});
 expect(q).toHaveLength(1);
 expect(q[0]).toContain("CREATE TABLE IF NOT EXISTS mm_guide_revisions");
 expect(q[0]).toContain("PRIMARY KEY(slug,version)");
 expect(q[0]).not.toContain("mm_documents");
});
