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

import {eligibleProfile} from "../engine.ts";
test("model needs a complete level-2 profile and key photo",()=>{
 const profile={"кто вы":"модель","имя":"Анна","дата рождения":"12.09.2002","город":"Москва","пол":"женский","рост":"172","размер одежды":"42","цвет волос":"русый","длина волос":"длинные","формат":"ТФП","прайс":"договорная"};
 expect(eligibleProfile(profile,true)).toBe(true);
 expect(eligibleProfile(profile,false)).toBe(false);
 const incomplete={...profile};delete incomplete["рост"];
 expect(eligibleProfile(incomplete,true)).toBe(false);
});
test("photographer must include portfolio to be searchable",()=>{
 const profile={"кто вы":"фотограф","имя":"Иван","дата рождения":"05.03.1995","город":"Москва"};
 expect(eligibleProfile(profile,true)).toBe(false);
 expect(eligibleProfile({...profile,"портфолио":"https://drive.google.com"},true)).toBe(true);
});
