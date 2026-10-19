import {test,expect} from "bun:test";
import {adminApp} from "../admin.ts";

test("owner creates named moderator and revoking role blocks existing session immediately",async()=>{
 const saved={owner:Bun.env.ADMIN_PASSWORD,legacy:Bun.env.ADMIN_MODERATOR_PASSWORD,url:Bun.env.PUBLIC_URL};
 Bun.env.ADMIN_PASSWORD="owner-integration-password-2026";
 delete Bun.env.ADMIN_MODERATOR_PASSWORD;delete Bun.env.PUBLIC_URL;
 let member=null;
 const calls=[];
 const sql=async(query,...args)=>{
  calls.push({query,args});
  if(query.startsWith("INSERT INTO mm_admin_moderators")){
   member={id:91,username:args[0],password_hash:args[1],active:true};
   return [{id:member.id,username:member.username,active:member.active}];
  }
  if(query.startsWith("SELECT id,username,password_hash"))return member?.active&&member.username===args[0]?[{...member}]:[];
  if(query.startsWith("SELECT id FROM mm_admin_moderators"))return member?.active&&member.id===args[0]?[{id:91}]:[];
  if(query.startsWith("UPDATE mm_admin_moderators")){
   if(!member||member.id!==args[1])return [];
   member.active=args[0];return [{id:member.id,username:member.username,active:member.active}];
  }
  if(query.startsWith("SELECT COUNT(*)"))return [{total:1}];
  if(query.startsWith("SELECT id,username,active,created_at,updated_at FROM mm_admin_moderators"))return [{id:91,username:member?.username,active:member?.active}];
  return [];
 };
 const request=(path,method="GET",payload,auth)=>{
  const headers={"content-type":"application/json","x-forwarded-for":"198.51.100.88"};
  if(method==="POST")headers.origin="https://adm.example";
  if(auth)headers.cookie=auth;
  return new Request("https://adm.example"+path,{method,headers,body:method==="POST"?JSON.stringify(payload):undefined});
 };
 try{
  const ownerLogin=await adminApp(request("/admin/login","POST",{password:"owner-integration-password-2026"}),sql);
  expect(ownerLogin.status).toBe(200);
  const ownerCookie=ownerLogin.headers.get("set-cookie").split(";")[0];
  const create=await adminApp(request("/admin/action","POST",{action:"moderator_create",username:"team.admin",password:"safe-password-of-20-chars"},ownerCookie),sql);
  expect(create.status).toBe(200);
  const created=await create.json();
  expect(created.moderator.username).toBe("team.admin");
  expect(JSON.stringify(created)).not.toContain("password_hash");
  expect(member.password_hash).not.toContain("safe-password-of-20-chars");
  const modLogin=await adminApp(request("/admin/login","POST",{username:"team.admin",password:"safe-password-of-20-chars"}),sql);
  expect(modLogin.status).toBe(200);
  const modCookie=modLogin.headers.get("set-cookie").split(";")[0];
  expect((await modLogin.json()).role).toBe("moderator");
  expect((await adminApp(request("/admin/data?section=moderators","GET",null,modCookie),sql)).status).toBe(403);
  expect((await adminApp(request("/admin/data?section=finance","GET",null,modCookie),sql)).status).toBe(403);
  expect((await adminApp(request("/admin/data?section=documents","GET",null,modCookie),sql)).status).toBe(403);
  expect((await adminApp(request("/admin/action","POST",{action:"moderator_disable",id:91},modCookie),sql)).status).toBe(403);
  const disable=await adminApp(request("/admin/action","POST",{action:"moderator_disable",id:91},ownerCookie),sql);
  expect(disable.status).toBe(200);
  expect(member.active).toBe(false);
  expect((await adminApp(request("/admin/data?section=reports","GET",null,modCookie),sql)).status).toBe(401);
  expect((await adminApp(request("/admin/login","POST",{username:"team.admin",password:"safe-password-of-20-chars"}),sql)).status).toBe(401);
 }finally{
  if(saved.owner===undefined)delete Bun.env.ADMIN_PASSWORD;else Bun.env.ADMIN_PASSWORD=saved.owner;
  if(saved.legacy===undefined)delete Bun.env.ADMIN_MODERATOR_PASSWORD;else Bun.env.ADMIN_MODERATOR_PASSWORD=saved.legacy;
  if(saved.url===undefined)delete Bun.env.PUBLIC_URL;else Bun.env.PUBLIC_URL=saved.url;
 }
});
