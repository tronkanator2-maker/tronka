import {test,expect} from "bun:test";
import {redactForAI,validateModelJob} from "../ai-parser.ts";
test("AI receives redacted public source posts",()=>{
 const redacted=redactForAI("Нужен фотограф для съёмки. Контакт @agency001, телефон +7 999 123 45 67");
 expect(redacted).not.toContain("@agency001");
 expect(redacted).not.toContain("999 123");
});
test("AI cannot assign an unknown profession",()=>{
 const sample={title:"Съёмка",want:["unknown_role"],city:"Москва",description:"Нужен специалист на рекламную съёмку для бренда"};
 expect(validateModelJob(sample,"@agency001")).toBeNull();
});
test("AI normalizes valid roles and keeps missing values honest",()=>{
 const sample={title:"Съёмка",want:["фотограф"],city:"Москва",description:"Нужен фотограф на съёмку каталога для местного бренда"};
 const p=validateModelJob(sample,"@agency001");
 expect(p["кого ищу"]).toBe("фотограф");
 expect(p["формат и оплата"]).toBe("не указано");
});
