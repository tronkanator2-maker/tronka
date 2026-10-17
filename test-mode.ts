// Explicit, isolated test-onboarding rules. They are NOT legal-policy consents.
export const isTestMode = env => env.TEST_MODE==="true";
export const canRegister = (env,hasApprovedLegalDocs) =>
 env.REGISTRATION_ENABLED==="true" && (isTestMode(env)||hasApprovedLegalDocs);
export const canUseTestFeatures = (env,consent) =>
 isTestMode(env) && consent?.test_access===true;
export const testWarning =
 "🧪 <b>ТЕСТОВЫЙ РЕЖИМ</b>\nЭто техническая версия, не коммерческий сервис. " +
 "Используйте вымышленные данные, тестовое фото и тестовые объявления. " +
 "Не отправляйте паспорт, настоящий номер телефона, адрес или личные материалы. " +
 "Платежи и проверка личности не работают. Для участия подтвердите тестовые условия.";
export const testMenuText =
 "🧪 <b>МИР МОДЕЛЕЙ · ТЕСТ</b>\n"+
 "Функции открыты для проверки: анкеты, фото, поиск, заявки, отклики и приглашения. "+
 "Тестовые записи могут быть удалены перед запуском.";
