import {test,expect} from "bun:test";
import {publicDocumentRoute,legalReady,requiredDocumentSlugs} from "../documents.ts";

const emptySql=async query=>{
 if(query.startsWith("SELECT DISTINCT ON(slug)"))return [];
 if(query.startsWith("SELECT * FROM mm_documents"))return [];
 throw Error("Unexpected query: "+query);
};

test("presentation document placeholders are clearly marked and never satisfy the legal launch gate",async()=>{
 const list=await publicDocumentRoute(new Request("https://example.test/documents"),emptySql);
 const html=await list.text();
 expect(list.status).toBe(200);
 expect(html).toContain("Предпросмотр для согласования");
 expect(html).toContain("не открывают регистрацию в боевом режиме");
 for(const slug of requiredDocumentSlugs)expect(html).toContain("/documents/"+slug);
 expect(await legalReady(emptySql)).toBe(false);
});

test("each missing required document opens a labeled presentation placeholder without being published",async()=>{
 for(const slug of requiredDocumentSlugs){
  const response=await publicDocumentRoute(new Request("https://example.test/documents/"+slug),emptySql);
  const html=await response.text();
  expect(response.status).toBe(200);
  expect(html).toContain("ПРЕЗЕНТАЦИОННАЯ ЗАГЛУШКА");
  expect(html).toContain("НЕ ЮРИДИЧЕСКИЙ ДОКУМЕНТ");
  expect(html).toContain("не опубликовано");
 }
 expect(await legalReady(emptySql)).toBe(false);
});

test("malformed document links return 404 instead of crashing the web server",async()=>{
 const response=await publicDocumentRoute(new Request("https://example.test/documents/%E0%A4%A"),emptySql);
 expect(response.status).toBe(404);
});
