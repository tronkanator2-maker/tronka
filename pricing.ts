// Matching by compensation from the client specification §9.
// Never invent FX rates or the duration of a shift.
import {field} from "./engine.ts";
const nrm=x=>String(x||"").toLowerCase().replace(/\u00a0/g," ");
export function parseMoney(value){
 const raw=nrm(value);
 const free=/тфп|tfp|без\s+оплаты|безвозмездн/.test(raw),barter=/бартер/.test(raw);
 if(free||barter)return {free:true,barter,amount:0,currency:null,unit:null};
 if(/договорн/.test(raw))return null;
 let currency=null;
 if(/₽|рубл|руб\.?|р\./i.test(raw))currency="RUB";
 else if(/₸|\bтг\b|\bkzt\b|тенге/i.test(raw))currency="KZT";
 else if(/\bbyn\b|\bbr\b|белорусск/i.test(raw))currency="BYN";
 else if(/\bUSD\b|\$|доллар/i.test(raw))currency="USD";
 else if(/\bEUR\b|€|евро/i.test(raw))currency="EUR";
 const m=raw.match(/(\d[\d\s]{1,13})(?:[.,](\d{1,2}))?\s*(?:₽|рубл\w*|руб\.?|р\.|₸|тг|kzt|byn|br|usd|eur|€|\$|тенге|доллар\w*|евро)/i);
 if(!m)return null;
 const integer=Number(m[1].replace(/\s/g,"")),cents=m[2]?Number("0."+m[2]):0;
 const amount=integer+cents;
 if(!Number.isFinite(amount)||amount<1||amount>1e9)return null;
 let unit=null;
 if(/за\s*час|в\s*час|\/\s*час|почасов|часовая|часовой/i.test(raw))unit="hour";
 else if(/смену|смена|смены|\/\s*смен|за\s*день|за\s*сутки|за\s*сут|полная\s*смена/i.test(raw))unit="shift";
 else if(/за\s*проект|за\s*съемк|за\s*съёмк/i.test(raw))unit="project";
 return {free:false,barter:false,amount,currency,unit};
}
export function shiftHours(text){
 const src=nrm(text);
 const hours=src.match(/\b(\d{1,2})(?:[.,](\d))?\s*(?:час(?:ов|а)?|ч\.)(?=$|[^а-яёa-z])/i);
 if(hours){const n=Number(hours[1])+(hours[2]?Number("0."+hours[2]):0);return n>0&&n<=24?n:null}
 const schedule=src.match(/с\s*(\d{1,2})(?::(\d{2}))?\s*до\s*(\d{1,2})(?::(\d{2}))?/i);
 if(!schedule)return null;
 const start=Number(schedule[1])+Number(schedule[2]||0)/60,finish=Number(schedule[3])+Number(schedule[4]||0)/60;
 if(start>=24||finish>24)return null;
 let n=finish-start;if(n<=0)n+=24;
 return n>0&&n<=24?n:null;
}
export function agencyCommissionPercent(text){
 const src=nrm(text);
 const m=src.match(/(?:агентск\w*|комисси\w*)[^\d]{0,25}(\d{1,2})\s*%/)||src.match(/[−-]\s*(\d{1,2})\s*%\s*(?:агентск|комисси)/);
 return m?Math.min(Number(m[1]),99):0;
}
function hourlyAmount(rate,hours){
 if(rate.unit==="hour")return rate.amount;
 if(rate.unit==="shift"&&hours)return rate.amount/hours;
 return null;
}
export function payMatches(profile,job){
 const wanted=nrm(field(profile,"формат")),pricing=parseMoney(field(profile,"прайс")||field(profile,"гонорар"));
 const payText=field(job,"формат и оплата");
 const offered=parseMoney(payText);
 if(!offered)return true; // unknown values are never filtered out
 if(offered.free)return /тфп|tfp|бартер/.test(wanted)||!!pricing?.free;
 if(!pricing||pricing.free)return true;
 if(!offered.currency||!pricing.currency||offered.currency!==pricing.currency)return true; // fx must use approved CB rate
 const commission=agencyCommissionPercent([field(job,"агентская комиссия"),field(job,"описание")].join(" "));
 const amount=offered.amount*(1-commission/100);
 const duration=shiftHours([field(job,"описание"),field(job,"требования"),payText].join(" "));
 const ours=hourlyAmount({...offered,amount},duration),target=hourlyAmount(pricing,duration);
 if(ours!==null&&target!==null)return ours>=target*.8;
 if(offered.unit==="shift"&&pricing.unit==="shift")return amount>=pricing.amount*.8;
 if(offered.unit==="project"&&pricing.unit==="project")return amount>=pricing.amount*.8;
 return true; // time unit or shift duration unknown
}
export function formatMatches(selected,jobValue){
 const f=nrm(selected).split(",").map(v=>v.trim()).filter(Boolean);
 if(!f.length)return true;
 const text=nrm(jobValue);
 if(!text||/не указано|договорн/.test(text))return true;
 const free=/тфп|tfp|без\s+оплаты|безвозмездн/.test(text);
 const barter=/бартер/.test(text);
 const commercial=!free&&!barter;
 return f.some(x=>x.includes("коммерц")&&commercial||x.includes("тфп")&&free||x.includes("бартер")&&barter);
}
