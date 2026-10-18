import {test,expect} from "bun:test";
import {parseStartTarget,parseOnboardTarget} from "../deep-links.ts";

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
