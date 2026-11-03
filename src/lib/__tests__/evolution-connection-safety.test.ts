import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks=vi.hoisted(()=>({status:vi.fn(),logout:vi.fn(),create:vi.fn(),createSession:vi.fn()}));
vi.mock("../evolution-api",()=>({checkConnectionStatus:mocks.status,logoutInstance:mocks.logout,createOrRestartInstance:mocks.create,evolutionWebhookForSession:async(id:string)=>`https://platform.example.invalid/api/whatsapp/webhook/evolution/${id}`,shouldRestartEvolutionSession:()=>true,getEvolutionRestartCooldownRemainingMs:()=>0,getQrCode:async()=>null,getPairingCode:async()=>null,isEvolutionConfigured:async()=>true,getInstancePhone:async()=>null}));
vi.mock("../evolution-share-links",()=>({getShareLinkByToken:async()=>({evolutionSessionId:"stored-session"}),isShareLinkValid:()=>true}));
vi.mock("../evolution-sessions",()=>({getEvolutionSessionById:async()=>({id:"stored-session",instanceName:"existing-number"}),getEvolutionSessions:async()=>[{id:"stored-session",instanceName:"existing-number"}],createEvolutionSession:mocks.createSession,updateEvolutionSession:async()=>{}}));
vi.mock("../auth",()=>({getSession:async()=>({role:"manager"})}));
vi.mock("../clients",()=>({getClients:async()=>[],getAllAgentConfigs:()=>[]}));
vi.mock("../funnels",()=>({getFunnels:async()=>[]}));
vi.mock("../document-store",()=>({withDataTransaction:async(callback:()=>unknown)=>callback()}));
import { POST as connect } from "../../app/api/conectar-evolution/[token]/connect/route";
import { POST as register } from "../../app/api/whatsapp/evolution-manager/route";
const request=(data:unknown)=>new NextRequest("https://platform.example.invalid/api/conectar-evolution/token/connect",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data)});
beforeEach(()=>{vi.clearAllMocks();mocks.status.mockResolvedValue("DISCONNECTED");mocks.logout.mockResolvedValue(undefined);mocks.create.mockResolvedValue({apiKey:"",qrBase64:"synthetic-qr"});});
it("ignores an attacker-selected webhook destination in a public QR request",async()=>{
 const response=await connect(request({webhookUrl:"https://attacker.example.invalid/capture",force:true}),{params:Promise.resolve({token:"synthetic-token"})});
 expect(response.status).toBe(200);expect(mocks.create).toHaveBeenCalledWith("existing-number","https://platform.example.invalid/api/whatsapp/webhook/evolution/stored-session");
});
it("never disconnects an active number through a public retry request",async()=>{
 mocks.status.mockResolvedValue("CONNECTED");
 const response=await connect(request({force:true}),{params:Promise.resolve({token:"synthetic-token"})});
 expect(await response.json()).toMatchObject({status:"connected"});expect(mocks.logout).not.toHaveBeenCalled();expect(mocks.create).not.toHaveBeenCalled();
});
it("does not treat a provider outage as proof that a number is disconnected",async()=>{
 mocks.status.mockResolvedValue("UNKNOWN");
 const response=await connect(request({force:true}),{params:Promise.resolve({token:"synthetic-token"})});
 expect(response.status).toBe(503);expect(mocks.logout).not.toHaveBeenCalled();expect(mocks.create).not.toHaveBeenCalled();
});
it("rejects duplicate names before touching an existing session",async()=>{
 const response=await register(request({name:"Existing Number"}));
 expect(response.status).toBe(409);expect(mocks.createSession).not.toHaveBeenCalled();expect(mocks.logout).not.toHaveBeenCalled();expect(mocks.create).not.toHaveBeenCalled();
});
