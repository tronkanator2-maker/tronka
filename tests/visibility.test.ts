import {test,expect} from "bun:test";
import {redactContacts,publicProfileEntries,publicProfileAllowed} from "../visibility.ts";
test("hides Telegram handles, t.me links, phone numbers and email",()=>{
 const input="Контакт @model_anna77, t.me/agent_partner, anna@example.com, +7 (999) 111-22-33";
 const cleaned=redactContacts(input);
 for(const secret of ["@model_anna77","agent_partner","anna@example.com","999"])expect(cleaned).not.toContain(secret);
 expect(cleaned).toContain("[контакт скрыт]");
});
test("hides personal social accounts but keeps studio portfolio websites",()=>{
 const input="Instagram: https://instagram.com/creative.agency , portfolio: https://www.behance.net/portfolio";
 const cleaned=redactContacts(input);
 expect(cleaned).not.toContain("creative.agency");
 expect(cleaned).toContain("behance.net/portfolio");
});
test("hides fields with direct contact metadata, not basic creative details",()=>{
 const lines=publicProfileEntries({"Имя":"Анна","Город":"Москва","Телефон":"+79990001122","Портфолио":"https://www.behance.net/anna","E-mail":"anna@example.org","О себе":"пишите @anna_models"});
 expect(lines.some(([key])=>key==="Телефон"||key==="E-mail")).toBe(false);
 expect(lines.some(([key,value])=>key==="Портфолио"&&value.includes("behance.net"))).toBe(true);
 expect(lines.find(([key])=>key==="О себе")[1]).not.toContain("@anna_models");
});
test("only complete and consented active users may appear in catalogue or receive invites",()=>{
 const valid={active:true,blocked:false,suspended:false,consent:{0:true},profile:{name:"Ann"},photo:"file-id"};
 const consent=c=>c?.[0]===true,complete=(profile,photo)=>!!profile?.name&&!!photo;
 expect(publicProfileAllowed(valid,{},consent,complete)).toBe(true);
 expect(publicProfileAllowed({...valid,active:false},{},consent,complete)).toBe(false);
 expect(publicProfileAllowed({...valid,suspended:true},{},consent,complete)).toBe(false);
 expect(publicProfileAllowed({...valid,consent:{}},{},consent,complete)).toBe(false);
 expect(publicProfileAllowed({...valid,photo:null},{},consent,complete)).toBe(false);
});
