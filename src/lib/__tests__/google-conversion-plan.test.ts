import { expect, it } from "vitest";
import { enums } from "google-ads-api";
import { planGoogleConversion } from "../google-conversion-plan";
import { conversionPayload, conversionDiagnostic, conversionError } from "../google-conversion-api";
import { ownedGoogleConversionAccount, validateGoogleConversionSettings } from "../google-conversion-settings";
import { conversionClient, conversionLead, conversionSettings } from "./google-conversions-fixture";
const previous = () => conversionLead({status:"novo"});
const event = () => planGoogleConversion(conversionClient(),conversionLead(),previous())!;

it("records qualification with zero value and a stable event ID",()=>{
 const first=event();expect(first).toMatchObject({kind:"qualified",actionId:"101",value:0,skipReason:null});
 expect(planGoogleConversion(conversionClient(),conversionLead({updatedAt:"2026-11-05T00:00:00Z"}),previous())?.id).toBe(first.id);
 expect(first.id).toMatch(/^[a-f0-9]{64}$/);
});
it("records a distinct sale using the actual value at the stage transition",()=>{
 const sale=planGoogleConversion(conversionClient(),conversionLead({status:"ganho"}),previous())!;
 expect(sale).toMatchObject({kind:"sale",actionId:"102",value:149.9});expect(sale.id).not.toBe(event().id);
});
it("does not turn an edit in the same stage into another conversion",()=>expect(planGoogleConversion(conversionClient(),conversionLead({value:500}),conversionLead())).toBeNull());
it("keeps contacts from another client out of the configured destination",()=>expect(planGoogleConversion(conversionClient(),conversionLead({clientId:"other"}),previous())).toBeNull());
it("keeps another funnel out of the configured destination",()=>expect(planGoogleConversion(conversionClient(),conversionLead({funnelId:"other"}),previous())).toBeNull());
it("does not use a Google account removed from the client",()=>{const client=conversionClient();client.adAccounts=[];expect(planGoogleConversion(client,conversionLead(),previous())).toBeNull();});
it("does not emit before configuration is enabled",()=>{const client=conversionClient();client.googleConversions!.enabled=false;expect(planGoogleConversion(client,conversionLead(),previous())).toBeNull();});
it("does not backfill a stage timestamp before the activation",()=>expect(planGoogleConversion(conversionClient(),conversionLead({updatedAt:"2026-10-31T23:59:00Z"}),previous())).toBeNull());
it("ignores stages without a conversion mapping",()=>expect(planGoogleConversion(conversionClient(),conversionLead({status:"proposta"}),previous())).toBeNull());
it("records a missing click as skipped rather than uploading contact details",()=>{
 const planned=planGoogleConversion(conversionClient(),conversionLead({gclid:null}),previous())!;
 expect(planned).toMatchObject({skipReason:"missing_click",gclid:null});expect(JSON.stringify(planned)).not.toContain("contact@example.invalid");expect(JSON.stringify(planned)).not.toContain("00000000000");
});
it.each(["invalid click","\nsynthetic_click","<script>","a".repeat(2049)])("rejects malformed click IDs: %s",gclid=>expect(planGoogleConversion(conversionClient(),conversionLead({gclid}),previous())).toMatchObject({skipReason:"invalid_click",gclid:null}));
it("does not send a contact explicitly attributed to Meta",()=>expect(planGoogleConversion(conversionClient(),conversionLead({adPlatform:"meta"}),previous())).toMatchObject({skipReason:"other_source",gclid:null}));
it("preserves an honest zero when no sale value was captured",()=>expect(planGoogleConversion(conversionClient(),conversionLead({status:"ganho",value:null}),previous())?.value).toBe(0));
it("sends only the click and conversion facts with the real timestamp and BRL",()=>{
 const payload=conversionPayload(event(),"222-333-4444");
 expect(payload).toMatchObject({validateOnly:false,destinations:[{operatingAccount:{accountType:"GOOGLE_ADS",accountId:"1234567890"},loginAccount:{accountType:"GOOGLE_ADS",accountId:"2223334444"},productDestinationId:"101"}],events:[{adIdentifiers:{gclid:"synthetic_google_click"},eventTimestamp:"2026-11-04T10:00:00.000Z",eventSource:"OTHER",transactionId:event().id,currency:"BRL"}]});
 expect(JSON.stringify(payload)).not.toMatch(/contact@example|00000000000|private notes|userData|consent|clientIp/);
});
it("supports validation without executing an upload",()=>expect(conversionPayload(event(),undefined,true).validateOnly).toBe(true));
it("refuses to build a submission for an ineligible event",()=>expect(()=>conversionPayload({...event(),gclid:null,skipReason:"missing_click"})).toThrow());
const diagnostic=(status:string,count="1")=>({requestStatusPerDestination:[{destination:{operatingAccount:{accountId:"1234567890"},productDestinationId:"101"},requestStatus:status,eventsIngestionStatus:{recordCount:count}}]});
it("waits for processing instead of treating a receipt as success",()=>expect(conversionDiagnostic(diagnostic("PENDING"),event()).status).toBe("submitted"));
it("requires a successful matching destination and record count",()=>{
 expect(conversionDiagnostic(diagnostic("SUCCESS"),event()).status).toBe("succeeded");
 expect(conversionDiagnostic(diagnostic("SUCCESS","0"),event()).status).toBe("failed");
 expect(conversionDiagnostic(diagnostic("SUCCESS"),{...event(),actionId:"999"}).status).toBe("submitted");
});
it("does not hide processing failures or warnings",()=>{
 expect(conversionDiagnostic(diagnostic("PARTIAL_SUCCESS"),event())).toMatchObject({status:"failed",reason:"google_processing_failed"});
 const data=diagnostic("SUCCESS");Object.assign(data.requestStatusPerDestination[0],{warningInfo:{warningCounts:[{reason:"synthetic_warning"}]}});
 expect(conversionDiagnostic(data,event())).toMatchObject({status:"succeeded",warnings:true});
});
it("classifies retries without exposing request credentials or provider payloads",()=>{
 const error={response:{status:403},request:{client_secret:"synthetic-secret",gclid:"synthetic-private-click"}};
 expect(conversionError(error)).toEqual({reason:"google_connection",retry:true});
 expect(conversionError({response:{status:400}})).toEqual({reason:"google_rejected",retry:false});
 expect(conversionError(Error("synthetic-secret"))).toEqual({reason:"delivery_unconfirmed",retry:true});
});

const inspection=()=>({conversionCustomerId:"1234567890",termsAccepted:true,actions:[{id:"101",name:"Synthetic qualified",type:enums.ConversionActionType.UPLOAD_CLICKS,category:enums.ConversionActionCategory.QUALIFIED_LEAD,status:enums.ConversionActionStatus.ENABLED,primary:false},{id:"102",name:"Synthetic sale",type:enums.ConversionActionType.UPLOAD_CLICKS,category:enums.ConversionActionCategory.PURCHASE,status:enums.ConversionActionStatus.ENABLED,primary:false}]});
const funnels=()=>[{id:"audit-conversion-funnel",name:"Synthetic funnel",clientId:"audit-conversion-client",columns:[{id:"contato",label:"Contato",color:"#afe507"},{id:"ganho",label:"Ganho",color:"#afe507"}]}];
it("accepts only an owned Google account",()=>{
 expect(ownedGoogleConversionAccount(conversionClient(),"123-456-7890")).toBe("1234567890");
 expect(()=>ownedGoogleConversionAccount(conversionClient(),"9999999999")).toThrow();
 expect(()=>ownedGoogleConversionAccount(conversionClient(),"https://example.invalid/1234567890")).toThrow();
});
it("validates ownership, distinct stages and action categories",()=>{
 const client=conversionClient(),body={...conversionSettings()};
 expect(validateGoogleConversionSettings(client,body,funnels(),inspection()).enabled).toBe(true);
 expect(()=>validateGoogleConversionSettings(client,{...body,funnelId:"foreign"},funnels(),inspection())).toThrow();
 expect(()=>validateGoogleConversionSettings(client,{...body,saleColumnId:"contato"},funnels(),inspection())).toThrow();
 expect(()=>validateGoogleConversionSettings(client,{...body,saleActionId:"101"},funnels(),inspection())).toThrow();
});
it("uses the conversion owner confirmed by Google instead of a submitted owner",()=>expect(validateGoogleConversionSettings(conversionClient(),{...conversionSettings(),conversionCustomerId:"9999999999"},funnels(),inspection()).conversionCustomerId).toBe("1234567890"));
it("preserves activation time on an identical save",()=>expect(validateGoogleConversionSettings(conversionClient(),conversionSettings(),funnels(),inspection()).enabledAt).toBe(conversionSettings().enabledAt));
it("requires customer data terms already accepted on the Google account",()=>expect(()=>validateGoogleConversionSettings(conversionClient(),conversionSettings(),funnels(),{...inspection(),termsAccepted:false})).toThrow());
