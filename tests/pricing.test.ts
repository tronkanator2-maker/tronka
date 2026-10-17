import {test,expect} from "bun:test";
import {parseMoney,shiftHours,payMatches,formatMatches,agencyCommissionPercent} from "../pricing.ts";
const model={"кто вы":"модель","прайс":"3000 ₽ за час","формат":"коммерция"};
test("extracts hourly and shift amounts without inventing currencies",()=>{
 expect(parseMoney("3000 ₽ за час")?.unit).toBe("hour");
 expect(parseMoney("10 000 ₽ за смену")?.amount).toBe(10000);
 expect(parseMoney("договорная")).toBeNull();
 expect(parseMoney("ТФП")?.free).toBe(true);
});
test("determines shift duration only when given",()=>{
 expect(shiftHours("смена 4 часа")).toBe(4);
 expect(shiftHours("с 10 до 18")).toBe(8);
 expect(shiftHours("за смену")).toBeNull();
});
test("commission is subtracted before comparing model rate",()=>{
 expect(agencyCommissionPercent("Агентская комиссия: 20%")).toBe(20);
 const j={"формат и оплата":"4000 ₽ за час","агентская комиссия":"20%"};
 expect(payMatches(model,j)).toBe(true);
});
test("one-sided 20 percent tolerance allows 2400 but not 2300 per hour",()=>{
 expect(payMatches(model,{"формат и оплата":"2400 ₽ за час"})).toBe(true);
 expect(payMatches(model,{"формат и оплата":"2300 ₽ за час"})).toBe(false);
});
test("unknown shift length must not reject a model",()=>{
 expect(payMatches(model,{"формат и оплата":"5000 ₽ за смену"})).toBe(true);
 expect(payMatches(model,{"формат и оплата":"5000 ₽ за смену","описание":"съёмка 4 часа"})).toBe(false);
});
test("TFP models may receive unpaid casting",()=>{
 expect(payMatches(model,{"формат и оплата":"ТФП"})).toBe(false);
 expect(payMatches({...model,"формат":"коммерция, ТФП"},{"формат и оплата":"ТФП"})).toBe(true);
});
test("unknown job fields pass filters; paid job is commercial",()=>{
 expect(formatMatches("коммерция","")).toBe(true);
 expect(formatMatches("коммерция","3000 ₽ за час")).toBe(true);
 expect(formatMatches("коммерция","ТФП")).toBe(false);
});
test("currency differences do not silently compare without exchange rate",()=>{
 expect(payMatches(model,{"формат и оплата":"100 $ за час"})).toBe(true);
});
