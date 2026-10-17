import {test,expect} from "bun:test";
import {jobWizardFields,jobWizardField,jobWizardFinished,validateJobWizardAnswer,jobWizardFilters,clearJobWizard} from "../job-wizard.ts";
test("job creator asks exactly the casting fields needed by listing validation",()=>{
 expect(jobWizardFields.map(x=>x.key)).toEqual([
 "название заявки","кого ищу","тип работы","город","требования","формат и оплата","дата съёмки","описание"
 ]);
 expect(jobWizardField(0)?.key).toBe("название заявки");
 expect(jobWizardFinished(jobWizardFields.length)).toBe(true);
});
test("job editor rejects invalid roles, long titles and stale dates",()=>{
 const f=key=>jobWizardFields.find(x=>x.key===key);
 expect(validateJobWizardAnswer(f("кого ищу"),"модель, фотограф").ok).toBe(true);
 expect(validateJobWizardAnswer(f("кого ищу"),"супермодель-миллионер").ok).toBe(false);
 expect(validateJobWizardAnswer(f("название заявки"),"a".repeat(41)).ok).toBe(false);
 expect(validateJobWizardAnswer(f("дата съёмки"),"30.02.2099").ok).toBe(false);
 expect(validateJobWizardAnswer(f("дата съёмки"),"01.01.2001").ok).toBe(false);
 expect(validateJobWizardAnswer(f("дата съёмки"),"25.11.2099").ok).toBe(true);
});
test("draft supports revisiting and cancelling without erasing unrelated user filters",()=>{
 const original={city:"Москва",adult:false};
 const staged=jobWizardFilters(original,{"название заявки":"Каталог"},3);
 expect(staged.jobWizardDraft["название заявки"]).toBe("Каталог");
 expect(clearJobWizard(staged)).toEqual(original);
 expect(original.jobWizardDraft).toBeUndefined();
});
