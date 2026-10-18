import {test,expect} from "bun:test";
import {renderJobsPage} from "../jobs-page.ts";

const job=(id,title,city="Москва")=>({id,body:{"название заявки":title,"кого ищу":"модель","город":city,"тип работы":"реклама"}});
const callbacks=rows=>rows.flat().map(([,action])=>action);

test("job search renders a compact page with individually openable cards",()=>{
 const page=renderJobsPage([job(11,"Съёмка А"),job(12,"Съёмка Б"),job(13,"Съёмка В"),job(14,"Съёмка Г"),job(15,"Съёмка Д"),job(16,"Съёмка Е")]);
 expect(page.text).toContain("реальных на странице: 5");
 expect(page.text).toContain("Съёмка А");
 expect(page.text).not.toContain("Съёмка Е");
 expect(callbacks(page.rows)).toContain("job_view:11:0");
 expect(callbacks(page.rows)).toContain("jobs:5");
 expect(callbacks(page.rows)).not.toContain("demo:jobs:0");
});

test("job search previews escape HTML and hide contact details",()=>{
 const page=renderJobsPage([job(17,"<Работа> @secretname","Москва <центр>")]);
 expect(page.text).toContain("&lt;Работа&gt; [контакт скрыт]");
 expect(page.text).toContain("&lt;центр&gt;");
 expect(page.text).not.toContain("@secretname");
 expect(callbacks(page.rows)).toContain("job_view:17:0");
});

test("fictional job samples appear inline with read-only actions and response guidance",()=>{
 const sample={id:1,title:"Каталог осенней одежды",city:"Москва",who:"модель",pay:"6 000 ₽ за смену"};
 const page=renderJobsPage([],0,[sample],false);
 expect(page.text).toContain("Каталог осенней одежды");
 expect(page.text).toContain("Пример заявки");
 expect(page.text).toContain("Примеры вымышленные.");
 expect(page.text).toContain("Для отклика заполните анкету");
 expect(callbacks(page.rows)).toContain("demo:job:1");
 expect(callbacks(page.rows)).not.toContain("demo:jobs:0");
 expect(callbacks(page.rows)).toContain("filters");
 expect(callbacks(page.rows)).toContain("home");
});
