// Regression checks run entirely in memory. No database, network or messages.
// Run: node --test scripts/verify-evolution-link.cjs
const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const path = require("node:path");
const fs = require("node:fs");
const ts = require("typescript");
const source = typeof sourceFiles !== "undefined" ? sourceFiles : Object.fromEntries([
  "src/lib/clients.ts", "src/lib/funnels.ts", "src/lib/evolution-sessions.ts",
  "src/app/api/whatsapp/evolution-manager/link/route.ts",
].map(file => [file, fs.readFileSync(path.join(__dirname, "..", file), "utf8")]));
const agent = (id, extra = {}) => ({ enabled: true, followUpEnabled: false, followUps: [], whatsappConnectionId: id, systemPrompt: "instruções " + id, ...extra });
const client = (id, extra = {}) => ({ id, name: id, email: id + "@example.invalid", adAccounts: [], ...extra });
function harness(clients, options = {}) {
  let docs = { "clients.json": { clients: structuredClone(clients) }, "funnels.json": structuredClone(options.funnels || [{ id: "funnel", clientId: "a", columns: [] }]), "evolution-sessions.json": [{ id: "current", instanceName: "existing-number", clientId: "a", funnelId: "funnel", hasAgent: true }, ...(options.sessions || [])] };
  let depth = 0;
  const store = {
    readDocument: async (name, fallback) => structuredClone(docs[name] ?? fallback),
    writeDocument: async (name, value) => { if (options.failWrite === name) throw Error("synthetic storage failure"); docs[name] = structuredClone(value); },
    withDataTransaction: async fn => {
      if (depth) return fn();
      const before = structuredClone(docs);
      depth++;
      try { return await fn(); }
      catch (error) { docs = before; throw error; }
      finally { depth--; }
    },
  };
  const modules = {};
  const dependencies = {
    "./document-store": store, "@/lib/document-store": store,
    "./timezone": { currentHHMMBrasilia: () => "10:00", currentWeekdayBrasilia: () => 1 },
    "next/server": { NextResponse: { json: (value, init) => Response.json(value, init) } },
    "@/lib/auth": { getSession: async () => options.role === null ? null : { role: options.role || "manager" } },
  };
  const load = file => {
    if (modules[file]) return modules[file];
    const output = ts.transpileModule(source[file], { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    const module = { exports: {} };
    const localRequire = name => {
      if (dependencies[name]) return dependencies[name];
      const internal = { "@/lib/clients": "src/lib/clients.ts", "@/lib/funnels": "src/lib/funnels.ts", "@/lib/evolution-sessions": "src/lib/evolution-sessions.ts" }[name];
      if (internal) return load(internal);
      if (["path", "crypto", "node:path", "node:crypto"].includes(name)) return require(name);
      throw Error("Unexpected dependency: " + name);
    };
    vm.runInThisContext("(function(require, module, exports) {" + output + "\n})", { filename: file })(localRequire, module, module.exports);
    modules[file] = module.exports;
    return module.exports;
  };
  const api = load("src/lib/clients.ts");
  const route = load("src/app/api/whatsapp/evolution-manager/link/route.ts");
  return {
    api, docs: () => structuredClone(docs),
    client: id => structuredClone(docs["clients.json"].clients.find(c => c.id === id)),
    call: (patch = {}) => route.POST({ json: async () => ({ sessionId: "current", funnelId: "funnel", clientId: "a", linkAgent: true, ...patch }) }),
  };
}
test("legacy agent on a distinct connection remains visible and usable beside per-connection configs", () => {
  const h = harness([]);
  const mixed = client("a", { agentConfig: agent("legacy"), agentConfigs: [agent("other")] });
  assert.deepEqual(Array.from(h.api.getAllAgentConfigs(mixed), cfg => cfg.whatsappConnectionId), ["other", "legacy"]);
  assert.equal(h.api.getAgentConfigForConnection(mixed, "legacy").systemPrompt, "instruções legacy");
});
test("specific configuration wins over a stale legacy duplicate", () => {
  const h = harness([]);
  const mixed = client("a", { agentConfig: agent("current", { enabled: true }), agentConfigs: [agent("current", { enabled: false })] });
  assert.equal(h.api.getAllAgentConfigs(mixed).length, 1);
  assert.equal(h.api.getAgentConfigForConnection(mixed, "current").enabled, false);
});
test("new connections cannot inherit an agent tied to another number", () => {
  const h = harness([]);
  assert.equal(h.api.getAgentConfigForConnection(client("a", { agentConfig: agent("other") }), "current"), undefined);
  assert.equal(h.api.getAgentConfigForConnection(client("a", { agentConfigs: [agent("other")] }), "current"), undefined);
});
test("unbound legacy default remains available for existing installations", () => {
  const h = harness([]);
  assert.equal(h.api.getAgentConfigForConnection(client("a", { agentConfig: agent(undefined) }), "current").enabled, true);
});
test("linking an existing agent preserves its prompt, key and media rather than using another default", async () => {
  const chosen = agent("current", { geminiApiKey: "synthetic-key", mediaLibrary: [{ name: "foto" }] });
  const h = harness([client("a", { agentConfig: agent("other"), agentConfigs: [chosen] })]);
  assert.equal((await h.call()).status, 200);
  assert.deepEqual(h.api.getAgentConfigForConnection(h.client("a"), "current"), chosen);
  assert.equal(h.api.getAgentConfigForConnection(h.client("a"), "other").systemPrompt, "instruções other");
});
test("a new client gets a funnel automatically and an inactive agent until configured", async () => {
  const h = harness([client("a")], { funnels: [] });
  const response = await h.call({ funnelId: null });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.ok(result.funnelId);
  assert.equal(h.docs()["funnels.json"].length, 1);
  assert.equal(h.docs()["funnels.json"][0].clientId, "a");
  assert.equal(h.docs()["evolution-sessions.json"][0].funnelId, result.funnelId);
  assert.equal(h.api.getAgentConfigForConnection(h.client("a"), "current").enabled, false);
});
test("automatic funnel linking reuses a client's existing funnel", async () => {
  const h = harness([client("a")]);
  const result = await (await h.call({ funnelId: "auto:a" })).json();
  assert.equal(result.funnelId, "funnel");
  assert.equal(h.docs()["funnels.json"].length, 1);
});
test("explicit agent reuse preserves settings, removes its previous binding and marks the old session", async () => {
  const selected = agent("previous", { knowledgeBase: [{ name: "catálogo" }] });
  const h = harness([client("a", { agentConfigs: [selected, agent("current", { enabled: false })] })], { sessions: [{ id: "previous", clientId: "a", hasAgent: true }] });
  const result = await (await h.call({ reuseConnectionId: "previous" })).json();
  assert.equal(result.migratedConfig, true);
  assert.equal(h.api.getAgentConfigForConnection(h.client("a"), "current").systemPrompt, selected.systemPrompt);
  assert.deepEqual(h.api.getAgentConfigForConnection(h.client("a"), "current").knowledgeBase, selected.knowledgeBase);
  assert.equal(h.api.getAgentConfigForConnection(h.client("a"), "previous"), undefined);
  assert.equal(h.docs()["evolution-sessions.json"].find(s => s.id === "previous").hasAgent, false);
});
test("invalid reuse is rejected before any state changes", async () => {
  const h = harness([client("a", { agentConfigs: [agent("current")] })]);
  const before = h.docs();
  assert.equal((await h.call({ reuseConnectionId: "missing", funnelId: "auto:a" })).status, 400);
  assert.deepEqual(h.docs(), before);
});
test("turning off the link disables both legacy and per-connection agent bindings", async () => {
  const h = harness([client("a", { agentConfig: agent("current"), agentConfigs: [agent("current"), agent("other")] })]);
  assert.equal((await h.call({ linkAgent: false })).status, 200);
  assert.equal(h.api.getAgentConfigForConnection(h.client("a"), "current"), undefined);
  assert.equal(h.api.getAgentConfigForConnection(h.client("a"), "other").enabled, true);
  assert.equal(h.docs()["evolution-sessions.json"][0].hasAgent, false);
});
test("turning off a legacy-only link cannot leave an enabled fallback", async () => {
  const h = harness([client("a", { agentConfig: agent("current") })]);
  assert.equal((await h.call({ linkAgent: false })).status, 200);
  assert.equal(h.api.getAgentConfigForConnection(h.client("a"), "current").enabled, false);
});
test("moving a connection removes the old client's bindings and preserves unrelated numbers", async () => {
  const h = harness([client("a", { agentConfigs: [agent("current"), agent("other")] }), client("b")]);
  assert.equal((await h.call({ clientId: "b", funnelId: null })).status, 200);
  assert.equal(h.api.getAgentConfigForConnection(h.client("a"), "current"), undefined);
  assert.equal(h.api.getAgentConfigForConnection(h.client("a"), "other").enabled, true);
  assert.equal(h.api.getAgentConfigForConnection(h.client("b"), "current").enabled, false);
});
test("failure while saving the session rolls back newly created funnels", async () => {
  const h = harness([client("a")], { funnels: [], failWrite: "evolution-sessions.json" });
  const before = h.docs();
  await assert.rejects(() => h.call({ funnelId: null }), /synthetic storage failure/);
  assert.deepEqual(h.docs(), before);
});
test("failure while saving an agent rolls back the session and funnel", async () => {
  const h = harness([client("a")], { funnels: [], failWrite: "clients.json" });
  const before = h.docs();
  await assert.rejects(() => h.call({ funnelId: null }), /synthetic storage failure/);
  assert.deepEqual(h.docs(), before);
});
test("non-manager, missing client, missing funnel and invalid payload are rejected without writes", async () => {
  for (const role of ["client", "employee", null]) {
    const h = harness([client("a")], { role });
    const before = h.docs();
    assert.equal((await h.call()).status, 401);
    assert.deepEqual(h.docs(), before);
  }
  for (const [patch, status] of [[{ clientId: "missing" }, 404], [{ funnelId: "missing" }, 404], [{ clientId: null }, 400], [{ linkAgent: "yes" }, 400], [{ funnelId: "auto:missing" }, 400]]) {
    const h = harness([client("a")]);
    const before = h.docs();
    assert.equal((await h.call(patch)).status, status);
    assert.deepEqual(h.docs(), before);
  }
});
