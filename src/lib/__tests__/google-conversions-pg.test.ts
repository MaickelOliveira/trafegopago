import {beforeEach,afterEach,afterAll,describe,expect,it,vi} from "vitest";
const remote=vi.hoisted(()=>({ingest:vi.fn(),status:vi.fn()}));
vi.mock("@/lib/google-conversion-api",async original=>({...await original<typeof import("@/lib/google-conversion-api")>(),ingestGoogleConversion:remote.ingest,googleConversionRequestStatus:remote.status}));
import {databasePool,withDataTransaction,writeDocument} from "../document-store";
import {enqueueLeadGoogleConversion,processGoogleConversionOutbox,googleConversionHistory} from "../google-conversion-outbox";
import {updateLead} from "../leads";
import {conversionClient,conversionLead} from "./google-conversions-fixture";

describe.skipIf(!process.env.CONVERSION_POSTGRES)("conversion outbox in a disposable PostgreSQL database",()=>{
 beforeEach(async()=>{
  const url=new URL(process.env.DATABASE_URL!);
  if(!/^\/nexo_conversion_audit_[0-9]{13}$/.test(url.pathname)||url.searchParams.get("host")!=="/private/tmp/trafego-audit-pg-sock"||!process.env.TEST_POSTGRES)throw Error("Use the owned disposable conversion test database");
  vi.clearAllMocks();vi.stubEnv("TP_BACKGROUND_JOBS_ENABLED","true");
  await databasePool().query("TRUNCATE app_documents,app_records,google_conversion_events");
  await writeDocument("clients.json",{clients:[conversionClient()]});
  await writeDocument("config.json",{manager:{email:"manager@example.invalid",passwordHash:"synthetic"},nexoGoogleClientId:"nexo.apps.googleusercontent.com",nexoGoogleClientSecret:"synthetic-nexo",googleConversionsOAuthClientId:"nexo.apps.googleusercontent.com",googleConversionsRefreshToken:"synthetic-conversion-auth"});
  await writeDocument("funnels.json",[{id:"audit-conversion-funnel",clientId:"audit-conversion-client",name:"Synthetic funnel",columns:[{id:"novo",label:"Novo",color:"#afe507"},{id:"contato",label:"Contato",color:"#afe507"},{id:"ganho",label:"Ganho",color:"#afe507"}]}]);
  remote.ingest.mockResolvedValue({validated:false,requestId:"synthetic-receipt",warnings:false});
  remote.status.mockResolvedValue({requestStatusPerDestination:[{destination:{operatingAccount:{accountId:"1234567890"},productDestinationId:"101"},requestStatus:"SUCCESS",eventsIngestionStatus:{recordCount:"1"}}]});
 });
 afterEach(()=>vi.unstubAllEnvs());afterAll(async()=>{await databasePool().end();});
 const enqueue=()=>withDataTransaction(()=>enqueueLeadGoogleConversion(conversionLead(),conversionLead({status:"novo"})));
 const row=async()=>(await databasePool().query("SELECT * FROM google_conversion_events")).rows[0];
 it("commits only one event for concurrent repeats and re-entry into the stage",async()=>{
  await Promise.all(Array.from({length:20},enqueue));expect((await databasePool().query("SELECT count(*)::int AS count FROM google_conversion_events")).rows[0].count).toBe(1);
 });
 it("records a central lead update and its outbox item in the same transaction",async()=>{
  const lead=conversionLead({status:"novo"});
  await databasePool().query("INSERT INTO app_records(collection,record_key,payload) VALUES('leads.json',$1,$2)",[lead.id,JSON.stringify(lead)]);
  await updateLead(lead.id,{status:"contato"});expect((await row()).status).toBe("pending");expect(remote.ingest).not.toHaveBeenCalled();
 });
 it("rolls back a stage change if its durable event cannot be committed",async()=>{
  const lead=conversionLead({id:"audit-rollback",status:"novo"});
  await databasePool().query("INSERT INTO app_records(collection,record_key,payload) VALUES('leads.json',$1,$2)",[lead.id,JSON.stringify(lead)]);
  await databasePool().query("ALTER TABLE google_conversion_events ADD CONSTRAINT audit_reject CHECK(lead_id<>'audit-rollback')");
  try{await expect(updateLead(lead.id,{status:"contato"})).rejects.toThrow();expect((await databasePool().query("SELECT payload->>'status' AS status FROM app_records WHERE record_key=$1",[lead.id])).rows[0].status).toBe("novo");expect(await row()).toBeUndefined();}
  finally{await databasePool().query("ALTER TABLE google_conversion_events DROP CONSTRAINT audit_reject");}
 });
 it("stores contacts missing a click as skipped without contacting Google",async()=>{
  await withDataTransaction(()=>enqueueLeadGoogleConversion(conversionLead({gclid:null}),conversionLead({status:"novo"})));
  await processGoogleConversionOutbox();expect(await row()).toMatchObject({status:"skipped",reason:"missing_click",gclid:null});expect(remote.ingest).not.toHaveBeenCalled();
 });
 it("retains the same event ID, value and timestamp when retrying an uncertain delivery",async()=>{
  await enqueue();remote.ingest.mockRejectedValueOnce({response:{status:503}});await processGoogleConversionOutbox();
  expect(await row()).toMatchObject({status:"pending",attempts:1,reason:"delivery_unconfirmed"});
  const first=remote.ingest.mock.calls[0][1];await databasePool().query("UPDATE google_conversion_events SET next_attempt_at=now()");await processGoogleConversionOutbox();
  expect(remote.ingest.mock.calls[1][1]).toEqual(first);expect(await row()).toMatchObject({status:"submitted",attempts:2,request_id:"synthetic-receipt"});
 });
 it("waits thirty minutes for diagnostics and removes the click after confirmation",async()=>{
  await enqueue();await processGoogleConversionOutbox();expect((await row()).status).toBe("submitted");expect(remote.status).not.toHaveBeenCalled();
  await processGoogleConversionOutbox();expect(remote.ingest).toHaveBeenCalledTimes(1);expect(remote.status).not.toHaveBeenCalled();
  await databasePool().query("UPDATE google_conversion_events SET next_attempt_at=now(),submitted_at=now()-interval '31 minutes'");await processGoogleConversionOutbox();
  expect(await row()).toMatchObject({status:"succeeded",gclid:null});expect(remote.status).toHaveBeenCalledWith(expect.anything(),"synthetic-receipt");
  expect(JSON.stringify(await googleConversionHistory(conversionClient().id))).not.toContain("synthetic_google_click");
 });
 it("cancels a queued event if its client no longer owns the account",async()=>{
  await enqueue();const client=conversionClient();client.adAccounts=[];await writeDocument("clients.json",{clients:[client]});
  await processGoogleConversionOutbox();expect(await row()).toMatchObject({status:"cancelled",gclid:null});expect(remote.ingest).not.toHaveBeenCalled();
 });
 it("preserves pending events when authorization belongs to another application",async()=>{
  await enqueue();await writeDocument("config.json",{nexoGoogleClientId:"new.apps.googleusercontent.com",nexoGoogleClientSecret:"synthetic",googleConversionsOAuthClientId:"old.apps.googleusercontent.com",googleConversionsRefreshToken:"synthetic"});
  await processGoogleConversionOutbox();expect(await row()).toMatchObject({status:"pending",attempts:0});expect(remote.ingest).not.toHaveBeenCalled();
 });
 it("respects another process holding the outbox lock",async()=>{
  await enqueue();const other=await databasePool().connect();await other.query("SELECT pg_advisory_lock(721461,3)");
  try{await processGoogleConversionOutbox();expect(remote.ingest).not.toHaveBeenCalled();}finally{await other.query("SELECT pg_advisory_unlock(721461,3)");other.release();}
  await processGoogleConversionOutbox();expect(remote.ingest).toHaveBeenCalledTimes(1);
 });
});
