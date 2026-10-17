import {test,expect} from "bun:test";
import {consentIsCurrent,allConsentsCurrent,requiredDocumentSlugs} from "../documents.ts";
const hashes=Object.fromEntries(requiredDocumentSlugs.map((slug,index)=>[slug,"sha-"+index]));
const consent={"0":true,"1":true,"2":true,"0_hashes":{...hashes},"1_hashes":{...hashes},"2_hashes":{...hashes}};
test("all current document hashes allow separately recorded consents",()=>{
 expect(allConsentsCurrent(consent,hashes)).toBe(true);
});
test("published policy revision forces new explicit consent",()=>{
 const changed={...hashes,privacy:"updated"};
 expect(consentIsCurrent(consent,changed,0)).toBe(false);
 expect(allConsentsCurrent(consent,changed)).toBe(false);
});
test("missing one of three separate consents blocks registration",()=>{
 const incomplete={...consent,2:false};
 expect(allConsentsCurrent(incomplete,hashes)).toBe(false);
});
test("prior bare booleans are not legally equivalent to document-version consent",()=>{
 expect(allConsentsCurrent({0:true,1:true,2:true},hashes)).toBe(false);
});
