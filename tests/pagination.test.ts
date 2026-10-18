import {test,expect} from "bun:test";
import {parsePageOffset,pageNavigation} from "../pagination.ts";

test("job and personal listing pages have bounded, independent destinations",()=>{
 expect(parsePageOffset("jobs","jobs")).toBe(0);
 expect(parsePageOffset("jobs:5","jobs")).toBe(5);
 expect(parsePageOffset("jobs:100","jobs")).toBe(100);
 expect(parsePageOffset("mine","mine")).toBe(0);
 expect(parsePageOffset("mine:25","mine")).toBe(25);
 expect(parsePageOffset("jobs:5","mine")).toBeNull();
 expect(parsePageOffset("mine:10","jobs")).toBeNull();
 for(const value of ["jobs:1","jobs:6","jobs:-5","jobs:101","jobs:500","jobs:3.5","jobs:0;DROP","jobs:9999999999999999","jobs:05","jobs:xyz"]){
  expect(parsePageOffset(value,"jobs")).toBeNull();
 }
});
test("pagination creates usable back/forward buttons only when needed",()=>{
 expect(pageNavigation("jobs",0,true)).toEqual([["Дальше ▶️","jobs:5"]]);
 expect(pageNavigation("jobs",5,true)).toEqual([["◀️ Назад","jobs:0"],["Дальше ▶️","jobs:10"]]);
 expect(pageNavigation("jobs",10,false)).toEqual([["◀️ Назад","jobs:5"]]);
 expect(pageNavigation("mine",0,false)).toEqual([]);
});

test("Next button stops at last permitted offset instead of producing a dead jobs:105 link",()=>{
 expect(pageNavigation("jobs",95,true)).toEqual([["◀️ Назад","jobs:90"],["Дальше ▶️","jobs:100"]]);
 expect(pageNavigation("jobs",100,true)).toEqual([["◀️ Назад","jobs:95"]]);
 expect(pageNavigation("mine",100,true)).toEqual([["◀️ Назад","mine:95"]]);
});
