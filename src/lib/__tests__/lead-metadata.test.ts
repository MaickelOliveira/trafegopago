import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeDocument, readDocument } from "../document-store";
import { upsertLeadByPhone, hasLeadByPhone, captureWhatsAppLead, attachLeadsHeat, type Lead } from "../leads";
let directory: string, cwd: string;
beforeEach(async () => { cwd = process.cwd(); directory = await mkdtemp(path.join(tmpdir(), "tp-metadata-")); process.chdir(directory); await writeDocument("leads.json", [{ id: "lead", clientId: "a", funnelId: "f", phone: "44999999999", name: "Ana", status: "won", email: "ana@example.invalid", value: 500, notes: "Anotação manual", utmCampaign: "original" }]); });
afterEach(async () => { process.chdir(cwd); await rm(directory, { recursive: true, force: true }); });
describe("automatic contact metadata", () => {
  it("calculates engagement from this funnel's channel rather than another conversation with the same phone", async () => {
    const now=Date.now(),phone="5544999999999";
    await writeDocument("funnels.json",[{id:"f",clientId:"a",columns:[],connections:[{id:"x",type:"meta"}]},{id:"g",clientId:"a",columns:[],connections:[{id:"y",type:"meta"}]}]);
    const conversation=(connId:string,lastActivity:number)=>({clientId:"a",connId,lastActivity,messages:[1,2,3].map(i=>({role:"user",content:"fixture "+i,ts:lastActivity}))});
    await writeDocument("conversations.json",{[`a:x:${phone}`]:conversation("x",now),[`a:y:${phone}`]:conversation("y",now-3*24*3600000)});
    const result=await attachLeadsHeat([{id:"first",clientId:"a",funnelId:"f",phone},{id:"second",clientId:"a",funnelId:"g",phone}] as Lead[]);
    expect(result.map(lead=>lead.heat)).toEqual(["hot","stalled"]);
  });
  it("does not choose an arbitrary duplicate contact for an automatic update", async () => {
    const first = { id: "one", clientId: "a", funnelId: "f", phone: "44999999999", status: "novo" };
    const second = { ...first, id: "two", status: "ganho" };
    await writeDocument("leads.json", [first,second]);
    await expect(upsertLeadByPhone("a", first.phone, { funnelId: "f", status: "perdido" })).rejects.toThrow("duplicada");
    expect(await readDocument("leads.json", [])).toEqual([first,second]);
  });
  it("keeps WhatsApp capture available without choosing, moving or deleting a duplicate CRM contact", async () => {
    const first={id:"one",clientId:"a",funnelId:"f",phone:"44999999999",status:"novo"},second={...first,id:"two",status:"ganho"};
    await writeDocument("leads.json",[first,second]);
    expect(await hasLeadByPhone("a",first.phone,"f")).toBe(true);
    expect(await hasLeadByPhone("other",first.phone,"f")).toBe(false);
    expect(await captureWhatsAppLead("a",first.phone,{funnelId:"f",status:"perdido"})).toBeUndefined();
    const stored=await readDocument<Lead[]>("leads.json",[]);
    expect(stored.map(lead=>[lead.id,lead.status])).toEqual([["one","novo"],["two","ganho"]]);
    expect(stored.every(lead=>lead.needsAttention)).toBe(true);
  });
  it("preserves stage and captured data when a provider omits fields", async () => {
    const result = await upsertLeadByPhone("a", "44999999999", { funnelId: "f", status: undefined, email: null, value: null, utmCampaign: null });
    expect(result).toMatchObject({ status: "won", email: "ana@example.invalid", value: 500, utmCampaign: "original" });
  });
  it("keeps ownership and notes when automatic metadata arrives", async () => {
    const result = await upsertLeadByPhone("a", "44999999999", { funnelId: "f", id: "injected", clientId: "other", notes: "Novo dado" });
    expect(result.id).toBe("lead"); expect(result.clientId).toBe("a"); expect(result.notes).toContain("Anotação manual"); expect(result.notes).toContain("Novo dado");
    const repeated = await upsertLeadByPhone("a", "44999999999", { funnelId: "f", notes: "Novo dado" });
    expect(repeated.notes).toBe(result.notes);
  });
});
