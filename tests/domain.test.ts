import {test,expect} from "bun:test";
import {parseFields,field,roleMatch,similarity,parseSourcePost,moderate,jobExpiresAt} from "../engine.ts";
import {escapeDocument,requiredDocumentSlugs} from "../documents.ts";
test("handles copied templates",()=>{
 const p=parseFields("Имя: Анна\nГород: Москва\nФормат: ТФП");
 expect(field(p,"имя")).toBe("Анна");
 expect(field(p,"город")).toBe("Москва");
});
test("same advert published twice becomes a duplicate",()=>{
 expect(similarity("Нужна модель на каталог @agency001","Нужна модель на каталог @agency002")).toBe(1);
});
test("different jobs are not deduplicated",()=>{
 expect(similarity("Нужна модель для каталога","Нужен фотограф на корпоратив")).toBeLessThan(.95);
});
test("role matching targets requested professionals",()=>{
 expect(roleMatch("визажист, фотограф","фотограф")).toBe(true);
 expect(roleMatch("визажист, фотограф","модель")).toBe(false);
});
test("source post parsing",()=>{
 const p=parseSourcePost("Нужна модель для каталога одежды, Москва. Оплата 5000 рублей, писать @agency001");
 expect(p).not.toBeNull();
 expect(field(p,"город")).toBe("Москва");
});
test("public docs are escaped and all agreements tracked",()=>{
 expect(escapeDocument("<script>")).toBe("&lt;script&gt;");
 expect(requiredDocumentSlugs).toContain("processing");
 expect(requiredDocumentSlugs).toContain("distribution");
});
