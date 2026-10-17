import {test,expect} from "bun:test";
import {profileDraftOf,stageProfileDraft,discardProfileDraft,mergeProfilePhoto} from "../profile-draft.ts";
test("draft editing never changes public profile before explicit save",()=>{
 const user={profile:{"имя":"Старая анкета","город":"Москва"},filters:{city:"Москва"}};
 const draft={...profileDraftOf(user),"город":"Казань"};
 const staged=stageProfileDraft(user.filters,draft,{wizardRole:"модель",wizardStep:4});
 expect(user.profile["город"]).toBe("Москва");
 expect(staged.profileDraft["город"]).toBe("Казань");
 expect(staged.city).toBe("Москва");
 expect(profileDraftOf({...user,filters:staged})["город"]).toBe("Казань");
});
test("cancel discards all temporary fields and preserves existing filters",()=>{
 const filters={city:"Москва",adult:false,profileDraft:{"город":"Тула"},profileDraftPhoto:"photo-1",wizardRole:"модель",wizardStep:4};
 expect(discardProfileDraft(filters)).toEqual({city:"Москва",adult:false});
 expect(filters.profileDraftPhoto).toBe("photo-1");
});
test("committing an existing photo preserves ordering and avoids duplicates",()=>{
 expect(mergeProfilePhoto(["first","second"],"second")).toEqual(["first","second"]);
 expect(mergeProfilePhoto(["first"],"third")).toEqual(["first","third"]);
 expect(mergeProfilePhoto([],null)).toEqual([]);
 expect(mergeProfilePhoto(["a","b","c","d","e"],"f")).toEqual(["a","b","c","d","e"]);
});
