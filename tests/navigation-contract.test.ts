import {test,expect} from "bun:test";

// Static navigation contract: no database or Telegram credentials are required.
// This catches accidental removal of a handler while changing the main menu.
const source=await Bun.file(new URL("../bot.ts",import.meta.url)).text();
const menuSource=source.slice(source.indexOf("const menu="),source.indexOf("const esc="));
const actions=Object.fromEntries([
 ["profile",'if(a==="profile")'],
 ["browse:0",'if(a.startsWith("browse:"))'],
 ["jobs",'if(a==="jobs")'],
 ["new",'if(a==="new")'],
 ["filters",'if(a==="filters")'],
 ["mine",'if(a==="mine")'],
 ["myresponses",'if(a==="myresponses")'],
 ["myinvites",'if(a==="myinvites")'],
 ["pause",'if(a==="pause")'],
 ["how",'if(c.data==="how")'],
 ["more",'if(a==="more")']
]);

test("every button in the main navigation has a corresponding action handler",()=>{
 const callbacks=[...menuSource.matchAll(/callback_data:"([^"]+)"/g)].map(match=>match[1]);
 expect(callbacks.sort()).toEqual(Object.keys(actions).sort());
 const callbackHandlers=source.slice(source.indexOf("async function onCallback("));
 for(const callback of callbacks)expect(callbackHandlers.includes(actions[callback])).toBe(true);
});
test("consent buttons and navigation use separate handlers",()=>{
 for(const route of ['test:consent:','test:docs','test:agree']){
  expect(source).toContain(route);
 }
 expect(source).toContain("toggleTestAcknowledgement(sql,id,n)");
 expect(source).toContain("activateTestAccess(sql,id)");
 expect(source).toContain("revokeTestAccess(sql,id)");
});
test("unknown old inline keyboards receive visible feedback",()=>{
 expect(source).toContain("Эта кнопка больше не действует.");
});
