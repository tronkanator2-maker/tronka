import {test,expect} from "bun:test";
import {parseStartTarget,parseOnboardTarget,parseReferralStart,parseReferralOnboard,safeRegistrationTarget} from "../deep-links.ts";

test("shared job and profile links retain safe targets through onboarding",()=>{
 expect(parseStartTarget("/start job_123")).toEqual({kind:"job",id:123,callback:"job_123"});
 expect(parseStartTarget("/start profile_42")).toEqual({kind:"profile",id:42,callback:"profile_42"});
 expect(parseStartTarget("/start@ann_agensy_bot job_123")).toEqual({kind:"job",id:123,callback:"job_123"});
 expect(parseOnboardTarget("job_123")).toEqual({kind:"job",id:123});
 expect(parseOnboardTarget("profile_42")).toEqual({kind:"profile",id:42});
});
test("untrusted and oversized parameters are not passed to callbacks or SQL",()=>{
 for(const input of ["/start","/start ref_123","/start job_0","/start job_-2","/start job_9999999999999999999","/start profile_bad","/start profile_1;DROP TABLE mm_users","/start job_42 other","/start other_12"]){
  expect(parseStartTarget(input)).toBeNull();
 }
 for(const input of ["job_0","job_9999999999999999999","profile_bad","profile_3;DROP","other_5","onboard:job_5"]){
  expect(parseOnboardTarget(input)).toBeNull();
 }
});

test("a new user's destination survives three consent checkboxes",()=>{
 for(const [command,destination] of [
  ["/start job_123","job_123"],
  ["/start profile_42","profile_42"],
  ["/start ref_789123","ref_789123"],
  ["/start@ann_agensy_bot ref_789123","ref_789123"]
 ]){
  const target=parseStartTarget(command)||parseReferralStart(command);
  expect(target.callback).toBe(destination);
  const afterOneCheckbox=safeRegistrationTarget(target.callback);
  const afterTwoCheckboxes=safeRegistrationTarget(afterOneCheckbox);
  const afterAllThree=safeRegistrationTarget(afterTwoCheckboxes);
  expect(afterAllThree).toBe(destination);
 }
 expect(parseReferralStart("/start ref_789")).toEqual({kind:"ref",id:789,callback:"ref_789"});
 expect(parseReferralOnboard("ref_789")).toEqual({kind:"ref",id:789});
});
test("referrals cannot smuggle invalid IDs into onboarding",()=>{
 for(const text of ["/start ref_0","/start ref_-1","/start ref_9999999999999999999","/start ref_77_extra","/start ref_78;DROP", "/start ref_1 other"]){
  expect(parseReferralStart(text)).toBeNull();
 }
 for(const callback of ["ref_0","ref_-1","ref_9999999999999999999","ref_bad","ref_1;DELETE", "garbage","onboard:job_5"]){
  expect(safeRegistrationTarget(callback)).toBeNull();
 }
 expect(safeRegistrationTarget("profile_999")).toBe("profile_999");
 expect(safeRegistrationTarget("job_888")).toBe("job_888");
});
