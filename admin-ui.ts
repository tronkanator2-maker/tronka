// Self-contained UI: no third-party scripts or styles. Untrusted database content
// is always inserted with textContent, never interpolated into innerHTML.
function decodeAdminUnicode(value){
 return value.replace(/\\u\\{([0-9a-fA-F]{1,6})\\}|\\u([0-9a-fA-F]{4})/g,(_match,longCode,shortCode)=>String.fromCodePoint(parseInt(longCode||shortCode,16)));
}
export const adminHtml = decodeAdminUnicode(String.raw`<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Мир моделей — управление</title>
<style>
:root{color-scheme:dark;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#0c1320;color:#ebf1ff}
*{box-sizing:border-box}body{margin:0}main{max-width:1320px;margin:auto;padding:20px}
header{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
h1{margin:0;font-size:clamp(22px,3.5vw,32px)}h2{font-size:19px;margin:0 0 16px}
p,small{color:#b5c2d5}.small{font-size:13px}a{color:#9acaff}
.panel{background:#17253a;border:1px solid #2a415e;border-radius:16px;padding:20px;margin:16px 0;box-shadow:0 8px 32px #0002}
.flex{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.grow{flex:1;min-width:0}
input,select,textarea,button{font:inherit;border-radius:9px;border:1px solid #465e7b;padding:10px 12px;background:#1e304a;color:#f1f5ff}
input,textarea{width:min(100%,370px)}textarea{width:100%;resize:vertical}
button{cursor:pointer;min-height:42px}button:hover{background:#355375}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid #72b5ff;outline-offset:2px}
button.primary{background:#2462b5;border-color:#4383d7}button.danger{border-color:#ac6262;color:#ffd4d4}button:disabled{opacity:.5;cursor:wait}
nav{display:flex;gap:7px;flex-wrap:wrap;margin:20px 0}nav button{flex:0 1 auto}nav button[aria-current=page]{background:#2763ad;border-color:#75b5ff}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
.kpi{background:#213752;border-radius:12px;padding:14px}.kpi b{display:block;font-size:25px;margin-top:5px}
#notice{position:sticky;top:12px;z-index:5;margin:12px 0;border-radius:10px;background:#173955;padding:12px 14px;border:1px solid #3576ad;display:none}
#notice.error{background:#54272b;border-color:#aa4c59}
.toolbar{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}.toolbar input{flex:1;min-width:180px}
.table-wrap{max-width:100%;overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:12px 10px;text-align:left;border-bottom:1px solid #354764;vertical-align:top;overflow-wrap:anywhere}th{color:#d2e5ff;white-space:nowrap}
td .actions{display:flex;gap:6px;flex-wrap:wrap}td button{font-size:13px;padding:7px 10px;min-height:34px}
.tag{border-radius:7px;background:#31465f;padding:3px 8px;white-space:nowrap}
.ellipsis{display:block;max-width:320px;overflow-wrap:anywhere}#pager{justify-content:space-between;margin-top:12px}
footer{margin-top:30px}#login{max-width:500px;margin:10vh auto 0}#dashboard[hidden],#login[hidden],.hide{display:none!important}
.form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}.form-grid input,.form-grid select{width:100%}
.inline-reply{width:200px;height:74px;display:block;margin:8px 0;font-size:13px}
@media(max-width:760px){
 main{padding:12px}.panel{padding:14px;margin:12px 0}nav{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}nav button{font-size:13px}
 table,thead,tbody,tr,td{display:block}thead{display:none}
 tr{border:1px solid #35506b;background:#1c2e45;border-radius:12px;padding:10px;margin:10px 0}
 td{border:0;padding:5px 2px;display:flex;gap:12px;justify-content:space-between;align-items:start}
 td::before{content:attr(data-label);color:#aabdd3;min-width:85px;max-width:110px;font-size:13px}
 td.actions-cell{display:block}td.actions-cell::before{display:block;margin-bottom:8px}
 .ellipsis{max-width:210px}
}
</style></head><body><main>
<header><h1>🎬 Мир моделей</h1><div class="flex"><span id="role" class="small"></span><button id="logout" hidden>Выйти</button></div></header>
<div id="notice" role="status" aria-live="polite"></div>
<section id="login" class="panel"><h2>Вход в панель</h2><form id="loginForm"><p class="small">Владелец входит по паролю; модератор указывает также свой логин.</p><div class="flex"><input name="username" autocomplete="username" placeholder="Логин модератора (если есть)"><input name="password" type="password" autocomplete="current-password" placeholder="Пароль" required><button class="primary" type="submit">Войти</button></div></form></section>
<section id="dashboard" hidden>
<nav id="tabs" aria-label="Разделы панели">
<button data-tab="summary">Обзор</button><button data-tab="users">Пользователи</button>
<button data-tab="jobs">Заявки</button><button data-tab="pending">Модерация</button>
<button data-tab="reports">Обращения</button><button data-tab="sources">Источники</button>
<button data-tab="candidates">Проверка источников</button><button data-tab="finance" class="owner-only">Финансы</button>
<button data-tab="documents" class="owner-only">Документы</button><button data-tab="articles" class="owner-only">Статьи</button>
<button data-tab="audit" class="owner-only">Журнал действий</button><button data-tab="moderators" class="owner-only">Модераторы</button>
</nav>
<div class="panel" id="summaryPane"><div class="flex"><h2 class="grow">Состояние сервиса</h2><button id="refreshSummary">Обновить</button></div><div class="kpis" id="kpis"></div><p class="small" id="summaryNote"></p></div>
<div class="panel hide" id="listPane">
<div class="flex"><h2 id="sectionTitle" class="grow"></h2><button id="refreshList">Обновить</button></div>
<div class="toolbar"><input id="search" type="search" placeholder="Поиск по ID, имени или содержимому" aria-label="Поиск по разделу"><button class="primary" id="searchButton">Найти</button><button id="resetSearch">Сбросить</button></div>
<div id="listHelp" class="small"></div><div id="listResults" class="table-wrap" aria-live="polite"></div>
<div class="flex" id="pager"><button id="prevPage">← Назад</button><span id="pageInfo"></span><button id="nextPage">Дальше →</button></div>
<div id="sourceAdd" class="hide"><h2>Добавить Telegram-источник</h2><form id="sourceForm" class="flex">
<input name="id" placeholder="ID источника, -100..." required><input name="city" placeholder="Город"><input name="topic" placeholder="Тема"><button type="submit" class="primary">Добавить</button></form></div>
<div id="moderatorAdd" class="hide"><h2>Новый модератор</h2><p>Создайте отдельную учётную запись и передайте пароль сотруднику самостоятельно. У модератора только права на обращения и модерацию заявок.</p>
<form id="moderatorForm" class="flex"><input name="username" placeholder="Логин латиницей" minlength="3" maxlength="32" autocomplete="off" required>
<input name="password" type="password" placeholder="Новый пароль от 16 символов" minlength="16" autocomplete="new-password" required>
<button type="submit" class="primary">Создать модератора</button></form></div>
</div>
<div id="financePane" class="panel hide"><h2>Финансовый обзор</h2><p>Платёжные провайдеры ещё не подключены. Здесь показаны только выданные права доступа, без фиктивных оборотов.</p><div class="kpis" id="financeKpis"></div><p class="small" id="financeNote"></p></div>
<div id="documentsPane" class="panel hide"><h2>Юридические документы</h2>
<p>Публикация только утверждённых редакций. Предыдущие версии остаются в архиве.</p>
<form id="documentForm"><div class="form-grid">
<select name="slug"><option value="offer">Оферта</option><option value="rules">Правила</option><option value="privacy">Политика конфиденциальности</option><option value="processing">Обработка данных</option><option value="distribution">Распространение анкеты</option><option value="esignature">Электронная подпись</option><option value="overview">Обзор сервиса</option><option value="safety">Безопасность</option><option value="portfolio">Портфолио</option></select>
<input name="title" placeholder="Название документа" required></div>
<textarea name="body" rows="9" placeholder="Полный утверждённый текст" required></textarea>
<button class="primary" type="submit">Опубликовать редакцию</button></form>
<p><a href="/documents" target="_blank" rel="noopener noreferrer">Открыть публичные документы ↗</a></p><h2>История опубликованных редакций</h2><div id="documentHistory" class="table-wrap"></div></div>
<div id="articlesPane" class="panel hide"><h2>Статьи и тексты справки</h2>
<p>Здесь владелец может редактировать полезные статьи и помощь бота без изменения кода. Это <b>не</b> юридические документы и не согласия пользователей. Каждая редакция сохраняется с номером версии.</p>
<form id="guideForm"><div class="form-grid">
<select name="slug" id="guideSlug" required><option value="getting-started">Как начать</option><option value="portfolio">Портфолио</option><option value="safe-casting">Безопасность</option><option value="posting">Разместить заявку</option></select>
<input name="title" id="guideTitle" maxlength="120" placeholder="Заголовок статьи" required></div>
<textarea name="body" id="guideBody" rows="11" minlength="20" maxlength="3900" placeholder="Текст статьи. Пишите обычным текстом; Telegram разметит его безопасно." required></textarea>
<div class="flex"><button class="primary" type="submit">Сохранить новую редакцию</button><span id="guideInfo" class="small" aria-live="polite"></span></div>
</form></div>
</section><footer class="small">Панель управления «Мир моделей». Все изменения сохраняются на сервере.</footer>
<script>
(function(){
"use strict";
const el=id=>document.getElementById(id);
const sections={
 users:{title:"Пользователи",columns:[["id","Telegram ID"],["username","Ник"],["first_name","Имя"],["active","Активность"],["blocked","Блокировка"],["created_at","Регистрация"]]},
 jobs:{title:"Все заявки",columns:[["id","№"],["owner","Автор"],["name","Название"],["status","Статус"],["created_at","Создана"],["expires_at","Актуальна до"]]},
 pending:{title:"Модерация заявок",columns:[["id","№"],["owner","Автор"],["name","Название"],["created_at","Создана"]]},
 reports:{title:"Обращения",columns:[["id","№"],["reporter","От кого"],["kind","Тип"],["status","Статус"],["body","Текст"],["created_at","Создано"]]},
 sources:{title:"Источники Telegram",columns:[["id","ID"],["title","Название"],["city","Город"],["topic","Тема"],["active","Активен"],["mode","Режим"],["last_seen_at","Последняя запись"]]},
 candidates:{title:"Источники на проверке",columns:[["id","ID"],["title","Название"],["username","Ник"],["reason","Причина"],["total30","За 30 дней"],["checked_at","Проверен"]]},
 moderators:{title:"Модераторы",columns:[["id","№"],["username","Логин"],["active","Активен"],["created_at","Создан"],["updated_at","Изменён"]]},
 audit:{title:"Журнал действий",columns:[["id","№"],["actor","Система"],["action","Действие"],["details","Детали"],["created_at","Когда"]]}
};
const state={role:"owner",section:"summary",page:1,pages:1,q:"",busy:false,guides:[]};
const notice=(message,error=false)=>{let box=el("notice");box.textContent=message;box.className=error?"error":"";box.style.display="block"};
const fmt=v=>{
 if(v===null||v===undefined||v==="")return "—";
 if(typeof v==="boolean")return v?"Да":"Нет";
 if(typeof v==="object")return JSON.stringify(v).slice(0,250);
 if(typeof v==="string"&&/^\d{4}-\d\d-\d\dT/.test(v)){const d=new Date(v);return isNaN(d.getTime())?v:d.toLocaleString("ru-RU")}
 return String(v);
};
const label=(v)=>{const n=document.createElement("span");n.textContent=fmt(v);return n};
const button=(name,fn,danger=false)=>{const b=document.createElement("button");b.type="button";b.textContent=name;if(danger)b.className="danger";b.addEventListener("click",fn);return b};
const cell=(tr,title,value)=>{
 const td=document.createElement("td");td.dataset.label=title;
 const p=document.createElement("span");p.className="ellipsis";p.textContent=fmt(value);td.appendChild(p);tr.appendChild(td);
};
async function api(path,body){
 const isPost=body!==undefined;
 const response=await fetch("/admin/"+path,{method:isPost?"POST":"GET",credentials:"same-origin",headers:{"content-type":"application/json"},body:isPost?JSON.stringify(body):undefined});
 let data;try{data=await response.json()}catch{throw Error("Ответ сервера не удалось прочитать")}
 if(!response.ok)throw Error(data.error||"Ошибка "+response.status);
 return data;
}
function setAuthenticated(ok,role){
 el("login").hidden=ok;el("dashboard").hidden=!ok;el("logout").hidden=!ok;
 state.role=role||"owner";el("role").textContent=ok?(state.role==="owner"?"Владелец":"Модератор"):"";
 document.querySelectorAll(".owner-only").forEach(x=>x.hidden=state.role!=="owner");
}
function showKpis(host,data){
 host.replaceChildren();
 for(const pair of data){
  const card=document.createElement("div");card.className="kpi";
  const text=document.createElement("span");text.textContent=pair[0];
  const value=document.createElement("b");value.textContent=fmt(pair[1]);card.append(text,value);host.appendChild(card);
 }
}
async function loadSummary(){
 const data=await api("data?section=summary");
 setAuthenticated(true,data.role);
 const x=data.stats||{};
 showKpis(el("kpis"),[["Пользователи",x.users],["Заявки",x.jobs],["На модерации",x.pending],["Отклики",x.responses],["Активные источники",x.active_sources],["Новые обращения",x.new_support_tickets],["Очередь рассылок",x.queued_job_broadcasts],["Недоставленные отклики",x.queued_responses]]);
 el("summaryNote").textContent="Регистрация: "+(x.registration_enabled?"включена":"закрыта")+" · Юридические документы: "+(x.required_documents_ready?"подготовлены":"не утверждены")+" · Последний входящий Telegram update: "+fmt(x.latest_webhook_at);
}
const rowName=item=>(item.body&&typeof item.body==="object")?(item.body["название заявки"]||item.body["описание"]||"Без названия"):"—";
async function action(name,id,extra={},confirmText=null){
 if(confirmText&&!confirm(confirmText))return;
 try{
  const r=await api("action",{action:name,id,...extra});
  notice(r.message||"Действие выполнено: "+name+" (ID "+id+")");
  await Promise.all([loadList(),loadSummary()]);
 }catch(error){notice(error.message,true)}
}
function renderActions(item,tr){
 const td=document.createElement("td");td.dataset.label="Действия";td.className="actions-cell";
 const box=document.createElement("div");box.className="actions";
 const add=(title,actionName,extra={},sure=null)=>box.appendChild(button(title,()=>action(actionName,item.id,extra,sure),!!sure));
 if(state.section==="pending"){
  add("✓ Одобрить","approve");
  add("✕ Отклонить","reject",{},"Отклонить заявку №"+item.id+"?");
 }
 if(state.section==="users"&&state.role==="owner"){
  if(item.blocked)add("Разблокировать","unblock");
  else add("Заблокировать","block",{},"Заблокировать пользователя "+item.id+"?");
  add("+30 дней","access_grant",{days:30});
  add("Снять доступ","access_revoke",{},"Отозвать вручную выданный доступ?");
 }
 if(state.section==="moderators"&&state.role==="owner"){
  if(item.active)add("Отключить","moderator_disable",{},"Отключить модератора "+item.username+"?");
  else add("Включить","moderator_enable");
 }
 if(state.section==="sources"&&state.role==="owner"){
  if(item.active)add("Отключить","source_off",{},"Отключить источник "+item.id+"?");
  else add("Включить","source_on");
 }
 if(state.section==="candidates"){
  if(state.role==="owner")add("✓ Подключить","candidate_approve");
  add("✕ Отклонить","candidate_reject",{},"Отклонить источник "+item.id+"?");
 }
 if(state.section==="reports"){
  if(item.status!=="in_progress")add("В работу","ticket_status",{status:"in_progress"});
  if(item.status!=="closed")add("Закрыть","ticket_status",{status:"closed"});
  if(item.status!=="new")add("Вернуть в новые","ticket_status",{status:"new"});
  const reply=document.createElement("textarea");reply.className="inline-reply";reply.placeholder="Ответ участнику";reply.maxLength=3000;reply.setAttribute("aria-label","Ответ на обращение "+item.id);
  const send=button("Ответить",async()=>{
   const message=reply.value.trim();if(!message){notice("Введите ответ",true);return}
   try{const r=await api("action",{action:"ticket_reply",id:item.id,message});notice(r.message||"Ответ отправлен по обращению №"+item.id);reply.value="";await loadList()}catch(error){notice(error.message,true)}
  });
  td.append(box,reply,send);tr.appendChild(td);return;
 }
 if(state.section==="jobs"&&state.role==="owner"&&item.status==="pending"){add("✓ Одобрить","approve");add("✕ Отклонить","reject",{},"Отклонить заявку?")}
 td.appendChild(box);tr.appendChild(td);
}
function renderList(data){
 state.page=data.page;state.pages=data.pages;
 const target=el("listResults");target.replaceChildren();
 if(!data.items.length){const empty=document.createElement("p");empty.textContent="По этому запросу записей нет.";target.appendChild(empty)}
 else{
  const table=document.createElement("table"),thead=document.createElement("thead"),head=document.createElement("tr");
  for(const [,label] of sections[state.section].columns){const th=document.createElement("th");th.textContent=label;head.appendChild(th)}
  const acts=document.createElement("th");acts.textContent="Действия";head.appendChild(acts);thead.appendChild(head);table.appendChild(thead);
  const tbody=document.createElement("tbody");
  for(const row of data.items){
   const tr=document.createElement("tr");
   for(const [key,title] of sections[state.section].columns)cell(tr,title,key==="name"?rowName(row):row[key]);
   renderActions(row,tr);tbody.appendChild(tr);
  }
  table.appendChild(tbody);target.appendChild(table);
 }
 el("pageInfo").textContent="Страница "+state.page+" из "+state.pages+" · всего "+data.total;
 el("prevPage").disabled=state.page<=1;el("nextPage").disabled=state.page>=state.pages;
}
async function loadList(){
 const params=new URLSearchParams({section:state.section,page:String(state.page),q:state.q});
 const data=await api("data?"+params.toString());
 renderList(data);
}
async function loadFinance(){
 const d=await api("data?section=finance");
 const x=d.finance||{};
 showKpis(el("financeKpis"),[["Ручной доступ активен",x.manual_access_active],["Пробный доступ активен",x.trial_access_active],["Пересечение доступов",x.overlapping_access],["Подтверждённая выручка",x.recognized_revenue===null?"Нет данных":x.recognized_revenue],["Транзакции",x.payment_count===null?"Нет данных":x.payment_count]]);
 el("financeNote").textContent=x.note||"Нет данных платёжных систем";
}
async function loadDocuments(){
 const data=await api("data?section=documents");
 const root=el("documentHistory");root.replaceChildren();
 const history=data.history||[];
 if(!history.length){
  const label=document.createElement("p");label.textContent="Утверждённые редакции пока не опубликованы. Для публичного запуска нужны юридически проверенные тексты.";root.appendChild(label);return;
 }
 const table=document.createElement("table"),head=document.createElement("tr"),thead=document.createElement("thead"),body=document.createElement("tbody");
 for(const name of ["Раздел","Редакция","Название","Опубликовано","SHA-256"]){const th=document.createElement("th");th.textContent=name;head.appendChild(th)}
 thead.appendChild(head);table.appendChild(thead);
 for(const item of history){
  const row=document.createElement("tr");
  for(const [name,value] of [["Раздел",item.slug],["Редакция",item.version],["Название",item.title],["Опубликовано",item.published_at],["SHA-256",item.sha256]]){
   cell(row,name,value);
  }
  body.appendChild(row);
 }
 table.appendChild(body);root.appendChild(table);
}
function selectGuideRecord(){
 const slug=el("guideSlug").value;
 const guide=state.guides.find(g=>g.slug===slug);
 el("guideTitle").value=guide?guide.title:"";
 el("guideBody").value=guide?guide.body:"";
 el("guideInfo").textContent=guide?(guide.version?"Опубликована редакция №"+guide.version:"Исходный текст, ещё не редактировался"):"Статья не найдена";
}
async function loadArticles(){
 const data=await api("data?section=articles");
 state.guides=data.articles||[];
 selectGuideRecord();
}
async function selectTab(section){
 if(!["summary","finance","documents","articles"].includes(section)&&!sections[section])return;
 if(state.role!=="owner"&&["finance","documents","articles","audit","moderators"].includes(section))return;
 state.section=section;state.page=1;state.q="";
 el("search").value="";
 document.querySelectorAll("nav [data-tab]").forEach(b=>b.setAttribute("aria-current",b.dataset.tab===section?"page":"false"));
 el("summaryPane").classList.toggle("hide",section!=="summary");
 el("listPane").classList.toggle("hide",!sections[section]);
 el("financePane").classList.toggle("hide",section!=="finance");
 el("documentsPane").classList.toggle("hide",section!=="documents");
 el("articlesPane").classList.toggle("hide",section!=="articles");
 el("sourceAdd").classList.toggle("hide",section!=="sources"||state.role!=="owner");
 el("moderatorAdd").classList.toggle("hide",section!=="moderators"||state.role!=="owner");
 if(sections[section]){
  el("sectionTitle").textContent=sections[section].title;
  el("listHelp").textContent="Поиск по ID и основным полям · 20 записей на страницу";
  await loadList();
 }else if(section==="finance")await loadFinance();
 else if(section==="documents")await loadDocuments();
  else if(section==="articles")await loadArticles();
 else if(section==="summary")await loadSummary();
}
async function boot(){
 try{await loadSummary();await selectTab(state.section);}
 catch(error){setAuthenticated(false);if(error.message!=="Требуется вход.")notice(error.message,true)}
}
el("loginForm").onsubmit=async event=>{
 event.preventDefault();const form=new FormData(event.target);
 try{const data=await api("login",{username:form.get("username"),password:form.get("password")});event.target.reset();state.role=data.role;await boot();notice("Вход выполнен. Доступ: "+(data.role==="owner"?"владелец":"модератор"))}
 catch(error){notice(error.message,true)}
};
el("logout").onclick=async()=>{try{await api("logout",{});setAuthenticated(false);notice("Вы вышли из панели.")}catch(e){notice(e.message,true)}};
document.querySelectorAll("nav [data-tab]").forEach(b=>b.onclick=()=>selectTab(b.dataset.tab).catch(e=>notice(e.message,true)));
el("refreshSummary").onclick=()=>loadSummary().then(()=>notice("Показатели обновлены")).catch(e=>notice(e.message,true));
el("refreshList").onclick=()=>loadList().then(()=>notice("Список обновлён")).catch(e=>notice(e.message,true));
el("searchButton").onclick=()=>{state.q=el("search").value.trim();state.page=1;loadList().catch(e=>notice(e.message,true))};
el("search").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();el("searchButton").click()}};
el("resetSearch").onclick=()=>{state.q="";state.page=1;el("search").value="";loadList().catch(e=>notice(e.message,true))};
el("prevPage").onclick=()=>{state.page=Math.max(1,state.page-1);loadList().catch(e=>notice(e.message,true))};
el("nextPage").onclick=()=>{state.page=Math.min(state.pages,state.page+1);loadList().catch(e=>notice(e.message,true))};
el("sourceForm").onsubmit=async event=>{
 event.preventDefault();const form=new FormData(event.target);
 try{const r=await api("action",{action:"source_add",id:form.get("id"),city:form.get("city"),topic:form.get("topic")});
 notice(r.message||"Источник добавлен");event.target.reset();await loadList()
 }catch(e){notice(e.message,true)}
};
el("moderatorForm").onsubmit=async event=>{
 event.preventDefault();const form=new FormData(event.target);
 try{
  const data=await api("action",{action:"moderator_create",username:form.get("username"),password:form.get("password")});
  notice(data.message||"Модератор создан");event.target.reset();await loadList();
 }catch(error){notice(error.message,true)}
};
el("guideSlug").onchange=()=>selectGuideRecord();
el("guideForm").onsubmit=async event=>{
 event.preventDefault();
 if(!confirm("Опубликовать новую редакцию справочной статьи? Юридические документы это не изменит."))return;
 const form=new FormData(event.target);
 try{
  const slug=String(form.get("slug"));
  const result=await api("action",{action:"guide_publish",slug,title:form.get("title"),body:form.get("body")});
  notice(result.message||"Справка обновлена");
  await loadArticles();
  el("guideSlug").value=slug;selectGuideRecord();
 }catch(error){notice(error.message,true)}
};
el("documentForm").onsubmit=async event=>{
 event.preventDefault();if(!confirm("Публикуется только юридически утверждённая версия. Подтвердить?"))return;
 const form=new FormData(event.target);
 try{const d=await api("action",{action:"document_publish",slug:form.get("slug"),title:form.get("title"),body:form.get("body")});
 notice("Опубликована редакция №"+d.document.version);event.target.reset();await Promise.all([loadSummary(),loadDocuments()]);
 }catch(e){notice(e.message,true)}
};
boot();
})();
</script></main></body></html>`);
