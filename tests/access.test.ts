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

import {startPhoneTrial} from "../access.ts";
test("claiming a one-time trial is atomic and does not store clear-text phone",async()=>{
 const operations=[];
 const fake=async(query,...args)=>{operations.push({query,args});return [{trial_until:"2026-11-01T00:00:00Z"}]};
 const result=await startPhoneTrial(fake,42,"+7 900 555-44-33","unit-test-pepper");
 expect(result.started).toBe(true);
 expect(operations).toHaveLength(1);
 expect(operations[0].query).toContain("WITH claimed AS");
 expect(operations[0].query).toContain("UPDATE mm_users");
 expect(operations[0].args[0]).not.toContain("79005554433");
 expect(operations[0].args[1]).toBe(42);
});
test("missing dedicated pepper never consumes trial",async()=>{
 let count=0;
 const result=await startPhoneTrial(async()=>{count++;return []},11,"+7 900 555-44-33","");
 expect(result.started).toBe(false);
 expect(count).toBe(0);
});
