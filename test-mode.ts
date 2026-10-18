// Explicit, isolated test-onboarding rules. They are NOT legal-policy consents.
export const isTestMode = env => env.TEST_MODE==="true";
export const canRegister = (env,hasApprovedLegalDocs) =>
 env.REGISTRATION_ENABLED==="true" && (isTestMode(env)||hasApprovedLegalDocs);
export const hasTestAcknowledgements = consent =>
 [0,1,2].every(i=>consent?.["test_check_"+i]===true);
// Development-only access: no checkboxes, no implied agreement, no stored
// legal consent. Production always uses versioned published documents.
export const canUseTestFeatures = (env,_consent) =>
 isTestMode(env) && env.REGISTRATION_ENABLED==="true";
export const isPreConsentCommand = text =>
 /^\/(?:mydata|deleteaccount|support|cancel|help|id)(?:\s|$)/.test(String(text||""));
// A user who opened Support must be allowed to send the actual report text.
export const isPreConsentMessageAllowed = (text,state) =>
 isPreConsentCommand(text) || state==="support";
// Public help and account-control callbacks must stay reachable before consent.
export const isPreConsentCallback = action =>
 ["home","more","support","access_info","invitefriend","privacy","privacy:export","privacy:delete",
  "deleteaccount:cancel","deleteaccount:confirm","test:revoke"].includes(String(action||""));
// Each click is a single row-level PostgreSQL update. Updating a JS copy of the
// entire JSON field loses nearby taps when Telegram delivers callbacks concurrently.
// Prevent concurrent Telegram edits from painting stale checkbox boards out of order.
// Database toggling remains atomic, so this is a UI-ordering layer, not a correctness lock.
export function createConsentEditQueue(){
 const pending=new Map();
 return (userId,work)=>{
  const key=String(userId);
  const previous=pending.get(key)||Promise.resolve();
  const next=previous.catch(()=>{}).then(work);
  pending.set(key,next);
  void next.finally(()=>{if(pending.get(key)===next)pending.delete(key)}).catch(()=>{});
  return next;
 };
}
export async function toggleTestAcknowledgement(query,id,index){
 if(!Number.isInteger(index)||index<0||index>2)return null;
 const key="test_check_"+index;
 const rows=await query(`UPDATE mm_users SET consent=
   jsonb_set(
    jsonb_set(CASE WHEN jsonb_typeof(consent)='object' THEN consent ELSE '{}'::jsonb END,ARRAY[$2::text],
     to_jsonb(NOT COALESCE((consent->>$2::text)::boolean,FALSE)),TRUE),
    '{test_access}','false'::jsonb,TRUE)
   WHERE id=$1 AND NOT (
    COALESCE((consent->>'test_access')::boolean,FALSE)
    AND (consent->>'test_check_0')='true'
    AND (consent->>'test_check_1')='true'
    AND (consent->>'test_check_2')='true')
   RETURNING consent`,id,key);
 if(rows.length)return {consent:rows[0].consent,changed:true};
 // Accepted accounts can't be silently revoked by old messages.
 const current=(await query("SELECT consent FROM mm_users WHERE id=$1",id))[0];
 return current?{consent:current.consent,changed:false}:null;
}
export async function activateTestAccess(query,id){
 const rows=await query(`UPDATE mm_users SET
   consent=(CASE WHEN jsonb_typeof(consent)='object' THEN consent ELSE '{}'::jsonb END) ||
    jsonb_build_object('test_access',TRUE,'test_at',NOW()::text),
   active=TRUE
   WHERE id=$1 AND (consent->>'test_check_0')='true'
    AND (consent->>'test_check_1')='true'
    AND (consent->>'test_check_2')='true'
   RETURNING consent,active`,id);
 return rows[0]||null;
}
export async function revokeTestAccess(query,id){
 const rows=await query(`UPDATE mm_users SET
    consent=((CASE WHEN jsonb_typeof(consent)='object' THEN consent ELSE '{}'::jsonb END)-'test_check_0'-'test_check_1'-'test_check_2')
      || jsonb_build_object('test_access',FALSE,'test_revoked_at',NOW()::text),
    active=FALSE,state=''
   WHERE id=$1 RETURNING consent`,id);
 return rows[0]?.consent||null;
}
export const testWarning =
 "✨ <b>Добро пожаловать в «Мир моделей»!</b>\n" +
 "Здесь можно создать анкету, найти съёмку, разместить заявку и связаться с участниками.\n\n"+
 "Нажимая «Начать», вы разрешаете сервису сохранять введённые вами данные и показывать опубликованную анкету другим участникам. " +
 "Не размещайте конфиденциальные сведения. Удалить данные и отозвать разрешение можно в разделе «Личные данные».";
export const testMenuText =
 "✨ <b>Мир моделей</b>\nВыберите, что хотите сделать.";
