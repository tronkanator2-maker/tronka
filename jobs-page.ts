import {redactContacts} from "./visibility.ts";

const esc=value=>String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
const preview=(value,max=110)=>esc(redactContacts(value).slice(0,max));

// Keep job search to one webhook response. Full details and response actions
// are sent only after the user opens one selected job.
export function renderJobsPage(jobs,offset=0,samples=[],canRespond=true){
 const page=jobs.slice(offset,offset+5);
 const samplePage=offset===0?samples.slice(0,2):[];
 const lines=page.map((job,index)=>{
  const data=job.body||{};
  const title=preview(data["название заявки"]||"Без названия",75);
  const role=preview(data["кого ищу"]||"Специалисты не указаны",60);
  const city=preview(data["город"]||"Город не указан",60);
  const work=preview(data["тип работы"]||"Тип работы не указан",70);
  return "<b>"+(offset+index+1)+". "+title+"</b> · "+role+"\n"+city+" · "+work;
 });
 const rows=page.map((job,index)=>[["📢 Открыть заявку "+(offset+index+1),"job_view:"+job.id+":"+offset]]);
 for(const job of samplePage){
  const title=preview(job.title||"Без названия",75);
  const role=preview(job.who||"Специалисты не указаны",60);
  const city=preview(job.city||"Город не указан",60);
  const pay=preview(job.pay||"По договорённости",60);
  lines.push("🎭 <b>Пример заявки · "+title+"</b> · "+role+"\n"+city+" · "+pay);
  rows.push([["Открыть пример · "+title,"demo:job:"+job.id]]);
 }
 if(offset>0||offset+page.length<jobs.length){
  const nav=[];
  if(offset>0)nav.push(["◀️ Назад","jobs:"+Math.max(0,offset-5)]);
  if(offset+page.length<jobs.length)nav.push(["Дальше ▶️","jobs:"+(offset+5)]);
  rows.push(nav);
 }
 rows.push([["🎯 Фильтры","filters"],["🏠 В меню","home"]]);
 const empty=offset?"На этой странице заявок больше нет.":"Подходящих реальных заявок пока нет. Ниже — вымышленные примеры.";
 return {text:"📢 <b>Подходящие заявки</b> · реальных на странице: "+page.length+"\n\n"+(lines.length?lines.join("\n\n")+"\n\nВыберите заявку, чтобы прочитать условия и откликнуться.":empty)+(samplePage.length?"\n🎭 Примеры вымышленные.":"")+(canRespond?"":"\n\nДля отклика заполните анкету и добавьте главное фото."),rows};
}
