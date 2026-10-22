import {test,expect} from "bun:test";
import {SQL} from "bun";
import {setJobVisibility} from "../job-visibility.ts";
import {setSearchActive} from "../search-state.ts";
import {acceptResponseForOwner,prepareAcceptedResponseOutbox} from "../response-acceptance.ts";
import {acceptInvitationForRecipient,prepareAcceptedInvitationOutbox} from "../invite-acceptance.ts";
import {relayAuthorized} from "../relay.ts";

// This suite runs ONLY against the disposable PostgreSQL 16 service in CI.
// It must never use DATABASE_URL or connect to Railway/production.
const testUrl=process.env.PGTEST_DATABASE_URL;
if(!testUrl||!testUrl.includes("127.0.0.1"))throw Error("Disposable local PGTEST_DATABASE_URL required");
const client=new SQL(testUrl);
const sql=(query,...args)=>client.unsafe(query,args);

test("real PostgreSQL: idempotent visibility, permissioned acceptance and relay",async()=>{
 try{
  await sql("CREATE TABLE mm_users(id BIGINT PRIMARY KEY,active BOOLEAN NOT NULL DEFAULT TRUE,blocked BOOLEAN NOT NULL DEFAULT FALSE,suspended BOOLEAN NOT NULL DEFAULT FALSE)");
  await sql("CREATE TABLE mm_jobs(id BIGINT PRIMARY KEY,owner BIGINT NOT NULL,status TEXT NOT NULL DEFAULT 'active',paused BOOLEAN NOT NULL DEFAULT FALSE,expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '7 days')");
  await sql("CREATE TABLE mm_fanout_queue(job_id BIGINT PRIMARY KEY,pending BOOLEAN NOT NULL DEFAULT TRUE,cursor_id BIGINT NOT NULL DEFAULT 0,profile_cursor_id BIGINT NOT NULL DEFAULT 0,generation BIGINT NOT NULL DEFAULT 1,profiles_done BOOLEAN NOT NULL DEFAULT FALSE,attempts INTEGER NOT NULL DEFAULT 0,completed_at TIMESTAMPTZ,next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await sql("CREATE TABLE mm_profile_refresh_queue(user_id BIGINT PRIMARY KEY,phase TEXT NOT NULL DEFAULT 'matches',cursor_job_id BIGINT NOT NULL DEFAULT 0,generation BIGINT NOT NULL DEFAULT 1,attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),completed_at TIMESTAMPTZ,pending BOOLEAN NOT NULL DEFAULT TRUE)");
  await sql("CREATE TABLE mm_responses(id BIGINT PRIMARY KEY,job_id BIGINT NOT NULL REFERENCES mm_jobs(id),user_id BIGINT NOT NULL REFERENCES mm_users(id),status TEXT NOT NULL DEFAULT 'pending',accepted_at TIMESTAMPTZ)");
  await sql("CREATE TABLE mm_invitations(id BIGINT PRIMARY KEY,from_user BIGINT NOT NULL REFERENCES mm_users(id),to_user BIGINT NOT NULL REFERENCES mm_users(id),status TEXT NOT NULL DEFAULT 'sent')");
  await prepareAcceptedResponseOutbox(sql);
  await prepareAcceptedInvitationOutbox(sql);

  await sql("INSERT INTO mm_users(id) VALUES(101),(102),(103)");
  await sql("INSERT INTO mm_jobs(id,owner) VALUES(201,101)");
  await sql("INSERT INTO mm_responses(id,job_id,user_id) VALUES(501,201,102),(502,201,102),(503,201,102)");
  await sql("INSERT INTO mm_invitations(id,from_user,to_user) VALUES(601,101,103),(602,101,102)");

  expect((await setJobVisibility(sql,101,{id:201,paused:true})).status).toBe("changed");
  expect((await setJobVisibility(sql,101,{id:201,paused:true})).status).toBe("already");
  expect((await setJobVisibility(sql,101,{id:201,paused:false})).status).toBe("changed");
  expect((await setJobVisibility(sql,101,{id:201,paused:false})).status).toBe("already");
  let queue=await sql("SELECT generation,pending FROM mm_fanout_queue WHERE job_id=201");
  expect(queue.length).toBe(1);
  expect(Number(queue[0].generation)).toBe(1);
  expect(queue[0].pending).toBe(true);

  expect((await setSearchActive(sql,101,false)).status).toBe("changed");
  expect((await setSearchActive(sql,101,false)).status).toBe("already");
  expect((await setSearchActive(sql,101,true)).status).toBe("changed");
  expect((await setSearchActive(sql,101,true)).status).toBe("already");
  const refreshed=await sql("SELECT generation,pending FROM mm_profile_refresh_queue WHERE user_id=101");
  expect(Number(refreshed[0].generation)).toBe(1);
  expect(refreshed[0].pending).toBe(true);

  const accepted=await acceptResponseForOwner(sql,501,101);
  expect(accepted.id).toBe(501);
  expect(accepted.newlyAccepted).toBe(true);
  expect((await sql("SELECT status FROM mm_responses WHERE id=501"))[0].status).toBe("accepted");
  expect((await sql("SELECT COUNT(*)::int AS n FROM mm_accepted_response_outbox WHERE response_id=501"))[0].n).toBe(1);
  expect(await relayAuthorized(sql,101,102)).toBe(true);
  expect(await acceptResponseForOwner(sql,502,103)).toBeNull();

  await sql("UPDATE mm_jobs SET status='closed' WHERE id=201");
  expect(await acceptResponseForOwner(sql,502,101)).toBeNull();
  await sql("UPDATE mm_jobs SET status='active',paused=TRUE WHERE id=201");
  expect(await acceptResponseForOwner(sql,502,101)).toBeNull();
  await sql("UPDATE mm_jobs SET paused=FALSE WHERE id=201");

  const invitation=await acceptInvitationForRecipient(sql,601,103);
  expect(invitation.newlyAccepted).toBe(true);
  expect((await sql("SELECT status FROM mm_invitations WHERE id=601"))[0].status).toBe("accepted");
  expect(await relayAuthorized(sql,101,103)).toBe(true);

  await sql("UPDATE mm_users SET blocked=TRUE WHERE id=102");
  expect(await relayAuthorized(sql,101,102)).toBe(false);
  expect(await acceptResponseForOwner(sql,502,101)).toBeNull();
  expect(await acceptResponseForOwner(sql,501,101)).toBeNull();
  expect(await acceptInvitationForRecipient(sql,602,102)).toBeNull();

  await sql("UPDATE mm_users SET suspended=TRUE WHERE id=103");
  expect(await relayAuthorized(sql,101,103)).toBe(false);
  expect(await acceptInvitationForRecipient(sql,601,103)).toBeNull();
 }finally{
  await client.close();
 }
});
