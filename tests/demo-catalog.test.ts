import {test,expect} from "bun:test";
import {demoProfiles,demoJobs,demoPage,demoItem,demoRoute} from "../demo-catalog.ts";
import {parseFields,eligibleProfile} from "../engine.ts";

test("exactly 10 complete fictional profile cards with individual navigation IDs",()=>{
 expect(demoProfiles).toHaveLength(10);
 expect(new Set(demoProfiles.map(x=>x.id)).size).toBe(10);
 expect(new Set(demoProfiles.map(x=>x.name)).size).toBe(10);
 for(const item of demoProfiles){
  expect(item.id).toBeGreaterThan(0);
  expect(item.name.length).toBeGreaterThan(4);
  expect(item.age).toBeGreaterThanOrEqual(18);
  expect(item.city.length).toBeGreaterThan(1);
  expect(item.role.length).toBeGreaterThan(2);
  expect(item.about.length).toBeGreaterThan(20);
  expect(item).not.toHaveProperty("telegramId");
  expect(item).not.toHaveProperty("photo");
  expect(JSON.stringify(item)).not.toMatch(/@\w{5,}|https?:\/\//);
 }
});
test("exactly 10 fictional job examples, no live application target or contacts",()=>{
 expect(demoJobs).toHaveLength(10);
 expect(new Set(demoJobs.map(x=>x.id)).size).toBe(10);
 for(const j of demoJobs){
  expect(j.title.length).toBeGreaterThan(6);
  expect(j.city.length).toBeGreaterThan(1);
  expect(j.who.length).toBeGreaterThan(2);
  expect(j.description.length).toBeGreaterThan(15);
  expect(j.id).toBeGreaterThan(0);
  expect(j).not.toHaveProperty("owner");
  expect(j).not.toHaveProperty("telegramId");
  expect(JSON.stringify(j)).not.toMatch(/@\w{5,}|https?:\/\//);
 }
});
test("demo pages and details can all be reached, including last page",()=>{
 for(const kind of ["profiles","jobs"]){
  expect(demoPage(kind,0).items).toHaveLength(4);
  expect(demoPage(kind,1).items).toHaveLength(4);
  expect(demoPage(kind,2).items).toHaveLength(2);
  expect(demoPage(kind,2).pages).toBe(3);
  expect(demoPage(kind,-1)).toBeNull();
  expect(demoPage(kind,3)).toBeNull();
  expect(demoPage(kind,100000)).toBeNull();
  const all=[0,1,2].flatMap(page=>demoPage(kind,page).items);
  expect(all.map(x=>x.id)).toEqual([1,2,3,4,5,6,7,8,9,10]);
  for(const entry of all)expect(demoItem(kind,entry.id)).toBe(entry);
  expect(demoItem(kind,11)).toBeNull();
 }
});
test("demo routes are bounded and cannot be confused with real invite or application callbacks",()=>{
 expect(demoRoute("home")).toEqual({kind:"home"});
 expect(demoRoute("catalog")).toEqual({kind:"list",type:"profiles",page:0});
 expect(demoRoute("profile")).toEqual({kind:"detail",type:"profiles",id:1});
 expect(demoRoute("job")).toEqual({kind:"detail",type:"jobs",id:1});
 expect(demoRoute("profiles:2")).toEqual({kind:"list",type:"profiles",page:2});
 expect(demoRoute("jobs:2")).toEqual({kind:"list",type:"jobs",page:2});
 expect(demoRoute("profile:10")).toEqual({kind:"detail",type:"profiles",id:10});
 expect(demoRoute("job:10")).toEqual({kind:"detail",type:"jobs",id:10});
 for(const invalid of ["profile:-1","job:10000","profiles:../../etc","profiles:abc","reply:1","relay:1","invite:1","jobs:999"]){
  const route=demoRoute(invalid);
  expect(!route||route.kind==="list"&&demoPage(route.type,route.page)===null).toBe(true);
 }
});
test("a pasted model template contains valid required fields",()=>{
 const copy=`Кто вы: модель
Имя: Алина
Дата рождения: 12.09.2002
Город: Москва
Пол: женский
Рост: 172
Размер одежды: 42
Цвет волос: русый
Длина волос: длинные
Формат: коммерция
Прайс: 3000 ₽/час
О себе: съёмки каталогов`;
 const parsed=parseFields(copy);
 expect(parsed["кто вы"]).toBe("модель");
 expect(parsed["имя"]).toBe("Алина");
 expect(parsed["дата рождения"]).toBe("12.09.2002");
 expect(eligibleProfile(parsed,"photo-file-id")).toBe(true);
});
