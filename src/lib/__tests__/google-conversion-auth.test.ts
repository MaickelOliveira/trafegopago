import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks=vi.hoisted(()=>({config:{manager:{email:"manager@example.invalid",passwordHash:"synthetic"},metaToken:"",appBaseUrl:"https://platform.example.invalid",nexoGoogleClientId:"nexo.apps.googleusercontent.com",nexoGoogleClientSecret:"synthetic-nexo-secret",googleClientId:"legacy-calendar.apps.googleusercontent.com",googleAdsRefreshToken:"synthetic-existing-ads",googleAdsOAuthClientId:"nexo.apps.googleusercontent.com",backupGoogleRefreshToken:"synthetic-existing-backup",googleConversionsRefreshToken:"synthetic-old-conversions",googleConversionsOAuthClientId:"nexo.apps.googleusercontent.com"},consume:vi.fn(),create:vi.fn(),token:vi.fn(),save:vi.fn(),generate:vi.fn()}));
vi.mock("@/lib/clients",()=>({getConfig:async()=>({...mocks.config}),getClientById:async(id:string)=>id==="audit-client"?{id}:null,saveConfig:mocks.save}));
vi.mock("@/lib/oauth-state",()=>({createOAuthState:mocks.create,consumeOAuthState:mocks.consume}));
vi.mock("@/lib/document-store",()=>({withDataTransaction:async(operation:()=>Promise<void>)=>operation()}));
vi.mock("@/lib/google-nexo-auth",async original=>({...await original<typeof import("@/lib/google-nexo-auth")>(),createNexoGoogleOAuthClient:()=>({getToken:mocks.token,generateAuthUrl:mocks.generate})}));
import { completeGoogleConversionAuthorization,googleConversionAuthUrl,hasGoogleConversionAuthorization,DATA_MANAGER_SCOPE } from "../google-conversion-auth";
import { safePlatformConfig,platformConfigPatch } from "../platform-settings";
beforeEach(()=>{vi.clearAllMocks();mocks.config.nexoGoogleClientSecret="synthetic-nexo-secret";mocks.consume.mockResolvedValue({clientId:"audit-client"});mocks.create.mockResolvedValue("synthetic-signed-state");mocks.generate.mockReturnValue("https://accounts.google.com/synthetic");mocks.token.mockResolvedValue({tokens:{refresh_token:"synthetic-new-conversions",scope:DATA_MANAGER_SCOPE}});});
const request=(suffix="&code=synthetic-code")=>new NextRequest("https://internal.example.invalid/api/agent/google-ads-auth/callback?state=conversions.synthetic-state"+suffix);
it("requests only the conversion scope using a separate provider-bound state",async()=>{
 await googleConversionAuthUrl("audit-client","https://platform.example.invalid");
 expect(mocks.create).toHaveBeenCalledWith("google-conversions",{clientId:"audit-client"});
 expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({scope:[DATA_MANAGER_SCOPE],state:"conversions.synthetic-signed-state",access_type:"offline"}));
});
it("rejects invalid state without exchanging or replacing credentials",async()=>{
 mocks.consume.mockRejectedValueOnce(Error("expired"));
 const response=await completeGoogleConversionAuthorization(request());
 expect(response.headers.get("location")).toContain("googleConversions=error");expect(mocks.token).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();
});
it("preserves ads, calendar and backup authorization when saving the conversion token",async()=>{
 const response=await completeGoogleConversionAuthorization(request());
 expect(mocks.consume).toHaveBeenCalledWith("google-conversions","synthetic-state");
 expect(mocks.save).toHaveBeenCalledWith({...mocks.config,googleConversionsRefreshToken:"synthetic-new-conversions"});
 expect(response.headers.get("location")).toBe("https://platform.example.invalid/gestor/audit-client/configuracoes?secao=conversoes&googleConversions=connected");
});
it("does not accept an authorization without the conversion permission",async()=>{
 mocks.token.mockResolvedValueOnce({tokens:{refresh_token:"synthetic-wrong-scope",scope:"https://www.googleapis.com/auth/adwords"}});
 expect((await completeGoogleConversionAuthorization(request())).headers.get("location")).toContain("googleConversions=error");expect(mocks.save).not.toHaveBeenCalled();
});
it("does not save a token issued for credentials changed during authorization",async()=>{
 mocks.token.mockImplementationOnce(async()=>{mocks.config.nexoGoogleClientSecret="synthetic-concurrent-key";return{tokens:{refresh_token:"synthetic-token",scope:DATA_MANAGER_SCOPE}};});
 expect((await completeGoogleConversionAuthorization(request())).headers.get("location")).toContain("googleConversions=error");expect(mocks.save).not.toHaveBeenCalled();
});
it("does not exchange a denied consent or expose secret values to the form",async()=>{
 await completeGoogleConversionAuthorization(request(""));expect(mocks.token).not.toHaveBeenCalled();
 expect(hasGoogleConversionAuthorization(mocks.config)).toBe(true);
 expect(JSON.stringify(safePlatformConfig(mocks.config))).not.toContain("synthetic-old-conversions");
 expect(platformConfigPatch({googleConversionsRefreshToken:"synthetic-injected"})).toEqual({});
});
