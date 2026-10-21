import {test,expect} from "bun:test";
import {leavingToHome,HOME_EXIT_STATES} from "../navigation-state.ts";

test("Home exits text-entry routes and discards only transient targeting keys",()=>{
 for(const state of HOME_EXIT_STATES){
  const before={state,filters:{city:"Москва",profileDraft:{"имя":"Анна"},reportTarget:{user:24},replyJobId:3,relayPeer:52}};
  const result=leavingToHome(before);
  expect(result.state).toBe("");
  expect(result.filters.city).toBe("Москва");
  expect(result.filters.profileDraft["имя"]).toBe("Анна");
  expect(result.filters.reportTarget).toBeUndefined();
  expect(result.filters.replyJobId).toBeUndefined();
  expect(result.filters.relayPeer).toBeUndefined();
  expect(before.state).toBe(state);
  expect(before.filters.reportTarget).toEqual({user:24});
 }
});
test("unfinished wizards remain resumable and ordinary Home is a no-op",()=>{
 expect(leavingToHome({state:"wizard"})).toBeNull();
 expect(leavingToHome({state:"job_wizard"})).toBeNull();
 expect(leavingToHome({state:""})).toBeNull();
});
test("Home cancels a pending permanent deletion rather than confirming it",()=>{
 const outcome=leavingToHome({state:"delete_confirm",filters:{}});
 expect(outcome.state).toBe("");
});

test("Home keeps profile and job confirmations active so Save/Publish buttons still work",()=>{
 for(const state of ["profile_confirm","job_confirm","job_edit_confirm"]){
  const draft={state,filters:{draft:{город:"Москва"},profileDraft:{имя:"Анна"},draftJobId:25}};
  expect(leavingToHome(draft)).toBeNull();
  expect(draft.state).toBe(state);
 }
});
test("Home still stops active free-text job and profile editing",()=>{
 for(const state of ["profile","job","job_edit"]){
  expect(leavingToHome({state,filters:{draftJobId:25}}).state).toBe("");
 }
});
