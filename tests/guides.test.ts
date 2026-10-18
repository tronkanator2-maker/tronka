import {test,expect} from "bun:test";
import {GUIDES,getGuide,guideMenu} from "../guides.ts";
test("all help cards are available without unpublished document dependencies",()=>{
 const actions=guideMenu();
 expect(actions.length).toBeGreaterThanOrEqual(4);
 for(const [title,action] of actions){
  expect(title.length).toBeGreaterThan(2);
  expect(action.startsWith("guide:")).toBe(true);
  expect(getGuide(action.slice(6))?.text).toContain("<b>");
 }
 expect(getGuide("not-a-guide")).toBeNull();
});
test("portfolio and safety guides include actionable information",()=>{
 expect(GUIDES.portfolio.text).toContain("фото");
 expect(GUIDES["safe-casting"].text).toContain("предоплату");
 expect(GUIDES.posting.text).toContain("гонорар");
});
