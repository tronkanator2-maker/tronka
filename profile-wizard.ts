// State machine for a short Telegram-first profile editor.
// This module contains only presentation metadata and can be tested without Telegram.
import {ROLES,ageAt} from "./engine.ts";
export const WIZARD_ROLES=[...ROLES];
export const isModelRole=role=>["модель","актёр"].includes(role);
export function toggleProfileRole(selected,role){
 const values=Array.isArray(selected)?selected.filter(x=>ROLES.includes(x)):[];
 if(!ROLES.includes(role))return {selected:values,error:"Профессия не найдена."};
 if(values.includes(role))return {selected:values.filter(x=>x!==role),error:null};
 const excludes=isModelRole(role)?values.filter(x=>!isModelRole(x)):values.filter(isModelRole);
 if(excludes.length)return {selected:[role],error:"Роли «модель» и «актёр» не совмещаются со специальностями съёмочной команды. Несовместимые роли сняты."};
 return {selected:[...values,role],error:null};
}
const common=[
 {key:"имя",label:"Как к вам обращаться?",example:"Анна",required:true},
 {key:"дата рождения",label:"Дата рождения в формате ДД.ММ.ГГГГ",example:"12.09.2002",required:true},
 {key:"город",label:"В каком городе вы работаете?",example:"Москва, Коломна",required:true}
];
const model=[
 {key:"пол",label:"Пол для подбора кастингов",example:"женский",required:true},
 {key:"рост",label:"Рост в сантиметрах",example:"172",required:true},
 {key:"размер одежды",label:"Размер одежды",example:"42–44",required:true},
 {key:"цвет волос",label:"Цвет волос",example:"русый",required:true},
 {key:"длина волос",label:"Длина волос",example:"длинные",required:true},
 {key:"формат",label:"Формат сотрудничества",example:"ТФП, коммерция",required:true},
 {key:"прайс",label:"Ваш прайс",example:"3000 ₽/час",required:true},
 {key:"о себе",label:"Пару слов о вашем опыте",example:"Снимаюсь в каталогах два года",required:false},
 {key:"портфолио",label:"Ссылка на портфолио",example:"https://disk.yandex.ru/d/...",required:false},
 {key:"псевдоним",label:"Псевдоним (необязательно)",example:"Анна Крылатая",required:false},
 {key:"выгляжу на",label:"На какой возраст вы выглядите? (необязательно)",example:"20–25",required:false},
 {key:"параметры",label:"Параметры фигуры (необязательно)",example:"86-61-90",required:false},
 {key:"размер обуви",label:"Размер обуви (необязательно)",example:"38",required:false},
 {key:"тату, пирсинг, борода",label:"Татуировки, пирсинг или борода (необязательно)",example:"небольшая татуировка",required:false},
 {key:"навыки",label:"Навыки для съёмок (необязательно)",example:"танцы, английский",required:false},
 {key:"волосы и лицо для бьюти-съёмок",label:"Состояние волос и лица для бьюти-съёмок (необязательно)",example:"волосы не окрашены",required:false},
 {key:"опыт на мероприятиях",label:"Опыт хостес, промо или мероприятий (необязательно)",example:"один год на выставках",required:false},
 {key:"видеовизитка",label:"Ссылка на видеовизитку (необязательно)",example:"https://disk.yandex.ru/d/...",required:false}
];
const professional=[
 {key:"портфолио",label:"Ссылка на портфолио",example:"https://disk.yandex.ru/d/...",required:false},
 {key:"опыт и проекты",label:"Опыт и проекты",example:"3 года, съёмки для брендов",required:false},
 {key:"гонорар для модели",label:"Бюджет на модель (по желанию)",example:"до 3000 ₽/час, договорная",required:false},
 {key:"агентская комиссия",label:"Агентская комиссия (по желанию)",example:"20%",required:false},
 {key:"как платите модели",label:"Условия оплаты (по желанию)",example:"по договору, в день съёмки",required:false},
 {key:"о себе",label:"О себе или о проекте",example:"Снимаем каталоги и лукбуки",required:false},
 {key:"сайт или соцсеть",label:"Ссылка на сайт или соцсеть (необязательно)",example:"https://example.org",required:false}
];
export const wizardFields=role=>{
 const roles=String(role||"").split(",").map(x=>x.trim());
 if(roles.some(isModelRole))return [...common,...model];
 const needsPortfolio=roles.some(x=>/фотограф|видеограф|визажист|стилист|бьюти-мастер/.test(x));
 return [...common,...professional.map(field=>field.key==="портфолио"?{...field,required:needsPortfolio}:field)];
};
export function canFinishWizardNow(role,profile){
 const fields=wizardFields(role),saved=profile||{};
 return fields.every(f=>!f.required || String(saved[f.key]??"").trim().length>0);
}
export const wizardField=(role,index)=>wizardFields(role)[index]||null;
export const wizardCompleted=(role,index)=>index>=wizardFields(role).length;
export const wizardAnswer=(field,value)=>{
 const v=String(value||"").trim();
 if(!field)return {ok:false,error:"Шаг не найден."};
 if(!v)return {ok:false,error:"Введите значение. Для необязательных полей есть кнопка «Пропустить»."};
 if(v.length>350)return {ok:false,error:"Слишком длинное значение. Максимум 350 символов."};
 if(field.key==="дата рождения"&&!/^\d{2}\.\d{2}\.\d{4}$/.test(v))return {ok:false,error:"Пример даты: 12.09.2002. В тесте используйте вымышленную дату."};
 if(field.key==="дата рождения"){
  const age=ageAt(v);
  if(age===null)return {ok:false,error:"Проверьте дату: формат ДД.ММ.ГГГГ."};
  if(age<18||age>110)return {ok:false,error:"В тестировании поддерживаются только взрослые анкеты (18+). Укажите вымышленную дату взрослого."};
 }
 if(field.key==="рост"&&(!/^\d{2,3}$/.test(v)||Number(v)<80||Number(v)>250))return {ok:false,error:"Рост должен быть числом от 80 до 250 см."};
 return {ok:true,value:v};
};
