import {test,expect} from "bun:test";

// Static navigation contract: no database or Telegram credentials are required.
// This catches accidental removal of a handler while changing the main menu.
const source=await Bun.file(new URL("../bot.ts",import.meta.url)).text();
const dispatcherSource=await Bun.file(new URL("../telegram-dispatch.ts",import.meta.url)).text();
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
test("Telegram webhook durably queues messages and retries processing after failures",()=>{
 const webhook=source.slice(source.indexOf('if(u.pathname==="/webhook"'),source.indexOf("try{await ensure()}catch"));
 const worker=source.slice(source.indexOf("async function handleTelegramUpdate("),source.indexOf("async function processInvitationOutbox()"));
 expect(webhook).toContain("INSERT INTO mm_telegram_update_queue");
 expect(webhook).toContain('return new Response("ok")');
 expect(webhook).not.toContain('INSERT INTO mm_updates(id)');
 expect(worker).toContain("FOR UPDATE SKIP LOCKED");
 expect(worker).toContain('acknowledge:callbackId=>call("answerCallbackQuery"');
 expect(worker).toContain("return dispatchTelegramUpdate(x,{");
 expect(dispatcherSource).toContain("INSERT INTO mm_updates(id)");
 expect(worker).toContain("Queued Telegram update failed");
 expect(worker).toContain('typeof row.payload==="string"?JSON.parse(row.payload):row.payload');
 expect(worker).toContain("Number.isSafeInteger(payload.update_id)");
 expect(worker).toContain("next_attempt_at=NOW()");
 expect(dispatcherSource).toContain('log.error("Callback action failed"');
 expect(dispatcherSource).toContain("throw error;");
});
test("user-facing sample pages use clear fictional-example labels and no demo branding",()=>{
 const exampleMenu=source.slice(source.indexOf("function demoMenu()"),source.indexOf("let profileRefreshWorkerRunning"));
 expect(exampleMenu).toContain("Примеры анкет");
 expect(exampleMenu).toContain("Примеры заявок");
 expect(exampleMenu).toContain("Вымышленный пример");
 expect(exampleMenu).not.toMatch(/демо/i);
 expect(source).toContain('{command:"examples",description:"Примеры анкет и заявок"}');
 expect(source).not.toContain('{command:"demo"');
 expect(source).not.toContain('"/demo"');
});

test("examples keep job creation available and show a future reply flow without writing a fake response",()=>{
 const exampleMenu=source.slice(source.indexOf("function demoMenu()"),source.indexOf("let profileRefreshWorkerRunning"));
 const callback=source.slice(source.indexOf("async function onCallback(c){"));
 expect(exampleMenu).toContain('"➕ Создать свою заявку","new"');
 expect(exampleMenu).toContain('"sample:reply:"+item.id');
 expect(callback).toContain('if(c.data?.startsWith("sample:reply:"))');
 expect(callback).toContain("Отправка откликов по карточкам-примерам пока недоступна.");
 expect(callback).toContain('buttons([[["➕ Создать свою заявку","new"]]');
 expect(callback).toContain('if(a==="new")return send');
 expect(callback).toContain('if(a.startsWith("reply:"))');
 const placeholder=callback.slice(callback.indexOf('if(c.data?.startsWith("sample:reply:"))'),callback.indexOf('if(c.data?.startsWith("demo:"))'));
 expect(placeholder).not.toContain("INSERT INTO mm_responses");
});
test("the create-job menu still opens both real creation flows and publishing prevents duplicates",()=>{
 const callback=source.slice(source.indexOf("async function onCallback(c){"));
 const create=callback.slice(callback.indexOf('if(a==="new")'),callback.indexOf('if(a==="jobs"||a.startsWith("jobs:"))'));
 expect(create).toContain('"jobwizard:start"');
 expect(create).toContain('"job_template"');
 expect(callback).toContain('if(a==="job_template")');
 expect(callback).toContain('if(a==="jobwizard:start")');
 expect(callback).toContain('if(a==="publish")');
 expect(callback).toContain("ON CONFLICT DO NOTHING RETURNING *");
 expect(callback).toContain('already.id+" уже опубликована. Вторую копию не создаём."');
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
test("job and profile listings use compact bounded pages and personal listings stay paginated",()=>{
 const callback=source.slice(source.indexOf("async function onCallback("));
 expect(callback).toContain('parsePageOffset(a,"jobs")');
 expect(callback).toContain('parsePageOffset(a,"mine")');
 expect(callback).toContain('pageNavigation("mine",offset,items.length>5)');
 expect(callback).toContain('const page=js.slice(offset,offset+5)');
 expect(source).toContain('const rendered=renderJobsPage(js,offset,sampleJobs,hasProfile)');
 expect(callback).toContain('if(a.startsWith("job_view:"))');
 expect(callback).toContain('const page=items.slice(0,5)');
});

test("search preloads consent document hashes once for the whole matching batch",()=>{
 const matcher=source.slice(source.indexOf("async function matches("),source.indexOf("async function deliverTo("));
 const search=source.slice(source.indexOf("async function matchingJobs("),source.indexOf("async function browseProfiles("));
 expect(matcher).toContain("async function matches(u,j,documentHashes=null)");
 expect(search).toContain("const [jobs,hashes]=await Promise.all([");
 expect((search.match(/currentDocumentHashes\(\)/g)||[]).length).toBe(1);
 expect(search).toContain("matches(u,job,hashes)");
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

test("fictional samples are available in normal search and registration preview, without a demo main-menu button",()=>{
 expect(menuSource).not.toContain('callback_data:"demo:home"');
 expect(source).toContain('const sampleProfiles=demoProfiles');
 expect(source).toContain('const sampleJobs=demoJobs');
 expect(source).toContain('"Открыть пример анкеты","demo:profile:"+person.id');
 expect(source).toContain('"Открыть пример заявки","demo:job:"+job.id');
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

test("catalog page sends one summary and opens one currently visible profile at a time",()=>{
 const listing=source.slice(source.indexOf("async function browseProfiles("),source.indexOf("async function chooseBrowseRole("));
 expect(listing).toContain("renderCatalogPage(publicProfiles,offset,city,requested,sampleProfiles)");
 expect(listing).not.toContain("await profile(");
 expect(listing.match(/\bsend\(/g)?.length).toBe(1);
 const callback=source.slice(source.indexOf('if(a.startsWith("profile_view:"))'),source.indexOf('if(a.startsWith("browse:"))'));
 expect(callback).toContain("publicProfileAllowed(target");
 expect(callback).toContain('return profile(id,target,"Анкета в каталоге","browse:"+offset)');
});

test("a sixth new photo gives a visible limit response and does not trap upload state",()=>{
 const upload=source.slice(source.indexOf('if(m.photo?.length&&u.state==="photo")'),source.indexOf('if(u.state==="relay")'));
 expect(source).toContain("INSERT INTO mm_user_recovery(user_id,field,value) SELECT id,'photos',photos");
 expect(source).toContain("SET photos=CASE WHEN photo IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(photo) END");
 expect(upload).toContain("CASE WHEN jsonb_typeof(photos)='array' THEN jsonb_array_length(photos)<5");
 expect(upload).toContain('if(!saved.length)');
 expect(upload).toContain('await change(id,{state:""})');
 expect(upload).toContain('"🖼 Управление фото","photos"');
 const callback=source.slice(source.indexOf('if(a==="addphoto")'),source.indexOf('if(a==="photo_done")'));
 expect(callback).toContain('u.photos.length>=5');
 expect(callback.indexOf('u.photos.length>=5')).toBeLessThan(callback.indexOf('await change(id,{state:"photo"})'));
});

test("the client-facing feature page separates working flows from pending integrations",()=>{
 const callback=source.slice(source.indexOf("async function onCallback(c){"));
 expect(callback).toContain('if(a==="feature_status")');
 expect(callback).toContain("Создание и публикация заявок");
 expect(callback).toContain("Реальные отклики");
 expect(callback).toContain("не действуют как документы");
 expect(callback).toContain("Оплата и возвраты");
 expect(callback).toContain("Сейчас бот открыт в тестовом режиме");
});
test("registration preview explains why real profile and job flows are blocked",()=>{
 const preview=source.slice(source.indexOf("function registrationPreview(to){"),source.indexOf("async function begin(u){"));
 expect(preview).toContain("Заполнение анкеты и заявок пока закрыто");
 expect(preview).toContain("обязательные документы не опубликованы");
 expect(preview).toContain("Для проверки всех сценариев включите тестовый режим");
 expect(preview).toContain('"📄 Документы сервиса","docs"');
});

test("matched-profile delivery persists successful heading/media and does not repeat them after card text failure",()=>{
 const server=source.slice(source.indexOf("async function profile(to,u"),source.indexOf("async function card(to,j"));
 const matches=source.slice(source.indexOf("async function sendMatchedProfile(job,p)"),source.indexOf("async function profileBackfill(p)"));
 expect(source).toContain("await prepareProfileDeliveryProgress(sql)");
 expect(server).toContain("if(!delivery?.skipMedia)");
 expect(server).toContain("if(delivery?.onMediaSent)await delivery.onMediaSent()");
 expect(matches).toContain("deliverMatchedProfileProgress(sql,job.id,p.id");
 expect(matches).toContain('delivery=>profile(job.owner,p,"Анкета подходящего участника",null,delivery)');
 expect(matches).not.toContain("DELETE FROM mm_profile_deliveries");
});
test("Telegram user loading no longer adds database round trips for every tapped button",()=>{
 expect(source).toContain("async function who(from){return loadTelegramUser(sql,from)}");
 expect(source).toContain('import {loadTelegramUser} from "./telegram-user.ts"');
});

test("job management explicitly sets visibility and never toggles the same job twice",()=>{
 const callback=source.slice(source.indexOf("async function onCallback(c){"));
 const start=callback.indexOf('if(a.startsWith("jobpause:")){');
 const end=callback.indexOf('if(a.startsWith("close:")){',start);
 expect(start).toBeGreaterThan(-1);
 expect(end).toBeGreaterThan(start);
 const route=callback.slice(start,end);
 expect(source).toContain("jobVisibilityCallback(j)");
 expect(route).toContain("parseJobVisibilityAction(a)");
 expect(route).toContain("setJobVisibility(sql,id,action)");
 expect(route).not.toContain("paused=NOT paused");
 expect(route).not.toContain("await dispatch(rows[0])");
});
test("main menu and filters expose idempotent search controls; legacy pause requires explicit choice",()=>{
 expect(source).toContain("searchMenuFor(menu,u).inline_keyboard");
 expect(source).toContain('send(u.id,"<b>✨ Мир моделей</b>\\nВыберите раздел.",searchMenuFor(menu,u))');
 expect(source).toContain("searchAction(u)");
 expect(source).toContain('if(a==="pause"){');
 expect(source).toContain('if(a==="search:stop"||a==="search:resume"){');
 expect(source).toContain("setSearchActive(sql,id,desired)");
 expect(source).not.toContain("active:!u.active");
});

test("PostgreSQL BIGINT string owners cannot be mistaken for a registered person",()=>{
 expect(source).toContain("external=Number(j.owner)===0");
 expect(source).toContain("Number(j.owner)!==0");
 expect(source).toContain("const owner=Number(j.owner)===0?null:");
 expect(source).toContain("String(job.owner)===String(p.id)");
 expect(source).toContain("String(job.owner)===String(id)");
 expect(source).not.toContain("j.owner===0");
 expect(source).not.toContain("j.owner!==0");
 expect(source).not.toContain("job.owner===0");
});
