// Explicit, isolated test-onboarding rules. They are NOT legal-policy consents.
export const isTestMode = env => env.TEST_MODE==="true";
export const canRegister = (env,hasApprovedLegalDocs) =>
 env.REGISTRATION_ENABLED==="true" && (isTestMode(env)||hasApprovedLegalDocs);
export const canUseTestFeatures = (env,consent) =>
 isTestMode(env) && consent?.test_access===true;
export const testWarning =
 "✨ <b>Добро пожаловать в «Мир моделей»!</b>\n" +
 "Здесь можно создать анкету, найти съёмку, разместить заявку и связаться с участниками.\n\n"+
 "Нажимая «Начать», вы разрешаете сервису сохранять введённые вами данные и показывать опубликованную анкету другим участникам. " +
 "Не размещайте конфиденциальные сведения. Удалить данные и отозвать разрешение можно в разделе «Личные данные».";
export const testMenuText =
 "✨ <b>Мир моделей</b>\nВыберите, что хотите сделать.";
