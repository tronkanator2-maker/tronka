import {test,expect} from "bun:test";
import {WIZARD_ROLES,wizardFields,wizardField,wizardCompleted,wizardAnswer} from "../profile-wizard.ts";
test("model wizard covers all required casting profile fields",()=>{
 const keys=wizardFields("модель").map(f=>f.key);
 for(const key of ["имя","дата рождения","город","пол","рост","размер одежды","цвет волос","длина волос","формат","прайс"])expect(keys).toContain(key);
 expect(wizardField("модель",0).key).toBe("имя");
 expect(wizardCompleted("модель",keys.length)).toBe(true);
});
test("professional wizard includes a portfolio",()=>{
 expect(WIZARD_ROLES).toContain("фотограф");
 expect(wizardFields("фотограф").some(f=>f.key==="портфолио"&&f.required)).toBe(true);
});
test("wizard validates a few structured fields without collecting phone numbers",()=>{
 expect(wizardAnswer(wizardFields("модель")[0],"Анна").ok).toBe(true);
 expect(wizardAnswer({key:"дата рождения"},"сегодня").ok).toBe(false);
 expect(wizardAnswer({key:"рост"},"172").ok).toBe(true);
 expect(wizardAnswer({key:"рост"},"много").ok).toBe(false);
 expect(wizardFields("модель").some(f=>f.key==="телефон"||f.key==="паспорт")).toBe(false);
});
