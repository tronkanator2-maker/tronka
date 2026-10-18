import {test,expect} from "bun:test";
import {renderCatalogPage} from "../catalog-page.ts";

const person=(id,name,role="фотограф",city="Москва")=>({
 id,profile:{"имя":name,"кто вы":role,"город":city,"дата рождения":"01.01.2000"}
});
const callbacks=rows=>rows.flat().map(([,action])=>action);

test("catalog keeps a page to one message with three individually openable profiles",()=>{
 const people=[person(11,"Анна"),person(12,"Борис"),person(13,"Вера"),person(14,"Глеб")];
 const first=renderCatalogPage(people,0,"Москва",["фотограф"]);
 expect(first.text).toContain("реальных на странице: 3");
 expect(first.text).toContain("Анна");
 expect(first.text).not.toContain("Глеб");
 expect(callbacks(first.rows).filter(action=>action.startsWith("profile_view:"))).toEqual([
  "profile_view:11:0","profile_view:12:0","profile_view:13:0"
 ]);
 expect(callbacks(first.rows)).toContain("browse:3");
 const next=renderCatalogPage(people,3,"Москва",["фотограф"]);
 expect(next.text).toContain("реальных на странице: 1");
 expect(callbacks(next.rows)).toContain("profile_view:14:3");
 expect(callbacks(next.rows)).toContain("browse:0");
 expect(callbacks(next.rows)).not.toContain("browse:6");
});

test("catalog previews escape HTML and hide direct contacts",()=>{
 const page=renderCatalogPage([person(17,"<Анна> @secretname","визажист","Москва <центр>")],0,"<Москва>",["визажист"]);
 expect(page.text).toContain("&lt;Анна&gt; [контакт скрыт]");
 expect(page.text).toContain("&lt;центр&gt;");
 expect(page.text).not.toContain("@secretname");
 expect(page.text).not.toContain("<центр>");
 expect(page.text).toContain("Город: &lt;Москва&gt;");
});

test("empty catalog still offers filters and menu in the same response",()=>{
 const page=renderCatalogPage([],0,"",[]);
 expect(page.text).toContain("Реальных анкет");
 expect(callbacks(page.rows)).toContain("browse_roles");
 expect(callbacks(page.rows)).toContain("browse_city");
 expect(callbacks(page.rows)).toContain("home");
 expect(callbacks(page.rows).some(action=>action.startsWith("profile_view:"))).toBe(false);
});

test("fictional profile samples appear inline and open read-only sample cards",()=>{
 const sample={id:1,demo:true,age:24,profile:{"имя":"Алина Ветер","кто вы":"модель","город":"Москва"}};
 const page=renderCatalogPage([],0,"Москва",["модель"],[sample]);
 expect(page.text).toContain("Пример анкеты");
 expect(page.text).toContain("Алина Ветер");
 expect(page.text).toContain("Примеры вымышленные.");
 expect(callbacks(page.rows)).toContain("demo:profile:1");
 expect(callbacks(page.rows).some(action=>action.startsWith("profile_view:"))).toBe(false);
 expect(callbacks(page.rows)).not.toContain("demo:profiles:0");
});
