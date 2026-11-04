import { beforeEach, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
const mocks=vi.hoisted(()=>({add:vi.fn(),download:vi.fn(),persist:vi.fn(),transcribe:vi.fn(),runAgent:vi.fn(),kanban:vi.fn()}));
vi.mock("@/lib/clients",()=>({getConfig:async()=>({metaAppSecret:"synthetic-secret"}),getClients:async()=>[],getClientById:async()=>({id:"client-a"}),getAgentConfigForConnection:()=>({enabled:false}),isWithinBusinessHours:()=>true}));
vi.mock("@/lib/funnels",()=>({getFunnels:async()=>[{id:"funnel-a",clientId:"client-a",columns:[{id:"entrada"}],connections:[{id:"connection-a",type:"meta",metaPhoneNumberId:"123",metaToken:"synthetic-connection-key"}]}]}));
vi.mock("@/lib/leads",()=>({getChatLeadByPhone:async()=>({id:"lead-a",aiPaused:true}),hasLeadByPhone:async()=>true,captureWhatsAppLead:async()=>({id:"lead-a"}),markLeadNeedsAttention:vi.fn(),toDialablePhone:(value:string)=>value}));
vi.mock("@/lib/conversations",()=>({addMessage:mocks.add,getHistory:async()=>[],getAiPaused:async()=>true,updateMessage:vi.fn()}));
vi.mock("@/lib/whatsapp-send",()=>({downloadMetaMedia:mocks.download,getGeminiApiKey:async()=>null,sendMessageDirect:vi.fn()}));
vi.mock("@/lib/media-transcribe",()=>({saveDecryptedMedia:mocks.persist,transcribeMedia:mocks.transcribe}));
vi.mock("@/lib/gemini-agent",()=>({runGeminiAgent:mocks.runAgent}));
vi.mock("@/lib/kanban-agent",()=>({processKanbanActions:mocks.kanban}));
import { POST } from "@/app/api/whatsapp/meta/route";
beforeEach(()=>{vi.clearAllMocks();mocks.add.mockResolvedValue(true);mocks.download.mockResolvedValue(Buffer.from("OggS synthetic fixture"));mocks.persist.mockResolvedValue("/api/media/synthetic.ogg");mocks.kanban.mockResolvedValue(undefined);});
function request(){
  const body=JSON.stringify({entry:[{changes:[{field:"messages",value:{metadata:{phone_number_id:"123"},contacts:[{wa_id:"5544999999999",profile:{name:"Contato fictício"}}],messages:[{id:"synthetic-message-id",from:"5544999999999",type:"audio",audio:{id:"synthetic-media-id",mime_type:"audio/ogg"}}]}}]}]});
  return new NextRequest("https://app.example.invalid/api/whatsapp/meta",{method:"POST",headers:{"x-hub-signature-256":"sha256="+createHmac("sha256","synthetic-secret").update(body).digest("hex")},body});
}
it("archives official API audio even with AI paused and no transcription key",async()=>{
  expect((await POST(request())).status).toBe(200);
  expect(mocks.add).toHaveBeenCalledWith("5544999999999",expect.objectContaining({role:"user",type:"audio",mediaUrl:"/api/media/synthetic.ogg",messageId:"synthetic-message-id"}),"client-a",expect.objectContaining({connId:"connection-a"}));
  expect(mocks.persist).toHaveBeenCalledWith(expect.any(Buffer),"5544999999999",expect.any(Number),"audio/ogg","client-a","connection-a");
  expect(mocks.transcribe).not.toHaveBeenCalled();expect(mocks.runAgent).not.toHaveBeenCalled();
});
it("retains a typed audio message when its provider file is unavailable",async()=>{
  mocks.download.mockResolvedValueOnce(null);
  expect((await POST(request())).status).toBe(200);
  const message=mocks.add.mock.calls[0][1];expect(message.type).toBe("audio");expect(message.content).toBe("[Áudio]");expect(message.mediaUrl).toBeUndefined();expect(mocks.runAgent).not.toHaveBeenCalled();
});
it("does not run automatic actions again for a previously archived provider message",async()=>{
  mocks.add.mockResolvedValueOnce(false);
  expect((await POST(request())).status).toBe(200);expect(mocks.kanban).not.toHaveBeenCalled();expect(mocks.runAgent).not.toHaveBeenCalled();
});
