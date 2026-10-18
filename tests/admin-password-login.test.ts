import {test,expect} from "bun:test";
import {adminApp} from "../admin.ts";

test("admin login uses the configured password without requiring a 2FA code",async()=>{
 const previous=Bun.env.ADMIN_PASSWORD;
 const previousUrl=Bun.env.PUBLIC_URL;
 Bun.env.ADMIN_PASSWORD="test-admin-password";
 Bun.env.PUBLIC_URL="https://public.example.test";
 try{
  const page=await adminApp(new Request("http://internal:3000/admin"),async()=>[]);
  expect(await page.text()).not.toContain("Код 2FA");
  const response=await adminApp(new Request("http://internal:3000/admin/login",{
   method:"POST",
   headers:{"content-type":"application/json"},
   body:JSON.stringify({password:"test-admin-password"})
  }),async()=>[]);
  expect(response.status).toBe(200);
  const cookie=response.headers.get("set-cookie");
  expect(cookie).toContain("mm_admin=");
  const action=await adminApp(new Request("http://internal:3000/admin/action",{
   method:"POST",
   headers:{"content-type":"application/json","origin":"https://public.example.test",cookie},
   body:JSON.stringify({action:"unknown",id:1})
  }),async()=>[]);
  expect(action.status).not.toBe(403);
 }finally{
  if(previous===undefined)delete Bun.env.ADMIN_PASSWORD;
  else Bun.env.ADMIN_PASSWORD=previous;
  if(previousUrl===undefined)delete Bun.env.PUBLIC_URL;
  else Bun.env.PUBLIC_URL=previousUrl;
 }
});
