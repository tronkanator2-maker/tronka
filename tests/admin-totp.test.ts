import {test,expect} from "bun:test";
import {decodeTotpSecret,totpCode,verifyAdminTotp} from "../admin-totp.ts";
import {adminApp} from "../admin.ts";

const rfcSecret="GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // RFC 6238 public test fixture; not a service credential
test("RFC 6238 six-digit HMAC-SHA1 vectors and skew",async()=>{
 expect(decodeTotpSecret(rfcSecret)?.length).toBe(20);
 expect(await totpCode(rfcSecret,59000)).toBe("287082");
 expect(await totpCode(rfcSecret,1111111109000)).toBe("081804");
 expect(await verifyAdminTotp(rfcSecret,"287082",59000)).toBe(true);
 expect(await verifyAdminTotp(rfcSecret,"287082",71000)).toBe(true);
 expect(await verifyAdminTotp(rfcSecret,"287082",119000)).toBe(false);
});
test("malformed codes and keys cannot authenticate",async()=>{
 for(const value of [null,undefined,"","12345","1234567","abc456",123456,"      ", "000000\n"]){
  expect(await verifyAdminTotp(rfcSecret,value,59000)).toBe(false);
 }
 for(const secret of ["", "wrong+key", "A", "ABCD", "🏆", "A".repeat(15)])
  expect(await verifyAdminTotp(secret,"287082",59000)).toBe(false);
 expect(decodeTotpSecret("not_a_secret")).toBeNull();
});
test("correct password alone no longer authenticates owner once secret is configured",async()=>{
 const original={password:Bun.env.ADMIN_PASSWORD,totp:Bun.env.ADMIN_TOTP_SECRET};
 const pass="owner-otp-test-password-very-long",secret=rfcSecret;
 Bun.env.ADMIN_PASSWORD=pass;Bun.env.ADMIN_TOTP_SECRET=secret;
 const endpoint="https://otp-panel.example/admin/login";
 const request=(password,totp)=>new Request(endpoint,{
  method:"POST",headers:{"content-type":"application/json"},
  body:JSON.stringify({password,totp})
 });
 const sql=async()=>[];
 try{
  const passwordOnly=await adminApp(request(pass,undefined),sql);
  expect(passwordOnly.status).toBe(401);
  expect(passwordOnly.headers.get("set-cookie")).toBeNull();
  const badOtp=await adminApp(request(pass,"000000"),sql);
  expect(badOtp.status).toBe(401);
  const wrongPassword=await adminApp(request("wrong-password",await totpCode(secret)),sql);
  expect(wrongPassword.status).toBe(401);
  const nowCode=await totpCode(secret);
  const login=await adminApp(request(pass,nowCode),sql);
  expect(login.status).toBe(200);
  expect((await login.json()).role).toBe("owner");
  expect(login.headers.get("set-cookie")).toContain("HttpOnly");
 }finally{
  if(original.password===undefined)delete Bun.env.ADMIN_PASSWORD;else Bun.env.ADMIN_PASSWORD=original.password;
  if(original.totp===undefined)delete Bun.env.ADMIN_TOTP_SECRET;else Bun.env.ADMIN_TOTP_SECRET=original.totp;
 }
});
