// Bound Telegram list rendering to a small page, avoiding long webhook handlers.
export function parsePageOffset(action,route,size=5,maxOffset=100){
 const value=String(action||"");
 if(value===route)return 0;
 if(!value.startsWith(route+":"))return null;
 const raw=value.slice(route.length+1);
 if(!/^(0|[1-9]\d{0,2})$/.test(raw))return null;
 const offset=Number(raw);
 return Number.isSafeInteger(offset)&&offset<=maxOffset&&offset%size===0?offset:null;
}
export function pageNavigation(route,offset,hasMore,size=5){
 const actions=[];
 if(offset>0)actions.push(["◀️ Назад",route+":"+Math.max(0,offset-size)]);
 if(hasMore)actions.push(["Дальше ▶️",route+":"+(offset+size)]);
 return actions;
}
