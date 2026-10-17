// All user-generated descriptions are untrusted. Show creative portfolio context
// while hiding direct contact information until a collaboration is accepted.
export function redactContacts(input){
 let text=String(input??"");
 text=text.replace(/(?<![A-Za-z0-9._%+-])(?:[A-Za-z0-9._%+-]{1,64})@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}\b/gi,"[контакт скрыт]");
 text=text.replace(/(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)\/[^\s<>"']+/gi,"[контакт скрыт]");
 text=text.replace(/(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|facebook\.com|vk\.com|vk\.ru|vkontakte\.ru)\/[^\s<>"']+/gi,"[ссылка на соцсеть скрыта]");
 text=text.replace(/(^|[\s([{])@[A-Za-z0-9_]{5,32}\b/g,"$1[контакт скрыт]");
 text=text.replace(/(?:\+?\d[\d\s().-]{8,}\d)/g,m=>{
  const digits=m.replace(/\D/g,"");
  return digits.length>=10&&digits.length<=15?"[контакт скрыт]":m;
 });
 return text;
}
export function publicProfileEntries(profile){
 return Object.entries(profile||{}).filter(([key])=>!/дата рождения|телефон|telegram|инстаграм|instagram|соцсети|контакт|связь|e-mail|email|почта|фио/i.test(key))
 .map(([key,value])=>[key,redactContacts(value)]);
}
export function publicProfileAllowed(user,hashes,consentChecker,eligibilityChecker){
 return !!user&&!user.blocked&&!user.suspended&&user.active===true
  &&consentChecker(user.consent,hashes)&&eligibilityChecker(user.profile,user.photo);
}
