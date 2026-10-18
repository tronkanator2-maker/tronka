import {ROLES} from "./engine.ts";
export const jobWizardFields=[
 {key:"название заявки",label:"Название съёмки или проекта",example:"Съёмка каталога одежды",required:true},
 {key:"кого ищу",label:"Кого вы ищете? Можно несколько профессий через запятую",example:"модель, фотограф",required:true},
 {key:"тип работы",label:"Какой тип работы?",example:"каталог, реклама, клип",required:true},
 {key:"город",label:"Где будет проходить работа?",example:"Москва",required:true},
 {key:"требования",label:"Требования к исполнителю (по желанию)",example:"опыт каталогов, 18+",required:false},
 {key:"формат и оплата",label:"Какой формат и оплата?",example:"5000 ₽ за смену или ТФП",required:true},
 {key:"дата съёмки",label:"Когда планируете съёмку? (по желанию)",example:"25.11.2026",required:false},
 {key:"описание",label:"Опишите задачу и условия",example:"Съёмка лукбука, 4 часа, студия",required:true}
];
export const jobWizardField=step=>jobWizardFields[step]||null;
export const jobWizardFinished=step=>step>=jobWizardFields.length;
export function validateJobWizardAnswer(field,raw){
 const v=String(raw??"").trim();
 if(!field)return {ok:false,error:"Шаг заявки не найден."};
 if(!v)return {ok:false,error:"Напишите ответ. Необязательное поле можно пропустить."};
 if(v.length>1800)return {ok:false,error:"Максимум 1800 символов."};
 if(field.key==="название заявки"&&v.length>40)return {ok:false,error:"Название должно быть не длиннее 40 символов."};
 if(field.key==="кого ищу"){
  const choices=v.toLowerCase().split(",").map(x=>x.trim());
  if(choices.some(x=>!x))
   return {ok:false,error:"Перечислите профессии через запятую без пустых значений."};
  if(choices.some(x=>!ROLES.includes(x)&&x!=="модель в пару"))
   return {ok:false,error:"Укажите профессию из справочника: например, модель, фотограф, визажист."};
 }
 if(field.key==="дата съёмки"){
  const m=v.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if(!m)return {ok:false,error:"Формат даты: ДД.ММ.ГГГГ. Либо пропустите шаг."};
  const dt=new Date(Date.UTC(Number(m[3]),Number(m[2])-1,Number(m[1])));
  if(dt.getUTCDate()!==Number(m[1])||dt.getUTCMonth()!==Number(m[2])-1||dt.getUTCFullYear()!==Number(m[3]))
   return {ok:false,error:"Такой даты нет в календаре."};
  if(dt.getTime()<Date.now()-86400000)return {ok:false,error:"Нужна будущая дата или пропустите шаг."};
 }
 return {ok:true,value:v};
}
export function jobWizardFilters(filters,body,step){
 return {...(filters||{}),jobWizardDraft:{...body},jobWizardStep:step};
}
export function clearJobWizard(filters){
 const result={...(filters||{})};
 delete result.jobWizardDraft;delete result.jobWizardStep;
 return result;
}
