import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { formFields, leadChatNumber, leadFormMessage, splitLeadMessage } from "../lead-form";

const { pending, send } = vi.hoisted(() => ({
  pending: [] as (() => Promise<void>)[],
  send: vi.fn(async (_to: string, _body: string, _client: string, _connection: string) => true),
}));
vi.mock("next/server", async importOriginal => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (callback: () => Promise<void>) => pending.push(callback),
}));
// Esta suíte usa o armazenamento temporário do modo de teste.
vi.mock("pg", () => ({ Pool: class { constructor() { throw new Error("Teste sem banco externo"); } } }));
vi.mock("../auth", () => ({ getSession: async () => ({ role: "manager" }) }));
vi.mock("../whatsapp-send", () => ({ sendMessage: send }));

describe("ficha do lead", () => {
  it("preserva múltiplas escolhas, valores zero, respostas negativas e dados aninhados", () => {
    const text = leadFormMessage({
      source: "Site", name: "Maria", phone: "(44) 99999-0000", email: "m@example.test",
      fields: formFields({ interesses: ["Gradil", "Alambrado"], entrada: 0, instalar: false, local: { cidade: "Campo Mourão" }, utm_campaign: "Novembro" }),
    });
    for (const part of ["https://wa.me/5544999990000", "m@example.test", "Gradil, Alambrado", "Entrada: 0", "Instalar: Não", "Cidade: Campo Mourão", "Campanha UTM: Novembro"]) {
      expect(text).toContain(part);
    }
  });
  it("respeita DDI explícito e só monta link quando há um número discável", () => {
    expect(leadChatNumber("+1 (202) 555-0100")).toBe("12025550100");
    expect(leadChatNumber("00351 912 345 678")).toBe("351912345678");
    expect(leadChatNumber("9999-0000")).toBe("");
    expect(leadChatNumber("5544999990000")).toBe("5544999990000");
  });
  it("preserva respostas longas e emojis entre partes", () => {
    const long = "🙂".repeat(5000);
    const parts = splitLeadMessage(long, 651);
    expect(parts.join("")).toBe(long);
    expect(parts.every(p => p.length <= 651)).toBe(true);
  });
});

describe.skipIf(process.env.TEST_POSTGRES === "1")("entrada de formulários e entrega por cliente", () => {
  const root = mkdtempSync(path.join(tmpdir(), "lead-form-test-"));
  const data = path.join(root, "data");
  const phone = "5544900000001";
  const group = "120363000000000001@g.us";
  const recipient = (value: string) => ({ id: value, label: value, value, type: value.includes("@") ? "group" : "phone" });
  const storeFile = (file: string, value: unknown) => writeFileSync(path.join(data, file + ".json"), JSON.stringify(value));
  const request = (url: string, body: unknown) => new NextRequest("https://example.test" + url, {
    method: "POST", headers: { "Content-Type": "application/json", "x-hub-signature-256": "sha256=" + createHmac("sha256", "test-secret").update(JSON.stringify(body)).digest("hex") }, body: JSON.stringify(body),
  });
  const flush = async () => { for (const callback of pending.splice(0)) await callback(); };
  let site: typeof import("../../app/api/crm/webhook/form/route");
  let meta: typeof import("../../app/api/meta/webhook/route");
  let pixel: typeof import("../../app/api/pixel/event/route");
  let queue: typeof import("../lead-notifications");

  beforeAll(async () => {
    mkdirSync(data, { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(root);
    site = await import("../../app/api/crm/webhook/form/route");
    meta = await import("../../app/api/meta/webhook/route");
    pixel = await import("../../app/api/pixel/event/route");
    queue = await import("../lead-notifications");
  });
  beforeEach(() => {
    rmSync(path.join(data, "lead-deliveries.json"), { recursive: true, force: true });
    storeFile("clients", { clients: [
      { id: "a", metaPageId: "p", agentConfigs: [
        { whatsappConnectionId: "wa-a", avisos: [recipient("5544900000099")], leadRecipients: [recipient(phone), recipient(group), recipient(phone)] },
      ] },
      { id: "b", agentConfig: { whatsappConnectionId: "wa-b", avisos: [recipient("5544900000002")] } },
    ] });
    storeFile("funnels", ["a", "b"].map(id => ({ id, clientId: id, columns: [{ id: "novo" }] })));
    storeFile("evolution-sessions", ["a", "b"].map(id => ({ id: "wa-" + id, clientId: id, funnelId: id })));
    storeFile("config", { metaToken: "simulado", metaAppSecret: "test-secret" });
    send.mockReset().mockResolvedValue(true);
    pending.length = 0;
  });
  afterAll(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    rmSync(root, { recursive: true, force: true });
  });

  it("salva e remove destinos pela API do agente mantendo Avisos independentes", async () => {
    const agent = await import("../../app/api/agent/route");
    const url = "/api/agent?clientId=a&connId=wa-a";
    const invalid = await agent.PUT(request(url, { leadRecipients: [recipient("xyz")] }));
    expect(invalid.status).toBe(400);
    const response = await agent.PUT(request(url, { leadRecipients: [recipient(group), recipient(group)] }));
    expect(response.status).toBe(200);
    const saved = await (await agent.GET(request(url, {}))).json();
    expect(saved.leadRecipients.map((r: {value: string}) => r.value)).toEqual([group]);
    expect(saved.avisos[0].value).toBe("5544900000099");
    await agent.PUT(request(url, { leadRecipients: [] }));
    await site.POST(request("/?clientId=a", { phone: "44999990003", funnelId: "a" }));
    await flush();
    expect(send).not.toHaveBeenCalled();
  });

  it("preserva os destinos do CRM quando o agente é salvo e permite receber com a IA desligada", async () => {
    const agent = await import("../../app/api/agent/route");
    const url = "/api/agent?clientId=a&connId=wa-a";
    await agent.PATCH(request(url, { field: "enabled", value: false }));
    const previous = await (await agent.GET(request(url, {}))).json();
    delete previous.leadRecipients; // A tela do agente edita somente os campos que controla.
    expect((await agent.PUT(request(url, { leadRecipients: [recipient(group)] }))).status).toBe(200);
    expect((await agent.PUT(request(url, { ...previous, name: "Atendimento" }))).status).toBe(200);
    const saved = await (await agent.GET(request(url, {}))).json();
    expect(saved.enabled).toBe(false);
    expect(saved.leadRecipients.map((r: { value: string }) => r.value)).toEqual([group]);
    await site.POST(request("/?clientId=a", { nome: "Ana", telefone: "44999990008", produto: "Gradil", funnelId: "a" }));
    await flush();
    expect(send.mock.calls.map(call => call[0])).toEqual([group]);
  });

  it("encaminha ao número e ao grupo, sem usar os avisos ou outro cliente", async () => {
    const form = { nome: "Ana", whatsapp: "(44) 99999-0000", tamanho: "20 m", funnelId: "a" };
    const response = await site.POST(request("/?clientId=a", form));
    expect(response.status).toBe(200);
    await site.POST(request("/?clientId=a", form));
    await site.POST(request("/?clientId=b", { ...form, funnelId: "b" }));
    await flush();
    expect(send.mock.calls.map(call => call[0]).sort()).toEqual([phone, group].sort());
    for (const [, body, client, conn] of send.mock.calls) {
      expect([client, conn]).toEqual(["a", "wa-a"]);
      expect(body).toContain("Tamanho: 20 m");
      expect(body).toContain("https://wa.me/5544999990000");
    }
    await site.POST(request("/?clientId=a", { ...form, tamanho: "40 m" }));
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("dispara na criação pelo webhook personalizado e nunca cruza funis do mesmo cliente", async () => {
    const clients = { clients: [{ id: "a", agentConfigs: [
      { whatsappConnectionId: "wa-other", leadRecipients: [recipient("5544900000022")] },
      { whatsappConnectionId: "wa-a", enabled: false, leadRecipients: [recipient(group)] },
    ] }] };
    storeFile("clients", clients);
    storeFile("funnels", ["a", "other"].map(id => ({ id, clientId: "a", columns: [{ id: "novo" }] })));
    storeFile("evolution-sessions", [{ id: "wa-a", clientId: "a", funnelId: "a" }, { id: "wa-other", clientId: "a", funnelId: "other" }]);
    storeFile("webhooks", [{ id: "site-test", clientId: "a", active: true, name: "Pré Moldados", funnelId: "a", columnId: "novo", fieldMapping: { nameField: "nome", phoneField: "telefone" }, leadCount: 0 }]);
    const webhook = await import("../../app/api/wh/[id]/route");
    const payload = { nome: "Teste Jort", telefone: "(44) 99999-0091", projeto: "Barracão rural", area: "600", mensagem: "Teste CRM", submission_id: "id-interno" };
    const post = () => webhook.POST(request("/api/wh/site-test", payload), { params: Promise.resolve({ id: "site-test" }) });
    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(200);
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    const [to, text, client, connection] = send.mock.calls[0];
    expect([to,client,connection]).toEqual([group,"a","wa-a"]);
    for (const value of ["Novo lead de formulário", "Barracão rural", "600", "Teste CRM", "https://wa.me/5544999990091"]) expect(text).toContain(value);
    expect(text).not.toContain("id-interno");
    const { createLead, updateLead, getLeadByPhone } = await import("../leads");
    const saved = (await getLeadByPhone("a", payload.telefone, "a"))!;
    await updateLead(saved.id, { status: "ganho" });
    await createLead({ ...saved, phone: payload.telefone });
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    await createLead({ ...saved, phone: "44999990092", source: "manual" });
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("só avisa após o primeiro formulário, inclusive quando o WhatsApp já criou o contato", async () => {
    const { captureWhatsAppLead } = await import("../leads");
    const raw = "44999990123";
    const contact = await captureWhatsAppLead("a", raw, { funnelId: "a", source: "whatsapp" });
    await pixel.POST(request("/", { clientId: "a", phone: raw, event: "Lead", source: "whatsapp" }));
    await flush();
    await queue.processLeadNotifications();
    expect(send).not.toHaveBeenCalled();

    storeFile("webhooks", [{ id: "form-jort", clientId: "a", active: true, name: "Jort", funnelId: "a", columnId: "novo", fieldMapping: { nameField: "nome", phoneField: "telefone" }, leadCount: 0 }]);
    const webhook = await import("../../app/api/wh/[id]/route");
    const post = () => webhook.POST(request("/api/wh/form-jort", { nome: "Teste", telefone: raw, projeto: "Barracão" }), { params: Promise.resolve({ id: "form-jort" }) });
    expect((await (await post()).json()).leadId).toBe(contact?.id);
    await flush();
    expect(send.mock.calls.map(c => c[0]).sort()).toEqual([group, phone].sort());
    expect(send.mock.calls[0][1]).toContain("Projeto: Barracão");

    // Mesmo após a limpeza dos recibos, conversar ou reenviar não gera outro aviso.
    storeFile("lead-deliveries", {});
    await captureWhatsAppLead("a", raw, { funnelId: "a", source: "whatsapp" });
    await post();
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("cancela um aviso antigo de conversa e deixa o formulário posterior chegar", async () => {
    const { captureWhatsAppLead } = await import("../leads");
    const raw = "44999990124";
    const contact = await captureWhatsAppLead("a", raw, { funnelId: "a", source: "whatsapp" });
    const id = createHash("sha256").update(JSON.stringify(["a", contact!.id, "wa-a", group])).digest("hex");
    const now = Date.now();
    storeFile("lead-deliveries", { [id]: {
      contact: "antigo", pixel: false, created: now, clientId: "a", funnelId: "a", connectionId: "wa-a",
      to: group, name: "Desconhecido", phone: raw, parts: ["📋 *Novo lead no CRM*\n\n*Origem:* WhatsApp"],
      index: 0, due: now, deadline: now + 60000, retention: 180000, attempts: 0,
    } });
    await queue.processLeadNotifications();
    expect(send).not.toHaveBeenCalled();
    await site.POST(request("/?clientId=a", { telefone: raw, funnelId: "a", projeto: "Industrial" }));
    await flush();
    expect(send.mock.calls.map(c => c[0]).sort()).toEqual([group, phone].sort());
    expect(send.mock.calls[0][1]).toContain("Projeto: Industrial");
  });

  it("entrega formulário do pixel e prioriza o webhook quando ambos recebem o mesmo contato", async () => {
    const form = { event: "FormSubmit", source: "form", clientId: "a", phone: "44999990001", name: "Iara", fields: { materiais: ["Vidro", "Metal"] } };
    expect((await pixel.POST(request("/", form))).status).toBe(200);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 20_000);
    try {
      await queue.processLeadNotifications();
      expect(send.mock.calls[0][1]).toContain("Materiais: Vidro, Metal");
      await pixel.POST(request("/", { ...form, phone: "44999990002" }));
      await site.POST(request("/?clientId=a", { nome: "Iara", whatsapp: "44999990002", produto: "Gradil", funnelId: "a" }));
      await flush();
      clock.mockReturnValue(Date.now() + 20_000);
      await queue.processLeadNotifications();
      expect(send).toHaveBeenCalledTimes(4);
      expect(send.mock.calls[3][1]).toContain("Produto: Gradil");
    } finally { clock.mockRestore(); }
  });

  it("deduplica ID da Meta e só repete o destino que falhou", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ field_data: [
      { name: "full_name", values: ["Lia"] }, { name: "phone_number", values: ["+1 202 555 0100"] },
      { name: "servicos", values: ["Site", "Anúncio"] },
    ] })));
    const event = { entry: [{ id: "p", changes: [{ field: "leadgen", value: { leadgen_id: "l1" } }] }] };
    await meta.POST(request("/", event));
    send.mockImplementation(async to => to !== group);
    await flush();
    expect(send.mock.calls[0][1]).toContain("Serviços: Site, Anúncio");
    expect(send.mock.calls[0][1]).toContain("https://wa.me/12025550100");
    await meta.POST(request("/", event));
    expect(pending).toHaveLength(0);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 120_000);
    try {
      send.mockResolvedValue(true);
      await queue.processLeadNotifications();
      await queue.processLeadNotifications();
      expect(send.mock.calls.map(c => c[0]).sort()).toEqual([phone, group, group].sort());
    } finally { clock.mockRestore(); }
    await meta.POST(request("/", { entry: [{ id: "desconhecida", changes: event.entry[0].changes }] }));
    expect(pending).toHaveLength(0);
  });
});
