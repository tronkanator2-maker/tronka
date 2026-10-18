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
 ["more",'if(a==="more")'],
 ["demo:home",'if(c.data?.startsWith("demo:"))']
]);

test("every button in the main navigation has a corresponding action handler",()=>{
 const callbacks=[...menuSource.matchAll(/callback_data:"([^"]+)"/g)].map(match=>match[1]);
 expect(callbacks.sort()).toEqual(Object.keys(actions).sort());
 const callbackHandlers=source.slice(source.indexOf("async function onCallback("));
 for(const callback of callbacks)expect(callbackHandlers.includes(actions[callback])).toBe(true);
});
test("developer startup no longer draws or persists checkbox agreement",()=>{
 const callback=source.slice(source.indexOf("async function onCallback("));
 expect(source).not.toContain("testConsentBoard");
 expect(source).not.toContain("activateTestAccess(sql,id)");
 expect(source).not.toContain("toggleTestAcknowledgement(sql,id,n)");
 expect(source).not.toContain("jsonb_set(COALESCE(filters");
 expect(callback).toContain('if(a.startsWith("test:consent:")||a==="test:docs"||a==="test:agree")return begin(u)');
 expect(source).toContain("return send(u.id,testMenuText");
 expect(source).toContain("if(!fullConsentsCurrent(u.consent,hashes))");
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
test("developer shared links work directly, without mandatory pending consent",()=>{
 expect(source).toContain("parseStartTarget(t)?.kind");
 expect(source).toContain("parseReferralStart(text)");
 expect(source).toContain("parseOnboardTarget(a)");
 expect(source).not.toContain("pendingStartTarget");
 expect(source).toContain('INSERT INTO mm_referrals(inviter,invitee) SELECT id,$2 FROM mm_users');
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

test("sample catalog button opens twenty explicitly fictional cards, no live response or invite callbacks",()=>{
 expect(source).toContain('callback_data:"demo:home"');
 expect(source).toContain('if(c.data?.startsWith("demo:"))return demoScreen');
 expect(source).toContain('demoPage(route.type,route.page)');
 expect(source).toContain('demoItem(route.type,route.id)');
 const demo=source.slice(source.indexOf("function demoMenu()"),source.indexOf("let responseWorkerRunning=false;"));
 expect(demo).toContain("вымышлен");
 expect(demo).not.toContain('"reply:"');
 expect(demo).not.toContain('"invite:"');
 expect(demo).not.toContain('"relay:"');
});
test("new editor accepts pasted template before choosing a role and provides working guided routes",()=>{
 const callback=source.slice(source.indexOf("async function onCallback(c){"));
 const editor=callback.slice(callback.indexOf('if(a==="edit_profile"){'),callback.indexOf('if(a==="profile_save"){'));
 expect(editor.indexOf('await change(id,{state:"profile",filters})')).toBeLessThan(editor.indexOf('return send(id,"📝 <b>Создание анкеты</b>'));
 expect(editor).toContain('a==="template_model"||a==="template_client"');
 expect(editor).toContain('if(a==="profile_step_model"||a==="profile_step_client")');
 expect(editor).toContain('return startWizard(u,role)');
 expect(editor).toContain('"profile_templates"');
 expect(editor).toContain('"wizard:cancel"');
 expect(editor).toContain('"home"');
 expect(source).toContain('if(u.state==="profile"){');
});

test("saving profile, photos or search filters queues work instead of blocking callbacks with fanout",()=>{
 const callback=source.slice(source.indexOf("async function onCallback(c){"));
 const message=source.slice(source.indexOf("async function onMessage(m){"),source.indexOf("async function onCallback(c){"));
 expect(source).toContain("await prepareProfileRefreshQueue(sql)");
 expect(source).toContain("runProfileRefreshBatch(sql,sendMatchedProfile,deliverTo");
 expect(source).toContain("processProfileRefresh()");
 expect(callback).toContain("if(fresh.photo)await queueProfileRefresh(sql,id)");
 expect(message).toContain("await queueProfileRefresh(sql,id)");
 expect(callback).not.toContain("await profileBackfill(fresh)");
 expect(callback).not.toContain("await backfill(fresh)");
 expect(message).not.toContain("await profileBackfill(fresh)");
 expect(message).not.toContain("await backfill(fresh)");
});
