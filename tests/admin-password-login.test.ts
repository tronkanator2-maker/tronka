import {test,expect} from "bun:test";
import {adminApp} from "../admin.ts";

test("admin login uses the configured password without requiring a 2FA code",async()=>{
 const previous=Bun.env.ADMIN_PASSWORD;
 Bun.env.ADMIN_PASSWORD="test-admin-password";
 try{
  const page=await adminApp(new Request("https://example.test/admin"),async()=>[]);
  expect(await page.text()).not.toContain("Код 2FA");
  const response=await adminApp(new Request("https://example.test/admin/login",{
   method:"POST",
   headers:{"content-type":"application/json"},
   body:JSON.stringify({password:"test-admin-password"})
  }),async()=>[]);
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toContain("mm_admin=");
 }finally{
  if(previous===undefined)delete Bun.env.ADMIN_PASSWORD;
  else Bun.env.ADMIN_PASSWORD=previous;
 }
});
