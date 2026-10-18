import {test,expect} from "bun:test";
import {isTestMode,canRegister,canUseTestFeatures,hasTestAcknowledgements,isPreConsentCommand,isPreConsentCallback,isPreConsentMessageAllowed,createConsentEditQueue,toggleTestAcknowledgement,activateTestAccess,revokeTestAccess,testWarning} from "../test-mode.ts";
import {parseFields,field} from "../engine.ts";

const testEnv={REGISTRATION_ENABLED:"true",TEST_MODE:"true"};
test("test registration opens before legal documents are published, but only in test mode",()=>{
 expect(isTestMode(testEnv)).toBe(true);
 expect(canRegister(testEnv,false)).toBe(true);
 expect(canRegister({REGISTRATION_ENABLED:"true",TEST_MODE:"false"},false)).toBe(false);
 expect(canRegister({REGISTRATION_ENABLED:"true",TEST_MODE:"false"},true)).toBe(true);
 expect(canRegister({REGISTRATION_ENABLED:"false",TEST_MODE:"true"},false)).toBe(false);
});
test("developer mode opens all sections without checkbox or invented legal consent",()=>{
 for(const c of [undefined,null,{},{"test_access":false},{"test_access":true},{
  "test_check_0":false,"test_check_1":false,"test_check_2":false
 }])expect(canUseTestFeatures(testEnv,c)).toBe(true);
 expect(canUseTestFeatures({TEST_MODE:"true",REGISTRATION_ENABLED:"false"},{})).toBe(false);
 expect(canUseTestFeatures({TEST_MODE:"false",REGISTRATION_ENABLED:"true"},{test_access:true,test_check_0:true,test_check_1:true,test_check_2:true})).toBe(false);
 // Public launch still requires approved versioned legal documents.
 expect(canRegister({REGISTRATION_ENABLED:"true",TEST_MODE:"false"},false)).toBe(false);
 expect(testWarning).not.toContain("ТЕСТОВЫЙ РЕЖИМ");
});
test("copied instructions in model template do not become profile fields",()=>{
 const input="Заполните анкету:\nСкопируйте шаблон и отправьте:\nПсевдоним: Анна\nДата рождения: 12.09.2002\nГород: Москва, Коломна\nПол: женский\nРост: 172\nПараметры: 86-61-90\nРазмер одежды: 42-44\nПрайс: 3000 RUB/час\nФормат: ТФП, коммерция\nПортфолио: https://disk.yandex.ru/d/example";
 const parsed=parseFields(input);
 expect(field(parsed,"имя")).toBe("Анна");
 expect(field(parsed,"город")).toBe("Москва, Коломна");
 expect(field(parsed,"дата рождения")).toBe("12.09.2002");
 expect(parsed["параметры"]).toBe("86-61-90");
 expect(Object.keys(parsed).some(x=>x.includes("заполните")||x.includes("скопируйте"))).toBe(false);
});
test("job date with е instead of ё is normalized",()=>{
 const job=parseFields("Название заявки: Каталог одежды\nДата съемки: 27.10.2026\nГород: Москва");
 expect(job["дата съёмки"]).toBe("27.10.2026");
});

test("historical checkbox values never gate a developer account",()=>{
 const prior={test_access:false,test_check_0:false,test_check_1:false,test_check_2:false};
 expect(hasTestAcknowledgements(prior)).toBe(false);
 expect(canUseTestFeatures(testEnv,prior)).toBe(true);
 for(const i of [0,1,2]){
  const c={...prior,["test_check_"+i]:true};
  expect(canUseTestFeatures(testEnv,c)).toBe(true);
 }
});
test("support, privacy and cancellation work before registration",()=>{
 for(const cmd of ["/support","/mydata","/deleteaccount","/cancel","/help","/id","/support hello"])
  expect(isPreConsentCommand(cmd)).toBe(true);
 for(const cmd of ["/start","/somewrongcommand","/supportevil","hi"])
  expect(isPreConsentCommand(cmd)).toBe(false);
});

test("public support and account menu callbacks bypass the onboarding loop",()=>{
 for(const callback of ["home","more","support","access_info","invitefriend","privacy","privacy:export","privacy:delete","deleteaccount:cancel","deleteaccount:confirm","test:revoke"])
  expect(isPreConsentCallback(callback)).toBe(true);
 for(const callback of ["profile","browse:0","jobs","new","publish","reply:123"])
  expect(isPreConsentCallback(callback)).toBe(false);
});

test("checkbox persistence uses an atomic JSONB update instead of replacing stale JS consent",async()=>{
 const statements=[];
 const query=async (sql,...values)=>{
  statements.push({sql,values});
  return [{consent:{test_check_0:true,test_check_1:true}}];
 };
 const updated=await toggleTestAcknowledgement(query,123456,1);
 expect(updated.changed).toBe(true);
 expect(updated.consent.test_check_0).toBe(true);
 expect(updated.consent.test_check_1).toBe(true);
 expect(statements.length).toBe(1);
 expect(statements[0].values).toEqual([123456,"test_check_1"]);
 expect(statements[0].sql).toContain("jsonb_set");
 expect(statements[0].sql).toContain("consent->>$2::text");
 expect(statements[0].sql).toContain("RETURNING consent");
 // Never write a read-modify-write snapshot of the entire consent object.
 expect(statements[0].sql).not.toContain("SET consent=$");
 expect(await toggleTestAcknowledgement(query,123456,3)).toBeNull();
 expect(statements.length).toBe(1);
});
test("already accepted users cannot unknowingly disable access using old checkbox messages",async()=>{
 let calls=0;
 const query=async text=>{
  calls++;
  if(text.includes("UPDATE"))return [];
  return [{consent:{test_access:true,test_check_0:true,test_check_1:true,test_check_2:true}}];
 };
 const result=await toggleTestAcknowledgement(query,42,0);
 expect(result.changed).toBe(false);
 expect(result.consent.test_access).toBe(true);
 expect(calls).toBe(2);
});
test("confirmation requires three stored database flags, revoke clears them",async()=>{
 let acceptSQL="";
 const blocked=await activateTestAccess(async sql=>{acceptSQL=sql;return []},42);
 expect(blocked).toBeNull();
 for(const key of ["test_check_0","test_check_1","test_check_2"])
  expect(acceptSQL).toContain(key);
 expect(acceptSQL).toContain("RETURNING consent,active");
 const good=await activateTestAccess(async()=>[{consent:{test_access:true},active:true}],42);
 expect(good.consent.test_access).toBe(true);
 let revokeSQL="";
 await revokeTestAccess(async sql=>{revokeSQL=sql;return [{consent:{test_access:false}}]},42);
 expect(revokeSQL).toContain("test_revoked_at");
 for(const key of ["test_check_0","test_check_1","test_check_2"])expect(revokeSQL).toContain("-'"+key+"'");
});

test("support message after tapping Support passes registration gate",()=>{
 expect(isPreConsentMessageAllowed("Не работает кнопка","support")).toBe(true);
 expect(isPreConsentMessageAllowed("/cancel","support")).toBe(true);
 expect(isPreConsentMessageAllowed("Обычное сообщение","")).toBe(false);
 expect(isPreConsentMessageAllowed("Обычное сообщение","delete_confirm")).toBe(false);
});

test("rapid taps on the same consent screen edit in order; different users remain independent",async()=>{
 const queue=createConsentEditQueue();
 const order=[];
 let release;
 const gate=new Promise(resolve=>{release=resolve});
 const first=queue(1,async()=>{order.push("first:start");await gate;order.push("first:end")});
 const second=queue(1,async()=>{order.push("second:start")});
 const third=queue(2,async()=>{order.push("other-user");});
 await third;
 expect(order).toContain("other-user");
 expect(order).not.toContain("second:start");
 release();
 await Promise.all([first,second]);
 expect(order.indexOf("second:start")).toBeGreaterThan(order.indexOf("first:end"));
});
test("a failed Telegram UI edit doesn't permanently block later taps",async()=>{
 const queue=createConsentEditQueue();
 const first=queue(22,async()=>{throw new Error("telegram timeout")});
 const second=queue(22,async()=>true);
 await expect(first).rejects.toThrow("telegram timeout");
 expect(await second).toBe(true);
});
