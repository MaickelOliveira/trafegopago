import { beforeEach,expect,it,vi } from "vitest";
import { enums } from "google-ads-api";
const mocks=vi.hoisted(()=>({query:vi.fn(),create:vi.fn(),ingest:vi.fn(),retrieve:vi.fn(),credentials:vi.fn()}));
vi.mock("@/lib/google-ads-customer",()=>({createGoogleAdsCustomer:()=>({query:mocks.query,conversionActions:{create:mocks.create}})}));
vi.mock("googleapis/build/src/apis/datamanager/index.js",()=>({datamanager:()=>({events:{ingest:mocks.ingest},requestStatus:{retrieve:mocks.retrieve}})}));
vi.mock("@/lib/google-nexo-auth",async original=>({...await original<typeof import("@/lib/google-nexo-auth")>(),createNexoGoogleOAuthClient:()=>({setCredentials:mocks.credentials})}));
import {prepareGoogleConversionActions,CONVERSION_ACTION_NAMES,ingestGoogleConversion} from "../google-conversion-api";
import {planGoogleConversion} from "../google-conversion-plan";
import {conversionClient,conversionLead} from "./google-conversions-fixture";
const creds={clientId:"nexo.apps.googleusercontent.com",clientSecret:"synthetic-secret",refreshToken:"synthetic-ads"};
const config={manager:{email:"manager@example.invalid",passwordHash:"synthetic"},metaToken:"",nexoGoogleClientId:creds.clientId,nexoGoogleClientSecret:creds.clientSecret,googleConversionsOAuthClientId:creds.clientId,googleConversionsRefreshToken:"synthetic-conversions",googleAdsRefreshToken:"synthetic-untouched-ads"};
beforeEach(()=>{vi.clearAllMocks();mocks.query.mockResolvedValueOnce([{customer:{conversion_tracking_setting:{google_ads_conversion_customer:"customers/1234567890",accepted_customer_data_terms:true}}}]);mocks.create.mockResolvedValue({results:[{resource_name:"customers/1234567890/conversionActions/101"}]});});
it("creates only missing dedicated secondary actions and leaves the existing website action intact",async()=>{
 mocks.query.mockResolvedValueOnce([{conversion_action:{id:999,name:"Synthetic website form",type:8,category:13,status:2,primary_for_goal:true}},{conversion_action:{id:101,name:CONVERSION_ACTION_NAMES.qualified,type:enums.ConversionActionType.UPLOAD_CLICKS,category:enums.ConversionActionCategory.QUALIFIED_LEAD,status:enums.ConversionActionStatus.ENABLED}}]);
 mocks.create.mockResolvedValueOnce({results:[{resource_name:"customers/1234567890/conversionActions/102"}]});
 expect(await prepareGoogleConversionActions(creds,"1234567890")).toMatchObject({qualifiedActionId:"101",saleActionId:"102"});
 expect(mocks.create).toHaveBeenCalledTimes(1);expect(mocks.create).toHaveBeenCalledWith([expect.objectContaining({name:CONVERSION_ACTION_NAMES.sale,primary_for_goal:false,type:enums.ConversionActionType.UPLOAD_CLICKS})]);
});
it("refuses to reuse a conflicting action with the same name",async()=>{
 mocks.query.mockResolvedValueOnce([{conversion_action:{id:101,name:CONVERSION_ACTION_NAMES.qualified,type:8,category:13,status:2}}]);
 await expect(prepareGoogleConversionActions(creds,"1234567890")).rejects.toThrow();expect(mocks.create).not.toHaveBeenCalled();
});
it("validates without treating validation as an uploaded conversion",async()=>{
 mocks.ingest.mockResolvedValueOnce({data:{fieldWarnings:[{}]}});
 const event=planGoogleConversion(conversionClient(),conversionLead(),conversionLead({status:"novo"}))!;
 expect(await ingestGoogleConversion(config,event,true)).toEqual({validated:true,requestId:null,warnings:true});
 expect(mocks.credentials).toHaveBeenCalledWith({refresh_token:"synthetic-conversions"});
 expect(mocks.ingest.mock.calls[0][0].requestBody.validateOnly).toBe(true);expect(mocks.retrieve).not.toHaveBeenCalled();
});
it("keeps the receipt and field warnings without returning provider data",async()=>{
 mocks.ingest.mockResolvedValueOnce({data:{requestId:"synthetic-receipt",fieldWarnings:[{detail:"synthetic-provider-data"}]}});
 const event=planGoogleConversion(conversionClient(),conversionLead(),conversionLead({status:"novo"}))!;
 expect(await ingestGoogleConversion(config,event)).toEqual({validated:false,requestId:"synthetic-receipt",warnings:true});
 expect(mocks.ingest.mock.calls[0][1]).toMatchObject({timeout:15000,retry:false});
});
