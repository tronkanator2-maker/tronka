import {test,expect} from "bun:test";
import {searchAction,searchMenuFor,setSearchActive} from "../search-state.ts";

test("every rendered menu gets explicit current search state without mutating the shared keyboard",()=>{
 const menu={inline_keyboard:[
  [{text:"Профиль",callback_data:"profile"},{text:"Поиск",callback_data:"pause"}],
  [{text:"Другой пункт",callback_data:"jobs"}]
 ]};
 const old=JSON.stringify(menu);
 const enabled=searchMenuFor(menu,{active:true});
 const disabled=searchMenuFor(menu,{active:false});
 expect(searchAction({active:true})).toBe("search:stop");
 expect(searchAction({active:false})).toBe("search:resume");
 expect(enabled.inline_keyboard[0][1]).toEqual({text:"⏸️ Остановить поиск",callback_data:"search:stop"});
 expect(disabled.inline_keyboard[0][1]).toEqual({text:"▶️ Возобновить поиск",callback_data:"search:resume"});
 expect(disabled.inline_keyboard[0][0].callback_data).toBe("profile");
 expect(JSON.stringify(menu)).toBe(old);
});
test("activating search atomically queues its profile refresh in the same database statement",async()=>{
 const calls=[];
 const sql=async(query,...args)=>{calls.push({query,args});return [{id:55,active:true}]};
 expect(await setSearchActive(sql,55,true)).toEqual({status:"changed",active:true});
 expect(calls).toHaveLength(1);
 expect(calls[0].args).toEqual([55,true]);
 expect(calls[0].query).toContain("UPDATE mm_users SET active=$2");
 expect(calls[0].query).toContain("active IS DISTINCT FROM $2");
 expect(calls[0].query).toContain("INSERT INTO mm_profile_refresh_queue(user_id)");
 expect(calls[0].query).toContain("SELECT id FROM changed WHERE active=TRUE");
 expect(calls[0].query).toContain("generation=mm_profile_refresh_queue.generation+1");
});
test("rapid repeated stop or resume presses cannot reverse the search setting",async()=>{
 let active=true,queues=0;
 const sql=async(query,...args)=>{
  if(query.includes("WITH changed AS")){
   if(active===args[1])return [];
   active=args[1];
   if(active)queues++;
   return [{id:16,active}];
  }
  return [{id:16,active}];
 };
 expect(await setSearchActive(sql,16,false)).toEqual({status:"changed",active:false});
 expect(await setSearchActive(sql,16,false)).toEqual({status:"already",active:false});
 expect(active).toBe(false);
 expect(await setSearchActive(sql,16,true)).toEqual({status:"changed",active:true});
 expect(await setSearchActive(sql,16,true)).toEqual({status:"already",active:true});
 expect(active).toBe(true);
 expect(queues).toBe(1);
});
test("closed accounts have no effect and invalid IDs never access the DB",async()=>{
 let calls=0;
 const sql=async()=>{calls++;return []};
 expect(await setSearchActive(sql,7,false)).toEqual({status:"missing"});
 expect(calls).toBe(2);
 for(const [id,active] of [[0,true],[-1,false],[7,"yes"],[7,null],[Infinity,true],[Number.MAX_SAFE_INTEGER+1,false]]){
  expect(await setSearchActive(sql,id,active)).toEqual({status:"invalid"});
 }
 expect(calls).toBe(2);
});
test("legacy pause button is left for an explicit choice rather than being turned into a toggle",()=>{
 const keyboard={inline_keyboard:[[{text:"Toggle",callback_data:"pause"}]]};
 expect(searchMenuFor(keyboard,{active:false}).inline_keyboard[0][0].callback_data).toBe("search:resume");
 expect(searchMenuFor(keyboard,{active:true}).inline_keyboard[0][0].callback_data).toBe("search:stop");
});
