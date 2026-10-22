import {test,expect} from "bun:test";
import {SQL} from "bun";
import {setJobVisibility} from "../job-visibility.ts";
import {setSearchActive} from "../search-state.ts";
import {acceptResponseForOwner,prepareAcceptedResponseOutbox} from "../response-acceptance.ts";
import {acceptInvitationForRecipient,prepareAcceptedInvitationOutbox} from "../invite-acceptance.ts";
import {relayAuthorized} from "../relay.ts";
import {prepareDecisionNotifications,updateCollaborationDecision,deliverDecisionNotifications} from "../decision-notifications.ts";
import {createResponseWithQuota,createInvitationWithQuota,publishJobWithQuota} from "../quota-actions.ts";
import {prepareInvitationOutbox} from "../invitation-delivery.ts";

// This suite runs ONLY against the disposable PostgreSQL 16 service in CI.
// It must never use DATABASE_URL or connect to Railway/production.
const testUrl=process.env.PGTEST_DATABASE_URL;
if(!testUrl||!testUrl.includes("127.0.0.1"))throw Error("Disposable local PGTEST_DATABASE_URL required");
const client=new SQL(testUrl);
const sql=(query,...args)=>client.unsafe(query,args);

test("real PostgreSQL: idempotent visibility, permissioned acceptance and relay",async()=>{
 try{
  await sql("CREATE TABLE mm_users(id BIGINT PRIMARY KEY,active BOOLEAN NOT NULL DEFAULT TRUE,blocked BOOLEAN NOT NULL DEFAULT FALSE,suspended BOOLEAN NOT NULL DEFAULT FALSE)");
  await sql("CREATE TABLE mm_jobs(id BIGSERIAL PRIMARY KEY,owner BIGINT NOT NULL,status TEXT NOT NULL DEFAULT 'active',paused BOOLEAN NOT NULL DEFAULT FALSE,expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '7 days',body JSONB NOT NULL DEFAULT '{}'::jsonb,draft_token TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(owner,draft_token))");
  await sql("CREATE TABLE mm_fanout_queue(job_id BIGINT PRIMARY KEY,pending BOOLEAN NOT NULL DEFAULT TRUE,cursor_id BIGINT NOT NULL DEFAULT 0,profile_cursor_id BIGINT NOT NULL DEFAULT 0,generation BIGINT NOT NULL DEFAULT 1,profiles_done BOOLEAN NOT NULL DEFAULT FALSE,attempts INTEGER NOT NULL DEFAULT 0,completed_at TIMESTAMPTZ,next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await sql("CREATE TABLE mm_profile_refresh_queue(user_id BIGINT PRIMARY KEY,phase TEXT NOT NULL DEFAULT 'matches',cursor_job_id BIGINT NOT NULL DEFAULT 0,generation BIGINT NOT NULL DEFAULT 1,attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),completed_at TIMESTAMPTZ,pending BOOLEAN NOT NULL DEFAULT TRUE)");
  await sql("CREATE TABLE mm_responses(id BIGSERIAL PRIMARY KEY,job_id BIGINT NOT NULL REFERENCES mm_jobs(id),user_id BIGINT NOT NULL REFERENCES mm_users(id),status TEXT NOT NULL DEFAULT 'pending',accepted_at TIMESTAMPTZ,message TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(job_id,user_id))");
  await sql("CREATE TABLE mm_invitations(id BIGSERIAL PRIMARY KEY,from_user BIGINT NOT NULL REFERENCES mm_users(id),to_user BIGINT NOT NULL REFERENCES mm_users(id),status TEXT NOT NULL DEFAULT 'sent',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await sql("CREATE TABLE mm_response_outbox(response_id BIGINT PRIMARY KEY, step INTEGER NOT NULL DEFAULT 0)");
  await prepareInvitationOutbox(sql);
  await prepareAcceptedResponseOutbox(sql);
  await prepareAcceptedInvitationOutbox(sql);
  await prepareDecisionNotifications(sql);

  await sql("INSERT INTO mm_users(id) VALUES(101),(102),(103)");
  await sql("INSERT INTO mm_jobs(id,owner) VALUES(201,101)");
  await sql("INSERT INTO mm_responses(id,job_id,user_id) VALUES(501,201,102),(502,201,102),(503,201,102)");
  await sql("INSERT INTO mm_invitations(id,from_user,to_user) VALUES(601,101,103),(602,101,102),(603,101,103),(604,101,103)");

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
  expect(String(accepted.id)).toBe("501");
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

  // Decisions and their notifications use the same production SQL as the
  // Telegram callbacks, not mocks. They must enforce ownership and preserve
  // the opposite participant's private contact details.
  expect(await updateCollaborationDecision(sql,"response_declined",503,103)).toBeNull();
  const declined=await updateCollaborationDecision(sql,"response_declined",503,101);
  expect(declined.newlyChanged).toBe(true);
  expect(String(declined.recipientId)).toBe("102");
  expect((await sql("SELECT status FROM mm_responses WHERE id=503"))[0].status).toBe("declined");

  const cancelled=await updateCollaborationDecision(sql,"invitation_cancelled",603,101);
  expect(cancelled.newlyChanged).toBe(true);
  const rejected=await updateCollaborationDecision(sql,"invitation_declined",604,103);
  expect(rejected.newlyChanged).toBe(true);
  expect(await updateCollaborationDecision(sql,"invitation_cancelled",601,101)).toBeNull();
  expect((await sql("SELECT COUNT(*)::int AS n FROM mm_decision_notifications"))[0].n).toBe(3);

  const statusNotices=[];
  const notices=await deliverDecisionNotifications(sql,async(id,body)=>{
   statusNotices.push({recipient:String(id),body});
   return {ok:true};
  });
  expect(notices).toEqual({processed:3,completed:3,failed:0});
  expect(statusNotices).toHaveLength(3);
  expect(statusNotices.find(x=>x.body.includes("отклонён")).recipient).toBeDefined();
  expect((await sql("SELECT COUNT(*)::int AS n FROM mm_decision_notifications WHERE completed_at IS NULL"))[0].n).toBe(0);


  // Deliberately run conflicting operations on distinct PostgreSQL
  // connections. Both callbacks may see the same user state initially, but
  // only one free action may be committed by the per-user advisory lock.
  await sql("INSERT INTO mm_users(id) VALUES(1100),(1200),(1201),(1202),(1300)");
  await sql("INSERT INTO mm_jobs(id,owner) VALUES(1101,1200),(1102,1201),(1103,1202)");
  const monday=new Date("2026-10-19T00:00:00+03:00");
  const responseRace=await Promise.all([
   createResponseWithQuota(client,{userId:1100,jobId:1101,message:"Отклик 1",paid:false,weekStart:monday}),
   createResponseWithQuota(client,{userId:1100,jobId:1102,message:"Отклик 2",paid:false,weekStart:monday})
  ]);
  expect(responseRace.map(x=>x.status).sort()).toEqual(["created","limit"]);
  expect((await sql("SELECT COUNT(*)::int n FROM mm_responses WHERE user_id=1100"))[0].n).toBe(1);
  expect((await sql("SELECT COUNT(*)::int n FROM mm_response_outbox o JOIN mm_responses r ON r.id=o.response_id WHERE r.user_id=1100"))[0].n).toBe(1);
  const createdResponse=responseRace.find(x=>x.status==="created");
  const firstJob=String(createdResponse.listing.id);
  const repeat=await createResponseWithQuota(client,{userId:1100,jobId:Number(firstJob),message:"Попробовать снова",paid:false,weekStart:monday});
  expect(repeat.status).toBe("duplicate");

  const inviteRace=await Promise.all([
   createInvitationWithQuota(client,{fromUser:1300,toUser:1200,paid:false,weekStart:monday}),
   createInvitationWithQuota(client,{fromUser:1300,toUser:1201,paid:false,weekStart:monday})
  ]);
  expect(inviteRace.map(x=>x.status).sort()).toEqual(["created","limit"]);
  expect((await sql("SELECT COUNT(*)::int n FROM mm_invitations WHERE from_user=1300"))[0].n).toBe(1);
  expect((await sql("SELECT COUNT(*)::int n FROM mm_invitation_outbox o JOIN mm_invitations i ON i.id=o.invitation_id WHERE i.from_user=1300"))[0].n).toBe(1);
  const newInvite=inviteRace.find(x=>x.status==="created");
  const newInviteTarget=(await sql("SELECT to_user FROM mm_invitations WHERE id=$1",newInvite.invitationId))[0].to_user;
  expect((await createInvitationWithQuota(client,{fromUser:1300,toUser:Number(newInviteTarget),paid:false,weekStart:monday})).status).toBe("duplicate");

  // Latest owner-approved spec: one ACTIVE free job with no weekly posting
  // restriction; a paused/closed job does not consume the slot.
  const freeOwner=1200;
  await sql("UPDATE mm_jobs SET paused=TRUE WHERE id=1101");
  const publishArgs={ownerId:freeOwner,body:{title:"Первая"},expiresAt:new Date(Date.now()+86400000),paid:false};
  const jobRace=await Promise.all([
   publishJobWithQuota(client,{...publishArgs,draftToken:"free-job-a"}),
   publishJobWithQuota(client,{...publishArgs,draftToken:"free-job-b",body:{title:"Вторая"}})
  ]);
  expect(jobRace.map(x=>x.status).sort()).toEqual(["created","limit"]);
  const activePublished=jobRace.find(x=>x.status==="created");
  expect((await publishJobWithQuota(client,{...publishArgs,draftToken:activePublished.listing.draft_token})).status).toBe("duplicate");
  await sql("UPDATE mm_jobs SET paused=TRUE WHERE id=$1",activePublished.jobId);
  const newPublished=await publishJobWithQuota(client,{...publishArgs,draftToken:"free-job-c",body:{title:"Замена"}});
  expect(newPublished.status).toBe("created");
  expect((await sql("SELECT COUNT(*)::int n FROM mm_jobs WHERE id=$1 AND paused=FALSE",newPublished.jobId))[0].n).toBe(1);
  expect((await sql("SELECT COUNT(*)::int n FROM mm_fanout_queue WHERE job_id IN ($1,$2)",activePublished.jobId,newPublished.jobId))[0].n).toBe(2);

  // Insufficient access must not reserve a quota or emit a notification.
  await sql("UPDATE mm_users SET blocked=TRUE WHERE id=1202");
  expect((await createInvitationWithQuota(client,{fromUser:1100,toUser:1202,paid:false,weekStart:monday})).status).toBe("unavailable");
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
