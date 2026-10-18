import {test,expect} from "bun:test";

// Static navigation contract: no database or Telegram credentials are required.
// This catches accidental removal of a handler while changing the main menu.
const source=await Bun.file(new URL("../bot.ts",import.meta.url)).text();
const menuSource=source.slice(source.indexOf("const menu="),source.indexOf("const esc="));
const actions=Object.fromEntries([
 ["profile",'if(a==="profile")'],
 ["browse:0",'if(a.startsWith("browse:"))'],
 ["jobs",'if(a==="jobs"||a.startsWith("jobs:"))'],
 ["new",'if(a==="new")'],
 ["filters",'if(a==="filters")'],
 ["mine",'if(a==="mine"||a.startsWith("mine:"))'],
 ["myresponses",'if(a==="myresponses")'],
 ["myinvites",'if(a==="myinvites")'],
 ["pause",'if(a==="pause")'],
 ["how",'if(c.data==="how")'],
 ["more",'if(a==="more")']
]);

test("every button in the main navigation has a corresponding action handler",()=>{
 const callbacks=[...menuSource.matchAll(/callback_data:"([^"]+)"/g)].map(match=>match[1]);
 expect(callbacks.sort()).toEqual(Object.keys(actions).sort());
 const callbackHandlers=source.slice(source.indexOf("async function onCallback("));
 for(const callback of callbacks)expect(callbackHandlers.includes(actions[callback])).toBe(true);
});
test("consent buttons and navigation use separate handlers",()=>{
 for(const route of ['test:consent:','test:docs','test:agree']){
  expect(source).toContain(route);
 }
 expect(source).toContain("toggleTestAcknowledgement(sql,id,n)");
 expect(source).toContain("activateTestAccess(sql,id)");
 expect(source).toContain("revokeTestAccess(sql,id)");
});
test("unknown old inline keyboards receive visible feedback",()=>{
 expect(source).toContain("Эта кнопка больше не действует.");
});

test("Home action is handled before consent gating and clears stale text-input modes",()=>{
 const callbackSection=source.slice(source.indexOf("async function onCallback("));
 const home=callbackSection.indexOf('if(a==="home"){');
 const guarded=callbackSection.indexOf('if(Bun.env.REGISTRATION_ENABLED!=="true"');
 expect(home).toBeGreaterThan(0);
 expect(guarded).toBeGreaterThan(home);
 expect(callbackSection).toContain("leavingToHome(u)");
});
test("new users retain deep-link intent through all three checkmarks",()=>{
 expect(source).toContain("parseStartTarget(text)||parseReferralStart(text)");
 expect(source).toContain("pendingStartTarget");
 expect(source).toContain("safeRegistrationTarget(u.filters?.pendingStartTarget)");
 expect(source).toContain("parseReferralOnboard(a)");
});

test("jobs and personal listings use bounded pages instead of sending 20–30 cards",()=>{
 const callback=source.slice(source.indexOf("async function onCallback("));
 expect(callback).toContain('parsePageOffset(a,"jobs")');
 expect(callback).toContain('parsePageOffset(a,"mine")');
 expect(callback).toContain('pageNavigation("jobs",offset,js.length>offset+5)');
 expect(callback).toContain('pageNavigation("mine",offset,items.length>5)');
 expect(callback).toContain('const page=js.slice(offset,offset+5)');
 expect(callback).toContain('const page=items.slice(0,5)');
});

test("invitation issue serializes double-clicks and queues delivery instead of synchronously sending a profile",()=>{
 const cb=source.slice(source.indexOf("async function onCallback("));
 const issue=cb.slice(cb.indexOf('if(a.startsWith("invite:"))'),cb.indexOf('if(a.startsWith("rejectinvite:"))'));
 expect(source).toContain("const inviteCreationQueue=createConsentEditQueue()");
 expect(issue).toContain("inviteCreationQueue(id,async()=>");
 expect(issue).toContain("queueInitialInvitation(sql,invited.id)");
 expect(issue).toContain("queueInitialInvitation(sql,duplicate.id)");
 expect(issue).not.toContain("await profile(p.id,u");
});
test("accepted invitation and accepted response actions are recovered by durable retry queues",()=>{
 expect(source).toContain("acceptInvitationForRecipient(sql,inviteId,id)");
 expect(source).toContain("acceptResponseForOwner(sql,responseId,id)");
 expect(source).toContain("processAcceptedInvitationOutbox()");
 expect(source).toContain("processAcceptedResponseOutbox()");
 expect(source).toContain("processInvitationOutbox()");
});
