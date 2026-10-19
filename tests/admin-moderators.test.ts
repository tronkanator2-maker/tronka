import {test,expect} from "bun:test";
import {moderatorInput,createModerator,authenticateModerator,updateModeratorStatus} from "../admin-moderators.ts";

test("moderator account creation validates logins and strong passwords",()=>{
 expect(moderatorInput("  New.Team  ","sixteen-characters-plus")).toEqual({name:"new.team",secret:"sixteen-characters-plus"});
 for(const name of ["aa","имя","x@bad","a".repeat(33)])expect(()=>moderatorInput(name,"sixteen-characters-plus")).toThrow();
 expect(()=>moderatorInput("moderator","tiny")).toThrow();
});
test("moderator password is stored only as an Argon2id hash; revocation stops authentication",async()=>{
 let account=null;
 const queries=[];
 const sql=async(query,...args)=>{
  queries.push({query,args});
  if(query.startsWith("INSERT INTO mm_admin_moderators")){
   account={id:13,username:args[0],password_hash:args[1],active:true};
   return [{id:account.id,username:account.username,active:true}];
  }
  if(query.startsWith("SELECT id,username,password_hash"))return account?.active&&account.username===args[0]?[{...account}]:[];
  if(query.startsWith("UPDATE mm_admin_moderators")){
   if(account?.id!==args[1])return [];
   account.active=args[0];
   return [{id:account.id,username:account.username,active:account.active}];
  }
  return [];
 };
 const created=await createModerator(sql,"team.lead","long-security-password-for-test");
 expect(created).toEqual({id:13,username:"team.lead",active:true});
 expect(account.password_hash).not.toContain("long-security-password-for-test");
 expect(account.password_hash).toContain("argon2id");
 expect(await authenticateModerator(sql,"team.lead","incorrect-long-password")).toBeNull();
 expect(await authenticateModerator(sql,"team.lead","long-security-password-for-test")).toEqual({id:13,username:"team.lead"});
 expect((await updateModeratorStatus(sql,13,false))?.active).toBe(false);
 expect(await authenticateModerator(sql,"team.lead","long-security-password-for-test")).toBeNull();
 expect((await updateModeratorStatus(sql,13,true))?.active).toBe(true);
 expect((await updateModeratorStatus(sql,99,false))).toBeNull();
 expect(queries.some(x=>x.query.includes("RETURNING id,username,active"))).toBe(true);
});
