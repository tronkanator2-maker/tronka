import {ageAt,field} from "./engine.ts";
import {redactContacts} from "./visibility.ts";

const esc=value=>String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
const preview=(value,max=90)=>esc(redactContacts(value).slice(0,max));

// A catalog page is one Telegram message. Full photos and profile fields open
// only when the user selects a particular card.
export function renderCatalogPage(profiles,offset=0,city="",roles=[],samples=[]){
 const page=profiles.slice(offset,offset+3);
 const samplePage=offset===0?samples.slice(0,2):[];
 const lines=page.map((person,index)=>{
  const data=person.profile||{};
  const name=preview(field(data,"имя")||field(data,"псевдоним")||"Без имени",65);
  const role=preview(field(data,"кто вы")||"Профессия не указана",90);
  const location=preview(field(data,"город")||"Город не указан",90);
  const age=person.demo?person.age:ageAt(field(data,"дата рождения"));
  return "<b>"+(index+1)+". "+name+"</b> · "+role+"\n"+location+(age!==null?" · "+age+" лет":"");
 });
 const rows=page.map((person,index)=>[["👤 Открыть анкету "+(index+1),"profile_view:"+person.id+":"+offset]]);
 for(const person of samplePage){
  const name=preview(field(person.profile,"имя")||"Участник",65);
  const role=preview(field(person.profile,"кто вы")||"Профессия не указана",90);
  const city=preview(field(person.profile,"город")||"Город не указан",90);
  lines.push("🎭 <b>Пример анкеты · "+name+"</b> · "+role+"\n"+city+(person.age?" · "+person.age+" лет":""));
  rows.push([["Открыть пример · "+name,"demo:profile:"+person.id]]);
 }
 const nav=[];
 if(offset>0)nav.push(["◀️ Назад","browse:"+Math.max(0,offset-3)]);
 if(offset+page.length<profiles.length)nav.push(["Дальше ▶️","browse:"+(offset+3)]);
 if(nav.length)rows.push(nav);
 rows.push([["⚙️ Профессия","browse_roles"],["🏙 Город","browse_city"]]);
 rows.push([["🏠 В меню","home"]]);
 const empty=offset?"Других анкет по выбранным фильтрам пока нет.":"Реальных анкет по выбранным фильтрам пока нет. Ниже — вымышленные примеры.";
 const text="🔎 <b>Каталог анкет</b> · реальных на странице: "+page.length+
  "\nГород: "+preview(city||"все",80)+" · Профессия: "+preview(roles.join(", ")||"все",150)+
  "\n\n"+(lines.length?lines.join("\n\n")+"\n\nВыберите анкету, чтобы увидеть фото, все поля и действия.":empty)+(samplePage.length?"\n🎭 Примеры вымышленные.":"");
 return {text,rows};
}
