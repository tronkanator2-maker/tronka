import {test,expect} from "bun:test";
import {renderJobsPage} from "../jobs-page.ts";

const job=(id,title,city="Москва")=>({id,body:{"название заявки":title,"кого ищу":"модель","город":city,"тип работы":"реклама"}});
const callbacks=rows=>rows.flat().map(([,action])=>action);

test("job search renders a compact page with individually openable cards",()=>{
 const page=renderJobsPage([job(11,"Съёмка А"),job(12,"Съёмка Б"),job(13,"Съёмка В"),job(14,"Съёмка Г"),job(15,"Съёмка Д"),job(16,"Съёмка Е")]);
 expect(page.text).toContain("показано 5 из 6");
 expect(page.text).toContain("Съёмка А");
 expect(page.text).not.toContain("Съёмка Е");
 expect(callbacks(page.rows)).toContain("job_view:11:0");
 expect(callbacks(page.rows)).toContain("jobs:5");
 expect(callbacks(page.rows)).toContain("demo:jobs:0");
});

test("job search previews escape HTML and hide contact details",()=>{
 const page=renderJobsPage([job(17,"<Работа> @secretname","Москва <центр>")]);
 expect(page.text).toContain("&lt;Работа&gt; [контакт скрыт]");
 expect(page.text).toContain("&lt;центр&gt;");
 expect(page.text).not.toContain("@secretname");
 expect(callbacks(page.rows)).toContain("job_view:17:0");
});

test("empty job page still offers demos, filters, and menu",()=>{
 const page=renderJobsPage([]);
 expect(page.text).toContain("Подходящих заявок пока нет");
 expect(callbacks(page.rows)).toContain("demo:jobs:0");
 expect(callbacks(page.rows)).toContain("filters");
 expect(callbacks(page.rows)).toContain("home");
});
