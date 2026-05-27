"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";

type AdAccount = { id: string; name: string; platform: "meta" | "google" };
type FunnelType = "leads" | "sales" | "traffic";
type Client = {
  id: string;
  name: string;
  email: string;
  color: string;
  cplTarget: number;
  funnelType: FunnelType;
  adAccounts: AdAccount[];
  tintimCode?: string;
  tintimToken?: string;
  tintimWebhookForward?: string;
  pixelId?: string;
  capiToken?: string;
};

const FUNNEL_OPTIONS: { value: FunnelType; label: string; desc: string; icon: string }[] = [
  { value: "leads",   label: "Funil de Leads",  desc: "Conversas, formulários, CPL", icon: "💬" },
  { value: "sales",   label: "Funil de Vendas",  desc: "Add to cart, checkout, compras, ROAS", icon: "🛒" },
  { value: "traffic", label: "Funil de Tráfego", desc: "Cliques, visitas LP, CPC", icon: "🌐" },
];

const COLORS = ["#3B82F6","#8B5CF6","#EC4899","#F59E0B","#10B981","#EF4444","#06B6D4","#84CC16"];

type AppConfig = {
  metaToken: string;
  metaAppId: string;
  metaAppSecret: string;
  anthropicApiKey: string;
  uazapiServer: string;
  uazapiToken: string;
  uazapiAdminToken: string;
  appBaseUrl: string;
  uazapiWebhookForward: string;
  googleClientId: string;
  googleClientSecret: string;
  masterPhone: string;
  masterConnectionId: string;
};

type WaConnection = { id: string; phone: string; funnelName: string };

export function ConfiguracoesView({ clients: initial, appBaseUrl, allConnections }: { clients: Client[]; appBaseUrl?: string; allConnections?: WaConnection[] }) {
  const router = useRouter();
  const [clients, setClients] = useState(initial);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [pixelClient, setPixelClient] = useState<Client | null>(null);
  const [copied, setCopied] = useState(false);

  function copyPixelCode(code: string) {
    navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [metaAccounts, setMetaAccounts] = useState<AdAccount[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [metaError, setMetaError] = useState("");
  const [metaPixels, setMetaPixels] = useState<{ id: string; name: string }[]>([]);
  const [loadingPixels, setLoadingPixels] = useState(false);
  const [pixelError, setPixelError] = useState("");

  // Global config state
  const [showGlobalConfig, setShowGlobalConfig] = useState(false);
  const [globalConfig, setGlobalConfig] = useState<AppConfig>({
    metaToken: "", metaAppId: "", metaAppSecret: "",
    anthropicApiKey: "", uazapiServer: "",
    uazapiToken: "", uazapiAdminToken: "", appBaseUrl: "", uazapiWebhookForward: "",
    googleClientId: "", googleClientSecret: "",
    masterPhone: "", masterConnectionId: "",
  });
  const [savingConfig, setSavingConfig] = useState(false);
  const [configMsg, setConfigMsg] = useState("");

  async function openGlobalConfig() {
    const res = await fetch("/api/gestor/config");
    const data = await res.json();
    setGlobalConfig(data);
    setConfigMsg("");
    setShowGlobalConfig(true);
  }

  async function saveGlobalConfig() {
    setSavingConfig(true);
    setConfigMsg("");
    try {
      const res = await fetch("/api/gestor/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(globalConfig),
      });
      if (res.ok) setConfigMsg("Salvo com sucesso!");
      else setConfigMsg("Erro ao salvar.");
    } catch {
      setConfigMsg("Erro de conexão.");
    } finally {
      setSavingConfig(false);
    }
  }

  const fetchMetaAccounts = useCallback(async () => {
    setLoadingMeta(true);
    setMetaError("");
    try {
      const res = await fetch("/api/meta/ad-accounts");
      const data = await res.json();
      if (!res.ok) { setMetaError(data.error || "Erro ao buscar contas"); return; }
      setMetaAccounts(data);
    } catch {
      setMetaError("Erro de conexão");
    } finally {
      setLoadingMeta(false);
    }
  }, []);

  const fetchMetaPixels = useCallback(async (adAccountId?: string) => {
    setLoadingPixels(true);
    setPixelError("");
    try {
      const qs = adAccountId ? `?adAccountId=${adAccountId}` : "";
      const res = await fetch(`/api/meta/pixels${qs}`);
      const data = await res.json();
      if (!res.ok) { setPixelError(data.error || "Erro ao buscar pixels"); return; }
      setMetaPixels(data);
    } catch {
      setPixelError("Erro de conexão");
    } finally {
      setLoadingPixels(false);
    }
  }, []);

  function toggleMetaAccount(acc: AdAccount) {
    setForm((f) => {
      const exists = f.adAccounts.some((a) => a.id === acc.id);
      return {
        ...f,
        adAccounts: exists
          ? f.adAccounts.filter((a) => a.id !== acc.id)
          : [...f.adAccounts, acc],
      };
    });
  }

  const empty = (): Omit<Client, "id"> & { password: string } => ({
    name: "", email: "", password: "", color: COLORS[0], cplTarget: 25, funnelType: "leads", adAccounts: [],
    tintimCode: "", tintimToken: "", tintimWebhookForward: "", pixelId: "", capiToken: "",
  });
  const [form, setForm] = useState(empty());

  function openNew() {
    setEditing(null);
    setForm(empty());
    setShowForm(true);
    setError("");
  }

  function openEdit(c: Client) {
    setEditing(c);
    setForm({ ...c, password: "" });
    setShowForm(true);
    setError("");
  }

  function addAccount() {
    setForm((f) => ({
      ...f,
      adAccounts: [...f.adAccounts, { id: "", name: "", platform: "meta" }],
    }));
  }

  function updateAccount(i: number, field: keyof AdAccount, value: string) {
    setForm((f) => {
      const accs = [...f.adAccounts];
      accs[i] = { ...accs[i], [field]: value };
      return { ...f, adAccounts: accs };
    });
  }

  function removeFormAccount(i: number) {
    setForm((f) => ({ ...f, adAccounts: f.adAccounts.filter((_, idx) => idx !== i) }));
  }

  async function save() {
    setError("");
    setSaving(true);
    try {
      const url = editing ? `/api/gestor/clients/${editing.id}` : "/api/gestor/clients";
      const method = editing ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Erro ao salvar"); return; }
      router.refresh();
      setShowForm(false);
      const updated = await fetch("/api/gestor/clients").then((r) => r.json());
      setClients(updated);
    } catch {
      setError("Erro de conexão");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Remover este cliente e todas as contas dele?")) return;
    await fetch(`/api/gestor/clients/${id}`, { method: "DELETE" });
    setClients((prev) => prev.filter((c) => c.id !== id));
  }

  async function removeAccount(clientId: string, accountId: string) {
    const client = clients.find((c) => c.id === clientId);
    if (!client) return;
    const updated = { ...client, adAccounts: client.adAccounts.filter((a) => a.id !== accountId) };
    await fetch(`/api/gestor/clients/${clientId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    });
    setClients((prev) => prev.map((c) => (c.id === clientId ? updated : c)));
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Configurações</h1>
          <p className="text-sm text-slate-500 mt-1">Gerencie clientes e contas de anúncio</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={openGlobalConfig}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition flex items-center gap-2"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            APIs & Tokens
          </button>
          <button
            onClick={openNew}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition"
          >
            + Novo cliente
          </button>
        </div>
      </div>

      {/* Client list */}
      <div className="space-y-3">
        {clients.map((c) => (
          <div key={c.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm flex items-center gap-4">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg font-bold text-white"
              style={{ backgroundColor: c.color }}
            >
              {c.name.charAt(0)}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-semibold text-slate-900">{c.name}</p>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                  {FUNNEL_OPTIONS.find(f => f.value === c.funnelType)?.icon} {FUNNEL_OPTIONS.find(f => f.value === c.funnelType)?.label ?? "Leads"}
                </span>
                {c.tintimCode && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 font-medium">
                    Tintim ativo
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-500">{c.email}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {c.adAccounts.map((a) => (
                  <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 pl-2 pr-1 py-0.5 text-xs text-slate-600">
                    {a.platform === "meta" ? "📘" : "🔵"} {a.name}
                    <button
                      onClick={() => removeAccount(c.id, a.id)}
                      title="Remover conta"
                      className="ml-0.5 rounded-full hover:bg-red-100 hover:text-red-600 p-0.5 transition"
                    >
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={() => setPixelClient(c)} className="rounded-lg border border-purple-200 px-3 py-1.5 text-sm text-purple-600 hover:bg-purple-50 transition" title="Código do pixel de rastreamento">
                📊 Pixel
              </button>
              <button onClick={() => openEdit(c)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 transition">
                Editar
              </button>
              <button onClick={() => remove(c.id)} className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 transition">
                Remover
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Modal Pixel de Rastreamento */}
      {pixelClient && (() => {
        const base = appBaseUrl || (typeof window !== "undefined" ? window.location.origin : "");
        const scriptUrl = `${base}/api/pixel/${pixelClient.id}`;
        const embedCode = `<script src="${scriptUrl}" async></script>`;
        const manualExample = `<script>\n  // Identificar lead manualmente após submit de form\n  _tp.identify("5544999991234", { name: "Nome", email: "email@ex.com" });\n\n  // Evento personalizado\n  _tp.track("Agendamento", { value: 150 });\n</script>`;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPixelClient(null)}>
            <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl overflow-y-auto max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
              <div className="border-b border-slate-100 px-6 py-4 flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-slate-900">📊 Pixel de Rastreamento — {pixelClient.name}</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Cole no site do cliente para rastrear leads e UTMs</p>
                </div>
                <button onClick={() => setPixelClient(null)} className="text-slate-400 hover:text-slate-600">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="p-6 space-y-5">

                {/* Código de instalação */}
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-slate-700">1. Cole logo após o início da tag <code className="text-purple-600 bg-purple-50 px-1 rounded">&lt;body&gt;</code></p>
                  <div className="relative rounded-xl bg-slate-900 p-4">
                    <pre className="text-xs text-green-400 font-mono overflow-x-auto whitespace-pre-wrap break-all">{embedCode}</pre>
                    <button
                      onClick={() => copyPixelCode(embedCode)}
                      className="absolute top-2 right-2 rounded-lg bg-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-600 transition"
                    >
                      {copied ? "✓ Copiado" : "Copiar"}
                    </button>
                  </div>
                </div>

                {/* O que rastreia */}
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                  <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">O que é rastreado automaticamente</p>
                  {[
                    ["📄 Page View", "Cada visita ao site, com URL e UTMs"],
                    ["💬 Click no WhatsApp", "Qualquer link wa.me — cria lead no CRM com UTMs"],
                    ["📝 Formulários", "Forms com campo de telefone — cria lead com dados e UTMs"],
                    ["🔗 UTMs / fbclid / gclid", "Capturados da URL e vinculados ao lead"],
                  ].map(([icon, desc]) => (
                    <div key={icon} className="flex items-start gap-2">
                      <span className="text-sm shrink-0">{icon}</span>
                      <p className="text-xs text-slate-600">{desc}</p>
                    </div>
                  ))}
                </div>

                {/* API manual */}
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-slate-700">2. API manual (opcional)</p>
                  <div className="rounded-xl bg-slate-900 p-4">
                    <pre className="text-xs text-blue-300 font-mono overflow-x-auto whitespace-pre-wrap">{manualExample}</pre>
                  </div>
                </div>

                {/* URL do script */}
                <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
                  <p className="text-xs text-blue-500 font-mono break-all">{scriptUrl}</p>
                </div>
              </div>
              <div className="border-t border-slate-100 px-6 py-4 flex justify-end">
                <button onClick={() => setPixelClient(null)} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition">Fechar</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Global config modal */}
      {showGlobalConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl overflow-y-auto max-h-[90vh]">
            <div className="border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">APIs & Tokens</h2>
              <button onClick={() => setShowGlobalConfig(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-5">

              {/* Meta */}
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">📘 Meta Ads</p>
                  {globalConfig.metaAppId && globalConfig.metaAppSecret && globalConfig.appBaseUrl && (
                    <a
                      href="/api/meta/oauth/start"
                      className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 transition"
                    >
                      Conectar com Meta →
                    </a>
                  )}
                </div>
                <Field
                  label="App ID"
                  value={globalConfig.metaAppId}
                  onChange={(v) => setGlobalConfig((c) => ({ ...c, metaAppId: v }))}
                  placeholder="304558836707"
                />
                <SecretField
                  label="App Secret"
                  value={globalConfig.metaAppSecret}
                  onChange={(v) => setGlobalConfig((c) => ({ ...c, metaAppSecret: v }))}
                  placeholder="abc123..."
                />
                <SecretField
                  label="Access Token (preenchido automaticamente pelo OAuth)"
                  value={globalConfig.metaToken}
                  onChange={(v) => setGlobalConfig((c) => ({ ...c, metaToken: v }))}
                  placeholder="EAAxxxxxxx..."
                />
                {globalConfig.metaToken && (
                  <p className="text-xs text-blue-600">Token configurado. Salve e clique em &quot;Conectar com Meta&quot; para renovar.</p>
                )}
                {(!globalConfig.metaAppId || !globalConfig.metaAppSecret || !globalConfig.appBaseUrl) && (
                  <p className="text-xs text-blue-500">Preencha App ID, App Secret e URL da Plataforma (abaixo) para habilitar o botão OAuth.</p>
                )}
              </div>

              {/* Anthropic */}
              <div className="rounded-xl border border-purple-200 bg-purple-50 p-4 space-y-3">
                <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide">🤖 Anthropic (IA)</p>
                <SecretField
                  label="API Key"
                  value={globalConfig.anthropicApiKey}
                  onChange={(v) => setGlobalConfig((c) => ({ ...c, anthropicApiKey: v }))}
                  placeholder="sk-ant-..."
                />
              </div>

              {/* UazAPI / WhatsApp */}
              <div className="rounded-xl border border-green-200 bg-green-50 p-4 space-y-3">
                <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">💬 WhatsApp (UazAPI)</p>
                <Field
                  label="Servidor"
                  value={globalConfig.uazapiServer}
                  onChange={(v) => setGlobalConfig((c) => ({ ...c, uazapiServer: v }))}
                  placeholder="https://nexopro.uazapi.com"
                />
                <SecretField
                  label="Token (instância padrão)"
                  value={globalConfig.uazapiToken}
                  onChange={(v) => setGlobalConfig((c) => ({ ...c, uazapiToken: v }))}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                />
                <SecretField
                  label="Token Admin (criar instâncias)"
                  value={globalConfig.uazapiAdminToken}
                  onChange={(v) => setGlobalConfig((c) => ({ ...c, uazapiAdminToken: v }))}
                  placeholder="Token de administrador do servidor UazAPI"
                />
                <Field
                  label="Webhook forward (opcional)"
                  value={globalConfig.uazapiWebhookForward}
                  onChange={(v) => setGlobalConfig((c) => ({ ...c, uazapiWebhookForward: v }))}
                  placeholder="https://... (n8n ou outro)"
                />
              </div>

              {/* Número Master */}
              <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 space-y-3">
                <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide">📱 Número Master (notificações do sistema)</p>
                <p className="text-xs text-slate-500">
                  O número master <strong>recebe</strong> todas as notificações da plataforma (briefings, automações, alertas).
                  A conexão master é a instância WhatsApp que <strong>envia</strong> essas mensagens.
                </p>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Seu número (com DDI, só dígitos)</label>
                  <input
                    type="tel"
                    value={globalConfig.masterPhone}
                    onChange={(e) => setGlobalConfig((c) => ({ ...c, masterPhone: e.target.value.replace(/\D/g, "") }))}
                    placeholder="5511999999999"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-orange-400 focus:ring-1 focus:ring-orange-200 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Conexão WhatsApp que envia notificações</label>
                  {allConnections && allConnections.length > 0 ? (
                    <select
                      value={globalConfig.masterConnectionId}
                      onChange={(e) => setGlobalConfig((c) => ({ ...c, masterConnectionId: e.target.value }))}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-orange-400 focus:ring-1 focus:ring-orange-200 outline-none"
                    >
                      <option value="">— Selecione uma conexão —</option>
                      {allConnections.map((conn) => (
                        <option key={conn.id} value={conn.id}>
                          {conn.phone || conn.id} ({conn.funnelName})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      Nenhuma conexão WhatsApp (UazAPI) encontrada. Adicione uma conexão em um funil de cliente primeiro.
                    </p>
                  )}
                </div>
                {globalConfig.masterPhone && globalConfig.masterConnectionId && (
                  <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                    ✓ Número master configurado. Notificações serão enviadas via a conexão selecionada.
                  </p>
                )}
              </div>

              {/* Google Calendar OAuth */}
              <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 space-y-3">
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">📅 Google Calendar (OAuth)</p>
                <p className="text-xs text-slate-500">Crie um projeto no <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="underline text-blue-600">Google Cloud Console</a>, ative a API Calendar e crie credenciais OAuth 2.0 do tipo &quot;Aplicativo da Web&quot;. Cole o Client ID e Secret abaixo.</p>
                <Field
                  label="Client ID"
                  value={globalConfig.googleClientId}
                  onChange={(v) => setGlobalConfig((c) => ({ ...c, googleClientId: v }))}
                  placeholder="xxxx.apps.googleusercontent.com"
                />
                <Field
                  label="Client Secret"
                  type="password"
                  value={globalConfig.googleClientSecret}
                  onChange={(v) => setGlobalConfig((c) => ({ ...c, googleClientSecret: v }))}
                  placeholder="GOCSPX-..."
                />
                {globalConfig.googleClientId && globalConfig.googleClientSecret && (
                  <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                    ✓ Credenciais salvas. Adicione como URI de redirecionamento autorizado no Console Google:<br />
                    <span className="font-mono break-all">{globalConfig.appBaseUrl || "https://sua-url"}/api/agent/google-auth/callback</span>
                  </p>
                )}
              </div>

              {/* App URL */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">🌐 URL da Plataforma</p>
                <Field
                  label="URL base pública"
                  value={globalConfig.appBaseUrl}
                  onChange={(v) => setGlobalConfig((c) => ({ ...c, appBaseUrl: v }))}
                  placeholder="https://whatsappmonitor-trafegopago.ztcjzs.easypanel.host"
                />
              </div>

              {configMsg && (
                <p className={clsx("rounded-lg px-3 py-2 text-sm text-center font-medium",
                  configMsg.includes("sucesso") ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-600 border border-red-200"
                )}>{configMsg}</p>
              )}
            </div>
            <div className="border-t border-slate-100 px-6 py-4 flex justify-end gap-3">
              <button onClick={() => setShowGlobalConfig(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 transition">
                Fechar
              </button>
              <button onClick={saveGlobalConfig} disabled={savingConfig} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 transition">
                {savingConfig ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl overflow-y-auto max-h-[90vh]">
            <div className="border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">
                {editing ? "Editar cliente" : "Novo cliente"}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-4">
              <Field label="Nome" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="Nome do cliente" />
              <Field label="E-mail de acesso" type="email" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} placeholder="cliente@email.com" />
              <Field label={editing ? "Nova senha (deixe vazio para manter)" : "Senha"} type="password" value={form.password} onChange={(v) => setForm((f) => ({ ...f, password: v }))} placeholder="••••••••" />

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">CPL alvo (R$)</label>
                  <input
                    type="number"
                    value={form.cplTarget}
                    onChange={(e) => setForm((f) => ({ ...f, cplTarget: Number(e.target.value) }))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Cor</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {COLORS.map((color) => (
                      <button
                        key={color}
                        onClick={() => setForm((f) => ({ ...f, color }))}
                        className={clsx("h-6 w-6 rounded-full transition", form.color === color ? "ring-2 ring-offset-1 ring-slate-400" : "")}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Funnel type */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Tipo de funil</label>
                <div className="grid grid-cols-3 gap-2">
                  {FUNNEL_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, funnelType: opt.value }))}
                      className={clsx(
                        "rounded-lg border p-2.5 text-left transition text-xs",
                        form.funnelType === opt.value
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-slate-200 hover:border-slate-300 text-slate-600"
                      )}
                    >
                      <div className="text-base mb-1">{opt.icon}</div>
                      <div className="font-semibold">{opt.label}</div>
                      <div className="text-slate-400 mt-0.5">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Ad accounts */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-slate-700">Contas de anúncio</label>
                </div>

                {/* Meta accounts picker */}
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 mb-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-blue-700">📘 Contas Meta</span>
                    <button
                      type="button"
                      onClick={fetchMetaAccounts}
                      disabled={loadingMeta}
                      className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60 transition"
                    >
                      {loadingMeta ? "Buscando..." : metaAccounts.length > 0 ? "Atualizar" : "Buscar contas"}
                    </button>
                  </div>
                  {metaError && <p className="text-xs text-red-600 mb-2">{metaError}</p>}
                  {metaAccounts.length > 0 && (
                    <div className="space-y-1.5 max-h-40 overflow-y-auto">
                      {metaAccounts.map((acc) => {
                        const selected = form.adAccounts.some((a) => a.id === acc.id);
                        return (
                          <button
                            key={acc.id}
                            type="button"
                            onClick={() => toggleMetaAccount(acc)}
                            className={clsx(
                              "w-full flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition",
                              selected
                                ? "border-blue-500 bg-white text-blue-700 font-semibold"
                                : "border-blue-200 bg-white/60 text-slate-600 hover:bg-white"
                            )}
                          >
                            <span className={clsx("h-4 w-4 rounded flex items-center justify-center border text-white shrink-0", selected ? "bg-blue-600 border-blue-600" : "border-slate-300")}>
                              {selected && <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                            </span>
                            <span className="truncate flex-1">{acc.name}</span>
                            <span className="text-slate-400 font-mono shrink-0">{acc.id}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {metaAccounts.length === 0 && !loadingMeta && !metaError && (
                    <p className="text-xs text-blue-500">Clique em "Buscar contas" para ver as contas disponíveis no seu token Meta.</p>
                  )}
                </div>

                {/* Google accounts manual */}
                <div className="rounded-xl border border-orange-200 bg-orange-50 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-orange-700">🔵 Contas Google (manual)</span>
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, adAccounts: [...f.adAccounts, { id: "", name: "", platform: "google" }] }))}
                      className="text-xs text-orange-600 hover:underline"
                    >
                      + Adicionar
                    </button>
                  </div>
                  <div className="space-y-2">
                    {form.adAccounts.filter((a) => a.platform === "google").map((acc) => {
                      const i = form.adAccounts.indexOf(acc);
                      return (
                        <div key={i} className="flex gap-2 items-center">
                          <input
                            value={acc.name}
                            onChange={(e) => updateAccount(i, "name", e.target.value)}
                            placeholder="Nome da conta"
                            className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-blue-500 bg-white"
                          />
                          <input
                            value={acc.id}
                            onChange={(e) => updateAccount(i, "id", e.target.value)}
                            placeholder="123-456-7890"
                            className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-mono outline-none focus:border-blue-500 bg-white"
                          />
                          <button onClick={() => removeFormAccount(i)} className="text-red-400 hover:text-red-600">
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      );
                    })}
                    {form.adAccounts.filter((a) => a.platform === "google").length === 0 && (
                      <p className="text-xs text-orange-500">Nenhuma conta Google adicionada.</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Tintim */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
                <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Tintim (opcional)</p>
                <Field
                  label="Código do cliente"
                  value={form.tintimCode ?? ""}
                  onChange={(v) => setForm((f) => ({ ...f, tintimCode: v }))}
                  placeholder="e8a7482a-87f4-4f50-..."
                />
                <Field
                  label="Token de segurança"
                  value={form.tintimToken ?? ""}
                  onChange={(v) => setForm((f) => ({ ...f, tintimToken: v }))}
                  placeholder="q9ifPiV3gfs92D-..."
                />
                <Field
                  label="URL original do webhook (proxy)"
                  value={form.tintimWebhookForward ?? ""}
                  onChange={(v) => setForm((f) => ({ ...f, tintimWebhookForward: v }))}
                  placeholder="https://... (URL que estava configurada antes)"
                />
                {editing && (form.tintimCode || editing.tintimCode) && (
                  <div className="rounded-lg bg-white border border-emerald-200 px-3 py-2 space-y-1">
                    <p className="text-xs font-medium text-slate-600">Substitua o webhook no Tintim por esta URL:</p>
                    <code className="text-xs text-emerald-700 break-all block">
                      /api/tintim/webhook?clientId={editing.id}
                    </code>
                    {(form.tintimWebhookForward || editing.tintimWebhookForward) && (
                      <p className="text-xs text-slate-400">
                        O payload sera reencaminhado automaticamente para a URL original.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Meta Pixel + CAPI */}
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">📊 Meta Pixel + CAPI</p>
                  <button
                    type="button"
                    onClick={() => {
                      const firstMeta = form.adAccounts.find((a) => a.platform === "meta")?.id;
                      fetchMetaPixels(firstMeta);
                    }}
                    disabled={loadingPixels}
                    className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60 transition"
                  >
                    {loadingPixels ? "Buscando..." : metaPixels.length > 0 ? "Atualizar" : "Buscar pixels"}
                  </button>
                </div>

                {pixelError && <p className="text-xs text-red-600">{pixelError}</p>}

                {metaPixels.length > 0 && (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {metaPixels.map((px) => {
                      const selected = form.pixelId === px.id;
                      return (
                        <button
                          key={px.id}
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, pixelId: px.id }))}
                          className={clsx(
                            "w-full flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition",
                            selected
                              ? "border-blue-500 bg-white text-blue-700 font-semibold"
                              : "border-blue-200 bg-white/60 text-slate-600 hover:bg-white"
                          )}
                        >
                          <span className={clsx("h-4 w-4 rounded flex items-center justify-center border text-white shrink-0", selected ? "bg-blue-600 border-blue-600" : "border-slate-300")}>
                            {selected && <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                          </span>
                          <span className="truncate flex-1">{px.name}</span>
                          <span className="text-slate-400 font-mono shrink-0">{px.id}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {metaPixels.length === 0 && !loadingPixels && (
                  <Field
                    label="Pixel ID (manual)"
                    value={form.pixelId ?? ""}
                    onChange={(v) => setForm((f) => ({ ...f, pixelId: v }))}
                    placeholder="123456789012345"
                  />
                )}

                {form.pixelId && (
                  <div className="flex items-center gap-2 rounded-lg bg-white border border-blue-200 px-3 py-2">
                    <svg className="h-4 w-4 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    <div>
                      <p className="text-xs font-medium text-blue-700">Pixel selecionado: {form.pixelId}</p>
                      <p className="text-[10px] text-slate-400">Eventos disparados via Pixel (browser) + CAPI (servidor)</p>
                    </div>
                    <button onClick={() => setForm((f) => ({ ...f, pixelId: "" }))} className="ml-auto text-slate-300 hover:text-red-500 text-xs">✕</button>
                  </div>
                )}

                <SecretField
                  label="Token de Conversão da API"
                  value={form.capiToken ?? ""}
                  onChange={(v) => setForm((f) => ({ ...f, capiToken: v }))}
                  placeholder="EAAxxxxxxx..."
                />
                <p className="text-[10px] text-blue-400">
                  Gerado em Gerenciador de Eventos → Fontes de Dados → seu Pixel → Configurações → Gerar token de acesso.
                  Se não preenchido, usa o token global de APIs &amp; Tokens.
                </p>
              </div>

              {error && (
                <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">{error}</p>
              )}
            </div>

            <div className="border-t border-slate-100 px-6 py-4 flex justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 transition">
                Cancelar
              </button>
              <button onClick={save} disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 transition">
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, type = "text",
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition"
      />
    </div>
  );
}

function SecretField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 pr-10 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition font-mono"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
        >
          {show
            ? <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21" /></svg>
            : <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
          }
        </button>
      </div>
    </div>
  );
}
