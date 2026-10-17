import {test,expect} from "bun:test";
import {weekStartMoscow,hasPaidAccess,normalizePhone} from "../access.ts";
test("Monday is the beginning of Moscow billing week",()=>{
 expect(weekStartMoscow(new Date("2026-10-17T13:00:00Z")).toISOString()).toBe("2026-10-11T21:00:00.000Z");
 expect(weekStartMoscow(new Date("2026-10-18T21:01:00Z")).toISOString()).toBe("2026-10-18T21:00:00.000Z");
});
test("plan entitlements expire strictly on time",()=>{
 expect(hasPaidAccess({trial_until:"2026-10-30T00:00:00Z"},new Date("2026-10-29T00:00:00Z"))).toBe(true);
 expect(hasPaidAccess({trial_until:"2026-10-30T00:00:00Z"},new Date("2026-10-30T00:00:00Z"))).toBe(false);
});
test("normalize phone numbers",()=>{
 expect(normalizePhone("8 (999) 123-45-67")).toBe("79991234567");
 expect(normalizePhone("+7 999 123-45-67")).toBe("79991234567");
 expect(normalizePhone("123")).toBeNull();
});
