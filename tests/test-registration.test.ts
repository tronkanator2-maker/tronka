import {test,expect} from "bun:test";
import {isTestMode,canRegister,canUseTestFeatures,testWarning} from "../test-mode.ts";
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
 expect(canUseTestFeatures(testEnv,{test_access:true})).toBe(true);
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
