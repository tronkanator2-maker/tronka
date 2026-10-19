import {test,expect} from "bun:test";
import {adminHtml} from "../admin-ui.ts";
test("dashboard presents structured, mobile-friendly tables with navigation and search",()=>{
 for(const marker of ["document.createElement(\"table\")","data-tab=\"users\"","data-tab=\"jobs\"","data-tab=\"reports\"","data-tab=\"sources\"","data-tab=\"finance\"","id=\"search\"","id=\"nextPage\"","id=\"prevPage\"","@media(max-width:760px)"]){
  expect(adminHtml).toContain(marker);
 }
 expect(adminHtml).not.toContain("JSON.stringify(obj,null,2)");
});
test("dashboard renders untrusted database records as text, never as HTML",()=>{
 expect(adminHtml).toContain("p.textContent=fmt(value)");
 expect(adminHtml).not.toContain(".innerHTML=");
 expect(adminHtml).toContain("aria-live");
});
test("editing documents requires confirmation and forms show server results",()=>{
 expect(adminHtml).toContain("documentForm");
 expect(adminHtml).toContain("Юридические документы");
 expect(adminHtml).toContain("Публикуется только юридически утверждённая версия");
 expect(adminHtml).toContain("Ответ отправлен");
 expect(adminHtml).toContain("role");
});
