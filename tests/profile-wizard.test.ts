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

import {toggleProfileRole} from "../profile-wizard.ts";
test("profession picker supports same-class multi-role selection",()=>{
 expect(toggleProfileRole(["модель"],"актёр").selected).toEqual(["модель","актёр"]);
 expect(toggleProfileRole(["модель","актёр"],"модель").selected).toEqual(["актёр"]);
 expect(toggleProfileRole(["фотограф"],"визажист").selected).toEqual(["фотограф","визажист"]);
});
test("profession picker clears incompatible roles and explains why",()=>{
 const model=toggleProfileRole(["фотограф","визажист"],"модель");
 expect(model.selected).toEqual(["модель"]);
 expect(model.error).toContain("не совмещаются");
 const pro=toggleProfileRole(["модель","актёр"],"фотограф");
 expect(pro.selected).toEqual(["фотограф"]);
 expect(pro.error).toContain("не совмещаются");
});
test("required fields follow a group of mixed professional roles",()=>{
 const model=wizardFields("модель, актёр");
 expect(model.some(x=>x.key==="рост"&&x.required)).toBe(true);
 const specialist=wizardFields("визажист, стилист по одежде");
 expect(specialist.some(x=>x.key==="портфолио"&&x.required)).toBe(true);
});
