import {test,expect} from "bun:test";
import {assessSource} from "../source-health.ts";
const now=new Date("2026-10-17T12:00:00Z");
const ago=n=>new Date(now.getTime()-n*86400000).toISOString();
test("rejects sources idle for thirty days",()=>{
 expect(assessSource({createdAt:ago(50),lastSeenAt:ago(31),all:100,rejected:0,last30:0,accepted30:0},now).action).toBe("disable");
});
test("trials reject sources whose discarded rate exceeds forty percent",()=>{
 expect(assessSource({createdAt:ago(8),lastSeenAt:ago(1),all:10,rejected:5,last30:10,accepted30:5},now).action).toBe("disable");
 expect(assessSource({createdAt:ago(6),lastSeenAt:ago(1),all:10,rejected:5,last30:10,accepted30:5},now).action).toBe("keep");
});
test("low-quality active sources pause when unique useful share is below ten percent",()=>{
 expect(assessSource({createdAt:ago(50),lastSeenAt:ago(1),all:200,rejected:0,last30:50,accepted30:4},now).action).toBe("disable");
 expect(assessSource({createdAt:ago(50),lastSeenAt:ago(1),all:200,rejected:0,last30:50,accepted30:5},now).action).toBe("keep");
});
