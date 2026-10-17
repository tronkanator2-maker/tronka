import {test,expect} from "bun:test";
import {feedbackDueDate} from "../feedback.ts";
test("follow-up when there is no exact shoot date",()=>{
  const accepted=new Date("2026-10-17T00:00:00Z");
  expect(feedbackDueDate("",accepted).toISOString()).toBe("2026-10-22T00:00:00.000Z");
});
test("follow-up two days after filming",()=>{
  const accepted=new Date("2026-10-17T00:00:00Z");
  expect(feedbackDueDate("25.10.2026",accepted).toISOString()).toBe("2026-10-27T00:00:00.000Z");
});
