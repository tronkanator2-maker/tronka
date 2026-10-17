// State machine for a short Telegram-first profile editor.
// This module contains only presentation metadata and can be tested without Telegram.
import {ROLES,ageAt} from "./engine.ts";
export const WIZARD_ROLES=[...ROLES];
const common=[
 {key:"имя",label:"Как к вам обращаться?",example:"Анна",required:true},
 {key:"дата рождения",label:"Дата рождения в формате ДД.ММ.ГГГГ",example:"12.09.2002",required:true},
 {key:"город",label:"В каком городе вы работаете?",example:"Москва, Коломна",required:true}
];
const model=[
 {key:"пол",label:"Пол для подбора по требованиям кастингов",example:"женский",required:true},
 {key:"рост",label:"Рост в сантиметрах",example:"172",required:true},
 {key:"размер одежды",label:"Размер одежды",example:"42–44",required:true},
 {key:"цвет волос",label:"Цвет волос",example:"русый",required:true},
 {key:"длина волос",label:"Длина волос",example:"длинные",required:true},
 {key:"формат",label:"Формат сотрудничества",example:"ТФП, коммерция",required:true},
 {key:"прайс",label:"Ваш прайс",example:"3000 ₽/час",required:true},
 {key:"о себе",label:"Пару слов о вашем опыте",example:"Снимаюсь в каталогах 2 года",required:false},
 {key:"портфолио",label:"Ссылка на портфолио",example:"https://disk.yandex.ru/d/...",required:false}
];
const professional=[
 {key:"опыт и проекты",label:"Опыт и проекты",example:"3 года, съёмки для брендов",required:false},
 {key:"портфолио",label:"Ссылка на портфолио",example:"https://behance.net/...",required:false},
 {key:"о себе",label:"О себе или о вашем проекте",example:"Снимаю каталоги, люблю уличный стиль",required:false}
];
export const wizardFields=role=>{
 if(["модель","актёр"].includes(role))return [...common,...model];
 const needsPortfolio=/фотограф|видеограф|визажист|стилист|бьюти-мастер/.test(role);
 return [...common,...professional.map(field=>field.key==="портфолио"?{...field,required:needsPortfolio}:field)];
};
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
