import {test,expect} from "bun:test";
import {resumeMenu} from "../resume-menu.ts";

function activeAction(user){
 const m=resumeMenu(user);
 return {label:m.label,callbacks:m.rows.flat().map(b=>b.callback_data)};
}
test("current job wizard has priority over an older unfinished profile draft",()=>{
 const result=activeAction({state:"job_wizard",filters:{profileDraft:{"имя":"Анна"},jobWizardDraft:{"название заявки":"ТФП"}}});
 expect(result.label).toContain("заявка");
 expect(result.callbacks).toEqual(["jobwizard:resume","jobwizard:cancel"]);
 expect(result.callbacks).not.toContain("edit_profile");
});
test("job publication confirmation is shown before any old profile draft",()=>{
 const r=activeAction({state:"job_confirm",filters:{draft:{"название заявки":"Каталог"},profileDraft:{"имя":"Анна"}}});
 expect(r.callbacks).toEqual(["publish","job_template"]);
 expect(r.label).toContain("заявка");
});
test("editing own job can be resumed and completed from the menu",()=>{
 const edit=activeAction({state:"job_edit",filters:{draftJobId:45,profileDraft:{"имя":"Анна"}}});
 expect(edit.callbacks).toEqual(["jobedit:45","mine"]);
 const confirm=activeAction({state:"job_edit_confirm",filters:{draftJobId:45,draft:{"город":"Москва"},profileDraft:{"имя":"Анна"}}});
 expect(confirm.callbacks).toEqual(["updatejob:45","mine"]);
});
test("invalid or stale edit identifiers cannot leak into callback routes",()=>{
 const u={state:"job_edit",filters:{draftJobId:"not-a-number",profileDraft:{имя:"Анна"}}};
 expect(activeAction(u).callbacks).toEqual(["edit_profile","wizard:cancel"]);
});
test("photo upload is recoverable even if a profile draft exists",()=>{
 const r=activeAction({state:"photo",filters:{profileDraft:{имя:"Анна"}}});
 expect(r.callbacks).toEqual(["addphoto","photo_done"]);
 expect(r.label).toContain("фотографии");
});
test("profile wizard, editor and final confirmation remain recoverable",()=>{
 expect(activeAction({state:"wizard",filters:{}}).callbacks).toEqual(["wizard:resume","wizard:cancel"]);
 expect(activeAction({state:"profile",filters:{profileDraft:{имя:"Анна"}}}).callbacks).toEqual(["edit_profile","wizard:cancel"]);
 expect(activeAction({state:"profile_confirm",filters:{profileDraft:{имя:"Анна"}}}).callbacks).toEqual(["profile_save","edit_profile"]);
});
test("idle user has no unnecessary resume buttons; no user data changes",()=>{
 const u={state:"",filters:{city:"Казань"}};
 const before=JSON.stringify(u);
 const result=resumeMenu(u);
 expect(result).toEqual({label:"",rows:[]});
 expect(JSON.stringify(u)).toBe(before);
});

test("after Home, job edit draft takes priority over stale profile draft",()=>{
 const r=activeAction({state:"",filters:{draftJobId:85,profileDraft:{"имя":"Анна"}}});
 expect(r.label).toContain("заявку");
 expect(r.callbacks).toEqual(["jobedit:85","mine"]);
});
test("after Home, saved job template stays accessible before older profile draft",()=>{
 const r=activeAction({state:"",filters:{draft:{"город":"Москва"},profileDraft:{"имя":"Анна"}}});
 expect(r.label).toContain("заявки");
 expect(r.callbacks).toEqual(["job_template","mine"]);
});
test("invalid interrupted job edit ID never surfaces arbitrary callbacks",()=>{
 for(const bad of [-5,"oops",0,"12.5",Number.MAX_SAFE_INTEGER+1]){
  const r=activeAction({state:"",filters:{draftJobId:bad,profileDraft:{"имя":"Анна"}}});
  expect(r.callbacks).toEqual(["edit_profile","wizard:cancel"]);
 }
});
