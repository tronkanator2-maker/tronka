import {test,expect} from "bun:test";
import {isTestMode,canRegister,canUseTestFeatures,hasTestAcknowledgements,isPreConsentCommand,testWarning} from "../test-mode.ts";
import {parseFields,field} from "../engine.ts";

const testEnv={REGISTRATION_ENABLED:"true",TEST_MODE:"true"};
test("test registration opens before legal documents are published, but only in test mode",()=>{
 expect(isTestMode(testEnv)).toBe(true);
 expect(canRegister(testEnv,false)).toBe(true);
 expect(canRegister({REGISTRATION_ENABLED:"true",TEST_MODE:"false"},false)).toBe(false);
 expect(canRegister({REGISTRATION_ENABLED:"true",TEST_MODE:"false"},true)).toBe(true);
 expect(canRegister({REGISTRATION_ENABLED:"false",TEST_MODE:"true"},false)).toBe(false);
});
test("test consent is distinct from published legal consent",()=>{
 expect(canUseTestFeatures(testEnv,{})).toBe(false);
 expect(canUseTestFeatures(testEnv,{0:true,1:true,2:true})).toBe(false);
 expect(canUseTestFeatures(testEnv,{test_access:true})).toBe(false);
 expect(canUseTestFeatures(testEnv,{test_access:true,test_check_0:true,test_check_1:true,test_check_2:true})).toBe(true);
 expect(canUseTestFeatures(testEnv,{test_access:false})).toBe(false);
 expect(canUseTestFeatures({TEST_MODE:"false"},{test_access:true})).toBe(false);
 expect(testWarning).toContain("Добро пожаловать");
 expect(testWarning).toContain("разрешаете сервису сохранять");
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

test("three separate onboarding acknowledgements are required",()=>{
 const flags={test_check_0:true,test_check_1:true,test_check_2:true};
 expect([0,1,2].every(i=>flags["test_check_"+i]===true)).toBe(true);
 for(const i of [0,1,2])expect([0,1,2].every(j=>({...flags,["test_check_"+i]:false})["test_check_"+j]===true)).toBe(false);
});

test("access is gated by all three test acknowledgements, not a stale approval flag",()=>{
 const c={test_access:true,test_check_0:true,test_check_1:true,test_check_2:true};
 expect(hasTestAcknowledgements(c)).toBe(true);
 expect(canUseTestFeatures(testEnv,c)).toBe(true);
 for(const i of [0,1,2]){
  const partial={...c,["test_check_"+i]:false};
  expect(hasTestAcknowledgements(partial)).toBe(false);
  expect(canUseTestFeatures(testEnv,partial)).toBe(false);
 }
 expect(canUseTestFeatures(testEnv,{...c,test_access:false})).toBe(false);
});
test("support, privacy and cancellation work before registration",()=>{
 for(const cmd of ["/support","/mydata","/deleteaccount","/cancel","/help","/id","/support hello"])
  expect(isPreConsentCommand(cmd)).toBe(true);
 for(const cmd of ["/start","/somewrongcommand","/supportevil","hi"])
  expect(isPreConsentCommand(cmd)).toBe(false);
});
