// Fictional, READ-ONLY sample records. Never insert into mm_users or mm_jobs.
// Demo callbacks only render these records; no Telegram contact, payment or application.
export const demoProfiles=Object.freeze([
 {id:1,name:"Алина Ветер",role:"модель",age:24,city:"Москва",special:"Рост 173 см · лукбук, каталог",format:"Коммерция / ТФП",about:"Опыт съёмок для локальных брендов одежды. Портреты и каталоги."},
 {id:2,name:"Мира Сокол",role:"актёр",age:27,city:"Санкт-Петербург",special:"Реклама · короткометражное кино",format:"Коммерция",about:"Работает с диалогами и импровизацией, участвовала в учебных проектах."},
 {id:3,name:"Лев Морозов",role:"фотограф",age:30,city:"Казань",special:"Fashion · студийный свет",format:"Коммерция / ТФП",about:"Снимает каталоги, портреты и предметную рекламу."},
 {id:4,name:"София Норд",role:"визажист",age:26,city:"Москва",special:"Beauty · clean makeup",format:"Коммерция",about:"Создаёт натуральные и editorial-образы для съёмок."},
 {id:5,name:"Илья Рассвет",role:"видеограф",age:31,city:"Екатеринбург",special:"Reels · рекламные ролики",format:"Коммерция",about:"Снимает и монтирует видео для брендов и мероприятий."},
 {id:6,name:"Полина Лис",role:"стилист по одежде",age:28,city:"Новосибирск",special:"Стайлинг кампейнов",format:"Коммерция / ТФП",about:"Собирает капсульные образы, работает с творческими командами."},
 {id:7,name:"Роман Заря",role:"модель",age:25,city:"Санкт-Петербург",special:"Рост 185 см · коммерческий каталог",format:"Коммерция",about:"Показы мужской одежды, съёмки аксессуаров и каталожные проекты."},
 {id:8,name:"Дарья Луч",role:"стилист по волосам",age:29,city:"Москва",special:"Укладки · бьюти",format:"Коммерция",about:"Работает с текстурой волос, съёмками и рекламными образами."},
 {id:9,name:"Ника Роса",role:"ретушёр",age:23,city:"Казань",special:"Цвет · fashion-ретушь",format:"Коммерция",about:"Подготавливает фотографии для лукбуков и карточек товаров."},
 {id:10,name:"Артём Берег",role:"бренд",age:32,city:"Москва",special:"Локальный бренд аксессуаров",format:"Коммерция / ТФП",about:"Организует съёмки сумок и одежды для маркетплейсов."}
]);
export const demoJobs=Object.freeze([
 {id:1,title:"Каталог осенней одежды",city:"Москва",who:"модель",pay:"6 000 ₽ за смену",date:"Условная дата",description:"Студийный каталог нового сезона; 4 часа, команда из фотографа и стилиста."},
 {id:2,title:"Ролик для кофейни",city:"Санкт-Петербург",who:"актёр",pay:"8 000 ₽ за съёмку",date:"Условная дата",description:"Короткая бытовая сценка для соцсетей, 2–3 часа."},
 {id:3,title:"Съёмка аксессуаров",city:"Казань",who:"фотограф",pay:"По договорённости",date:"Условная дата",description:"Фото сумок и украшений для интернет-магазина."},
 {id:4,title:"Beauty editorial",city:"Москва",who:"визажист",pay:"5 000 ₽ за смену",date:"Условная дата",description:"Натуральный макияж и один яркий образ для журнала."},
 {id:5,title:"Вертикальные ролики",city:"Екатеринбург",who:"видеограф",pay:"12 000 ₽ за проект",date:"Условная дата",description:"Три коротких видео о линейке косметики."},
 {id:6,title:"Лукбук летней коллекции",city:"Новосибирск",who:"стилист по одежде",pay:"7 000 ₽ за смену",date:"Условная дата",description:"Подбор образов для съёмки локального бренда."},
 {id:7,title:"Мужской fashion-каталог",city:"Санкт-Петербург",who:"модель",pay:"7 000 ₽ за смену",date:"Условная дата",description:"Каталог курток, 5 часов, студия и визажист."},
 {id:8,title:"Причёски для рекламного видео",city:"Москва",who:"стилист по волосам",pay:"6 500 ₽ за смену",date:"Условная дата",description:"Подготовка двух образов для ролика."},
 {id:9,title:"Обработка лукбука",city:"Казань",who:"ретушёр",pay:"4 500 ₽ за проект",date:"Условная дата",description:"Лёгкая ретушь и цветокоррекция 35 фотографий."},
 {id:10,title:"Предметные фото парфюмерии",city:"Москва",who:"фотограф",pay:"10 000 ₽ за проект",date:"Условная дата",description:"Съёмка флаконов на цветном фоне, передача исходников."}
]);
const PER_PAGE=4;
const groups={profiles:demoProfiles,jobs:demoJobs};
export const demoItems=kind=>groups[kind]||null;
export function demoPage(kind,page=0){
 const items=demoItems(kind);if(!items)return null;
 if(!Number.isInteger(page)||page<0||page>Math.ceil(items.length/PER_PAGE)-1)return null;
 return {items:items.slice(page*PER_PAGE,(page+1)*PER_PAGE),page,total:items.length,pages:Math.ceil(items.length/PER_PAGE)};
}
export function demoItem(kind,id){
 const items=demoItems(kind);
 return items?.find(x=>x.id===id)||null;
}
export function demoRoute(screen="home"){
 const input=String(screen||"home");
 if(["home","catalog","profile","job","filters","response","invite"].includes(input)){
  if(input==="catalog")return {kind:"list",type:"profiles",page:0};
  if(input==="profile")return {kind:"detail",type:"profiles",id:1};
  if(input==="job")return {kind:"detail",type:"jobs",id:1};
  return {kind:input};
 }
 let m=input.match(/^(profiles|jobs):([0-9]{1,2})$/);
 if(m)return {kind:"list",type:m[1],page:Number(m[2])};
 m=input.match(/^(profile|job):([0-9]{1,2})$/);
 if(m)return {kind:"detail",type:m[1]==="profile"?"profiles":"jobs",id:Number(m[2])};
 return null;
}
