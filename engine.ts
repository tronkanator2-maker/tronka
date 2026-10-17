// Domain helpers: independent from Telegram and database, intentionally deterministic.
export const MODEL_ROLES = ["модель", "актёр"];
export const ROLES = [
  "модель","актёр","хостес","промоутер","танцор","блогер","фотограф",
  "видеограф","визажист","стилист по волосам","стилист по одежде",
  "бьюти-мастер","ретушёр","монтажёр","ассистент","хореограф",
  "кастинг-директор","режиссёр","продюсер","продакшн","модельное агентство",
  "ивент-агентство","бренд","ресторан","салон красоты","студия","другое"
];
export const parseFields = text => {
  const obj = {};
  for (const raw of String(text||"").split(/\r?\n/)) {
    const line = raw.trim();
    const match = line.match(/^([^:：]{2,65})[:：]\s*(.+)$/);
    if(match) obj[match[1].trim().toLowerCase()] = match[2].trim();
  }
  return obj;
};
export const field = (p,key) => Object.entries(p||{}).find(([k])=>k.includes(key))?.[1]||"";
export const parseDate = input => {
  const m=String(input||"").match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if(!m) return null;
  const y=+m[3], mo=+m[2], d=+m[1];
  const dt=new Date(Date.UTC(y,mo-1,d));
  return dt.getUTCFullYear()===y&&dt.getUTCMonth()===mo-1&&dt.getUTCDate()===d?dt:null;
};
export const ageAt = (dob,reference=new Date()) => {
  const date=parseDate(dob);
  if(!date)return null;
  let years=reference.getUTCFullYear()-date.getUTCFullYear();
  if(reference.getUTCMonth()<date.getUTCMonth() ||
  (reference.getUTCMonth()===date.getUTCMonth()&&reference.getUTCDate()<date.getUTCDate())) years--;
  return years;
};
export const jobExpiresAt = (text,created=new Date()) => {
  const dt=parseDate(String(text||"").trim());
  if(!dt) return new Date(created.getTime()+14*24*3600*1000);
  dt.setUTCHours(23,59,59,999);
  return dt;
};
export const normalizePost = text => String(text||"")
  .toLowerCase()
  .replace(/https?:\/\/[^\s]+/gi," ")
  .replace(/(?:^|\s)@\w+/g," ")
  .replace(/#\S+/g," ")
  .replace(/(?:^|\n)\s*(?:👤\s*автор|➤\s*\d{1,2}\.\d{1,2}\.\d{4})[^\n]*/gim," ")
  .replace(/[\p{P}\p{S}\s]+/gu," ")
  .trim().replace(/\s+/g," ");
export function similarity(a,b){
  const x=normalizePost(a),y=normalizePost(b);
  if(x===y)return 1;
  if(!x||!y||Math.min(x.length,y.length)/Math.max(x.length,y.length)<.95)return 0;
  const prev=Array.from({length:y.length+1},(_,i)=>i);
  for(let i=1;i<=x.length;i++){
    let left=i,upper=prev[0];prev[0]=i;
    for(let j=1;j<=y.length;j++){
      const next=prev[j];
      const cost=x[i-1]===y[j-1]?0:1;
      const score=Math.min(prev[j]+1,left+1,upper+cost);
      prev[j]=score;left=score;upper=next;
    }
  }
  return 1-prev[y.length]/Math.max(x.length,y.length);
}
const BLOCK = [
  /эскорт|содержанк|консумац|модельн\w*\s+стол|работ[ауые]\s+за\s+столик/i,
  /вебкам|webcam|onlyfans|стрим\w*\s+для\s+взросл|контент\s+без\s+лица/i,
  /платн\w*\s+кастинг|предоплат\w*\s+от\s+модел|регистрационн\w*\s+взнос/i,
  /букмекер|казино|ставки\s+на\s+спорт|арбитраж\s+трафика|млм|сетевой\s+маркетинг/i,
  /интим\w*\s+услуг|фото\s+ножек|фетиш|бдсм|порнограф/i
];
const REVIEW = [
  /в\s+купальник|в\s+белье|без\s+одежды|с\s+открытым\s+торсом/i,
  /залог|предоплат|бронь\s+с\s+оплатой/i,
  /https?:\/\/|(?:^|\s)t\.me\//i,
  /ню\b|топлес|эротическ|будуар/i,
  /младше\s*18|до\s*1[0-7]\s*лет|дети\s+1[0-7]\s*лет/i
];
export function moderate(text) {
  const str=String(text||"");
  if(BLOCK.some(r=>r.test(str))) return {status:"reject",reason:"запрещённая тема"};
  if(REVIEW.some(r=>r.test(str)))return {status:"review",reason:"требуется проверка объявления"};
  return {status:"accept",reason:""};
}
export function inferRoles(text){
  const t=String(text||"").toLowerCase();const found=[];
  const patterns = [
    ["модель",/модел[ьиьеюя]|манекенщиц|\bmodel\b/i],
    ["актёр",/акт[её]р|массовк|групповк|самопроб/i],
    ["фотограф",/фотограф/i],
    ["видеограф",/видеограф|оператор\s+с[ъь]емки/i],
    ["визажист",/визажист|макияж/i],
    ["стилист по волосам",/стилист\s+по\s+волос|парикмахер/i],
    ["стилист по одежде",/стилист\s+по\s+одежд/i],
    ["бьюти-мастер",/бровист|ресниц|маникюр|мастер\s+ногт/i]
  ];
  for(const [role,re] of patterns)if(re.test(t))found.push(role);
  return found;
}
export function inferCity(text,fallback=""){
  const t=String(text||"");
  for(const [city,re] of [
    ["Москва",/москв[аеуы]|московск/i],["Санкт-Петербург",/санкт.петербург|питер|спб\b/i],
    ["Казань",/казан[ьи]/i],["Новосибирск",/новосибирск/i],["Екатеринбург",/екатеринбург/i],
    ["Минск",/минск/i],["Гомель",/гомел/i],["Брест",/брест/i],
    ["Алматы",/алмат[ыаи]/i],["Астана",/астан[аеы]/i],["Караганда",/караганд/i]
  ])if(re.test(t))return city;
  return fallback;
}
export function extractContact(text){
  const str=String(text||"");
  const uname=str.match(/(?:^|[\s(])@([A-Za-z0-9_]{5,32})\b/);
  if(uname)return "@"+uname[1].toLowerCase();
  const url=str.match(/(?:https?:\/\/)?t\.me\/([a-zA-Z0-9_]{5,32})/);
  if(url)return "@"+url[1].toLowerCase();
  const phone=str.match(/(?:\+7|8)[\d\s()\-]{9,16}\d/);
  return phone?phone[0].replace(/[^\d+]/g,""):null;
}
export function parseSourcePost(text,{city="",topic=""}={}){
  const raw=String(text||"").trim();
  if(raw.length<35||raw.length>5000)return null;
  const contact=extractContact(raw);
  if(!contact)return null;
  const found=inferRoles(raw);
  if(!found.length)return null;
  const locality=inferCity(raw,city);
  if(!locality)return null;
  const title=raw.split(/\n/).map(x=>x.trim()).find(x=>x.length>8)?.slice(0,40)||"Заявка со съёмки";
  const roles=found.slice(0,3);
  return {
    "название заявки":title,"кого ищу":roles.join(", "),
    "тип работы":topic||"съёмка / кастинг",
    "город":locality,"требования":"не указано",
    "формат и оплата":/тфп|tfp/i.test(raw)?"ТФП":(raw.match(/(?:от|до)?\s*\d[\d\s]{2,}\s*[₽р]|договорн/gi)||[])[0]||"не указано",
    "дата съёмки":(raw.match(/\b\d{1,2}\.\d{1,2}\.20\d{2}\b/)||[])[0]||"",
    "описание":raw.slice(0,3900)
  };
}
export function roleMatch(want,roleText){
  const a=String(want||"").toLowerCase(),b=String(roleText||"").toLowerCase();
  const own=b.split(/[,;/]/).map(x=>x.trim());
  if(/модел\w*\s+в\s+пару/.test(a))return own.includes("модель")||own.includes("актёр");
  return own.some(r=>r&&a.split(/[,;/]/).some(x=>x.trim()===r ||
    ((r==="актёр"||r==="модель")&&/^модел[ьиья]?$/i.test(x.trim()))));
}


export function eligibleProfile(profile,hasKeyPhoto){
 const p=profile||{};
 if(!hasKeyPhoto)return false;
 const required=["кто вы","имя","дата рождения","город"];
 if(required.some(k=>!field(p,k)))return false;
 const years=ageAt(field(p,"дата рождения"));
 if(years===null||years<18||years>110)return false;
 const roles=field(p,"кто вы").toLowerCase().split(",").map(x=>x.trim());
 if(roles.some(x=>MODEL_ROLES.includes(x))){
  return ["пол","рост","размер одежды","цвет волос","длина волос","формат","прайс"].every(k=>!!field(p,k));
 }
 if(roles.some(x=>/фотограф|видеограф|визажист|стилист|бьюти-мастер/.test(x)))return !!field(p,"портфолио");
 return true;
}
