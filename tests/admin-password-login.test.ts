import {test,expect} from "bun:test";
import {adminApp} from "../admin.ts";

test("admin login remains available with password while owner has not enabled 2FA",async()=>{
 const previous=Bun.env.ADMIN_PASSWORD;
 const previousUrl=Bun.env.PUBLIC_URL;
 const previousOtp=Bun.env.ADMIN_TOTP_SECRET;
 delete Bun.env.ADMIN_TOTP_SECRET;
 Bun.env.ADMIN_PASSWORD="test-admin-password";
 Bun.env.PUBLIC_URL="https://public.example.test";
 try{
  const page=await adminApp(new Request("http://internal:3000/admin"),async()=>[]);
  expect(await page.text()).toContain("Код 2FA");
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
  if(previousOtp===undefined)delete Bun.env.ADMIN_TOTP_SECRET;
  else Bun.env.ADMIN_TOTP_SECRET=previousOtp;
  if(previousUrl===undefined)delete Bun.env.PUBLIC_URL;
  else Bun.env.PUBLIC_URL=previousUrl;
 }
});
