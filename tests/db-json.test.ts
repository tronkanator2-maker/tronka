import {test,expect} from "bun:test";
import {decodeDbRows} from "../db-json.ts";

test("PostgreSQL JSONB strings become usable profile, filter and queue objects",()=>{
 const rows=decodeDbRows([{id:"1",profile:'{"имя":"Анна"}',filters:'{"wizardStep":2}',photos:'["photo-id"]',payload:'{"update_id":123,"message":{"text":"/start"}}'}]);
 expect(rows[0].profile).toEqual({"имя":"Анна"});
 expect(rows[0].filters).toEqual({wizardStep:2});
 expect(rows[0].photos).toEqual(["photo-id"]);
 expect(rows[0].payload.update_id).toBe(123);
});

test("text bodies stay text while JSONB job bodies are decoded",()=>{
 expect(decodeDbRows([{body:'{"message":"plain text"}'}],"SELECT * FROM mm_reports_v2")[0].body).toBe('{"message":"plain text"}');
 expect(decodeDbRows([{body:'{"город":"Москва"}'}],"SELECT * FROM mm_jobs")[0].body).toEqual({"город":"Москва"});
});
