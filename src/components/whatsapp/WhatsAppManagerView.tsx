"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { EnrichedInstance } from "@/app/api/whatsapp/manager/route";

type FunnelOption = { id: string; name: string; clientId: string | null };
type ClientOption = {
  id: string; name: string; color: string; agentEnabled: boolean; agentConnectionId: string | null;
  agents?: { name?: string; whatsappConnectionId?: string; isOrphaned?: boolean }[];
};

/** Select pra reaproveitar a config de um agente órfão (de uma instância antiga
 *  excluída/substituída) numa conexão nova, em vez de criar uma config em branco. */
function ReuseAgentSelect({ clients, clientId, value, onChange, accentColor = "green" }: {
  clients: ClientOption[];
  clientId: string;
  value: string;
  onChange: (v: string) => void;
  accentColor?: "green" | "blue" | "violet";
}) {
  const orphaned = (clients.find(c => c.id === clientId)?.agents ?? []).filter(a => a.isOrphaned && a.whatsappConnectionId);
  if (orphaned.length === 0) return null;
  return (
    <div className="mb-2">
      <label className="block text-xs font-medium text-slate-500 mb-1">Reaproveitar configuração de um agente antigo?</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-${accentColor}-400`}
      >
        <option value="">— Criar configuração nova —</option>
        {orphaned.map(a => (
          <option key={a.whatsappConnectionId} value={a.whatsappConnectionId}>
            {a.name?.trim() || "Agente sem nome"}
          </option>
        ))}
      </select>
    </div>
  );
}

function ClientAgentSelect({ clients, value, onChange, accentColor = "green" }: {
  clients: ClientOption[];
  value: string;
  onChange: (v: string) => void;
  accentColor?: "green" | "blue";
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-${accentColor}-400 mb-2`}
    >
      <option value="">— Sem agente —</option>
      {clients.filter(c => (c.agents ?? []).length > 0).map(c => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
    </select>
  );
}

function ClientFunnelSelect({ clients, funnels, value, onChange, accentColor = "green" }: {
  clients: ClientOption[];
  funnels: FunnelOption[];
  value: string;
  onChange: (v: string) => void;
  accentColor?: "green" | "blue";
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-${accentColor}-400`}
    >
      <option value="">— Sem vínculo —</option>
      {clients.map(c => {
        const clientFunnels = funnels.filter(f => f.clientId === c.id);
        return (
          <optgroup key={c.id} label={c.name}>
            {clientFunnels.length > 0
              ? clientFunnels.map(f => (
                  <option key={f.id} value={f.id}>{c.name} — {f.name}</option>
                ))
              : <option value={`auto:${c.id}`}>Funil Principal (criar automaticamente)</option>
            }
          </optgroup>
        );
      })}
    </select>
  );
}

// ── Modal states ─────────────────────────────────────────────────
type ModalState =
  | { type: "none" }
  // Criar: stepper em 3 fases dentro do mesmo modal
  | { type: "create"; stage: "name" }
  | { type: "create"; stage: "creating" }
  | { type: "create"; stage: "created"; token: string; instanceName: string; webhookSaved: boolean }
  // QR: abre depois de "created" ou pelo botão do card
  | { type: "qr"; token: string; instanceName: string; forceLogout: boolean }
  // Webhook
  | { type: "webhook"; token: string; instanceName: string }
  // Enviar
  | { type: "send"; token?: string }
  // Vincular
  | { type: "link"; token: string; instanceName: string; instancePhone: string };

export function WhatsAppManagerView({
  funnels,
  clients,
  appWebhookUrl,
}: {
  funnels: FunnelOption[];
  clients: ClientOption[];
  appWebhookUrl: string;
}) {
  const [instances, setInstances] = useState<EnrichedInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalState>({ type: "none" });

  // Create
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState("");

  // QR
  const [qrStage, setQrStage] = useState<"logout" | "generating" | "scanning" | "done">("generating");
  const [qrImage, setQrImage] = useState<string | null>(null);
  const qrTokenRef = useRef<string>("");

  // Pairing code
  const [connectTab, setConnectTab] = useState<"qr" | "code">("qr");
  const [pairingPhone, setPairingPhone] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [generatingCode, setGeneratingCode] = useState(false);

  // Webhook
  const [webhookUrl, setWebhookUrl] = useState(appWebhookUrl);
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [webhookCopied, setWebhookCopied] = useState(false);
  const [webhookSaved, setWebhookSaved] = useState(false);

  // Send
  const [sendToken, setSendToken] = useState("");
  const [sendPhone, setSendPhone] = useState("");
  const [sendType, setSendType] = useState<"text" | "image" | "audio" | "video">("text");
  const [sendContent, setSendContent] = useState("");
  const [sendCaption, setSendCaption] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<boolean | null>(null);

  // Link
  const [linkFunnelId, setLinkFunnelId] = useState<string>("");
  const [linkClientId, setLinkClientId] = useState<string>("");
  const [linkAgent, setLinkAgent] = useState(false);
  const [savingLink, setSavingLink] = useState(false);

  // Delete confirm
  const [deletingToken, setDeletingToken] = useState<string | null>(null);

  // Main tab
  const [mainTab, setMainTab] = useState<"uazapi" | "wppconnect" | "meta">("uazapi");

  const fetchInstances = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/manager");
      if (res.ok) setInstances(await res.json());
    } catch { /**/ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInstances();
    const t = setInterval(fetchInstances, 10000);
    return () => clearInterval(t);
  }, [fetchInstances]);

  // ── QR polling ────────────────────────────────────────────────
  // qrShownRef: rastreia se QR chegou a ser exibido (para fechar só após escanear)
  const qrShownRef = useRef(false);

  useEffect(() => {
    if (modal.type !== "qr") return;

    const token = modal.token;
    const forceLogout = modal.forceLogout;
    qrTokenRef.current = token;
    qrShownRef.current = false;
    setQrImage(null);
    setQrStage(forceLogout ? "logout" : "generating");
    setPairingCode(null);
    setPairingPhone("");
    setConnectTab("qr");

    let poll: ReturnType<typeof setInterval>;
    let alive = true;

    const startPolling = () => {
      // Polling de status a cada 3s — atualiza QR se o servidor retornar um novo
      // NÃO chama /connect novamente (isso reiniciaria a sessão e quebraria o sync)
      poll = setInterval(async () => {
        if (!alive || qrTokenRef.current !== token) return;
        try {
          const res = await fetch(`/api/whatsapp/manager/${token}/status`);
          const d = await res.json() as { connected?: boolean; qr?: string | null };
          // Sempre atualiza o QR se o servidor trouxer um (pode ser refresh natural do UazAPI)
          if (d.qr) {
            setQrImage(d.qr);
            setQrStage("scanning");
            qrShownRef.current = true;
          }
          // Fecha modal apenas se QR foi exibido E agora conectado (usuário escaneou de verdade)
          if (d.connected && qrShownRef.current) {
            setQrStage("done");
            clearInterval(poll);
            alive = false;
            setTimeout(() => { setModal({ type: "none" }); fetchInstances(); }, 1500);
          }
        } catch { /**/ }
      }, 3000);
    };

    // Chama /connect UMA VEZ (com logout se solicitado) para gerar o QR inicial
    // Depois o status poll mantém o QR atualizado — sem novas chamadas a /connect
    fetch(`/api/whatsapp/manager/${token}/connect`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "qr", force: forceLogout }),
    }).then(r => r.json()).then((d: { qr?: string | null }) => {
      if (!alive) return;
      if (d.qr) {
        setQrImage(d.qr);
        setQrStage("scanning");
        qrShownRef.current = true;
      } else {
        setQrStage("generating");
      }
      startPolling();
    }).catch(() => {
      if (!alive) return;
      setQrStage("generating");
      startPolling();
    });

    return () => {
      alive = false;
      clearInterval(poll);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal.type === "qr" ? `${modal.token}-${modal.forceLogout}` : null]);

  // ── Handlers ──────────────────────────────────────────────────

  async function handleCreate() {
    if (!newName.trim()) { setCreateError("Informe um nome"); return; }
    setCreateError("");
    setModal({ type: "create", stage: "creating" });

    const res = await fetch("/api/whatsapp/manager", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    const data = await res.json();

    if (!res.ok || !data.token) {
      setModal({ type: "create", stage: "name" });
      setCreateError(data.error ?? "Erro ao criar instância no UazAPI");
      return;
    }

    setModal({ type: "create", stage: "created", token: data.token, instanceName: data.name, webhookSaved: false });
    fetchInstances();
  }

  async function handleSaveWebhookInCreate(token: string, instanceName: string) {
    setSavingWebhook(true);
    // URL usa o TOKEN UUID como identificador seguro (não o nome)
    const base = appWebhookUrl.replace(/\/api\/whatsapp\/webhook$/, "");
    const instanceWh = `${base}/api/whatsapp/webhook/${token}`;
    await fetch(`/api/whatsapp/manager/${token}/webhook`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: instanceWh }),
    }).catch(() => {});
    setSavingWebhook(false);
    setModal({ type: "create", stage: "created", token, instanceName, webhookSaved: true });
  }

  async function handleSaveWebhook() {
    if (modal.type !== "webhook") return;
    setSavingWebhook(true); setWebhookSaved(false);
    await fetch(`/api/whatsapp/manager/${modal.token}/webhook`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl }),
    });
    setSavingWebhook(false); setWebhookSaved(true);
    setTimeout(() => setWebhookSaved(false), 2500);
  }

  async function handleGenerateCode() {
    if (modal.type !== "qr" || !pairingPhone.trim()) return;
    setGeneratingCode(true); setPairingCode(null);
    const res = await fetch(`/api/whatsapp/manager/${modal.token}/connect`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "code", phone: pairingPhone, force: true }),
    });
    const data = await res.json();
    setPairingCode(data.code ?? "ERRO");
    setGeneratingCode(false);
  }

  async function handleSend() {
    if (!sendToken || !sendPhone || !sendContent) return;
    setSending(true); setSendResult(null);
    const res = await fetch("/api/whatsapp/manager/send", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: sendToken, phone: sendPhone, type: sendType, content: sendContent, caption: sendCaption }),
    });
    const data = await res.json();
    setSendResult(data.ok === true);
    if (data.ok) { setSendPhone(""); setSendContent(""); setSendCaption(""); }
    setSending(false);
  }

  async function handleLink() {
    if (modal.type !== "link") return;
    setSavingLink(true);
    await fetch("/api/whatsapp/manager/link", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceToken: modal.token, instanceName: modal.instanceName, instancePhone: modal.instancePhone, funnelId: linkFunnelId || null, clientId: linkClientId || null, linkAgent }),
    });
    setSavingLink(false); setModal({ type: "none" }); fetchInstances();
  }

  async function handleDelete(token: string) {
    setDeletingToken(null);
    await fetch(`/api/whatsapp/manager/${token}`, { method: "DELETE" });
    fetchInstances();
  }

  const connectedCount = instances.filter(i => i.status === "connected").length;
  const appBaseUrl = appWebhookUrl.replace(/\/api\/whatsapp\/webhook$/, "");

  return (
    <div>
      {/* Tabs: UazAPI | WPPConnect | API Oficial Meta */}
      <div className="border-b border-slate-200 bg-white">
        <div className="flex max-w-6xl mx-auto px-6">
          {(["uazapi", "wppconnect", "meta"] as const).map(tab => (
            <button key={tab} onClick={() => setMainTab(tab)}
              className={`py-3 px-5 text-sm font-semibold border-b-2 transition -mb-px ${
                mainTab === tab
                  ? tab === "uazapi" ? "border-green-500 text-green-700"
                  : tab === "wppconnect" ? "border-violet-500 text-violet-700"
                  : "border-blue-500 text-blue-700"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}>
              {tab === "uazapi" ? "⚡ UazAPI" : tab === "wppconnect" ? "🔌 WPPConnect" : "🏢 API Oficial Meta"}
            </button>
          ))}
        </div>
      </div>

      {mainTab === "meta" && <MetaApiView funnels={funnels} clients={clients} appBaseUrl={appBaseUrl} />}
      {mainTab === "wppconnect" && <WppConnectView funnels={funnels} clients={clients} appBaseUrl={appBaseUrl} />}
      {mainTab === "uazapi" && (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Instâncias WhatsApp</h1>
          <p className="text-sm text-slate-500 mt-0.5">Gerencie suas conexões UazAPI</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-4 py-2 shadow-sm">
            <span className={`h-2.5 w-2.5 rounded-full ${connectedCount > 0 ? "bg-green-500 animate-pulse" : "bg-slate-300"}`} />
            <span className="text-sm font-medium text-slate-700">{connectedCount} / {instances.length} conectada{instances.length !== 1 ? "s" : ""}</span>
          </div>
          <button
            onClick={() => { setNewName(""); setCreateError(""); setModal({ type: "create", stage: "name" }); }}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-xl px-4 py-2.5 transition shadow-sm"
          >
            <span className="text-lg leading-none">+</span> Nova Instância
          </button>
        </div>
      </div>

      {/* Instances */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin h-8 w-8 border-2 border-slate-200 border-t-green-500 rounded-full" />
        </div>
      ) : instances.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <span className="text-5xl mb-4">📱</span>
          <p className="text-lg font-semibold text-slate-600 mb-1">Nenhuma instância encontrada</p>
          <p className="text-sm mb-6">Crie uma nova instância UazAPI para começar</p>
          <button onClick={() => { setNewName(""); setCreateError(""); setModal({ type: "create", stage: "name" }); }}
            className="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-xl px-5 py-2.5 transition">
            + Nova Instância
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {instances.map(inst => (
            <InstanceCard key={inst.token} inst={inst}
              deletingToken={deletingToken} setDeletingToken={setDeletingToken}
              onConnect={() => setModal({ type: "qr", token: inst.token, instanceName: inst.name, forceLogout: false })}
              onForceConnect={() => setModal({ type: "qr", token: inst.token, instanceName: inst.name, forceLogout: true })}
              onWebhook={() => { setWebhookUrl(inst.instanceWebhookUrl || appWebhookUrl); setWebhookSaved(false); setModal({ type: "webhook", token: inst.token, instanceName: inst.name }); }}
              onSend={() => { setSendToken(inst.token); setSendPhone(""); setSendContent(""); setSendCaption(""); setSendType("text"); setSendResult(null); setModal({ type: "send", token: inst.token }); }}
              onLink={() => { setLinkFunnelId(inst.linkedFunnelId ?? ""); setLinkClientId(inst.linkedClientId ?? ""); setLinkAgent(inst.hasAgentLinked); setModal({ type: "link", token: inst.token, instanceName: inst.name, instancePhone: inst.phone ?? "" }); }}
              onDelete={() => handleDelete(inst.token)}
            />
          ))}
        </div>
      )}

      {/* ── MODAIS ───────────────────────────────────────────────── */}
      {modal.type !== "none" && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" onClick={() => setModal({ type: "none" })} />
      )}

      {/* CRIAR — stepper */}
      {modal.type === "create" && (
        <Modal title="Nova Instância UazAPI" onClose={() => setModal({ type: "none" })}>
          {modal.stage === "name" && (
            <>
              <p className="text-sm text-slate-500 mb-4">
                Digite um nome para identificar esta instância no UazAPI. Use letras minúsculas, números e hífens.
              </p>
              <input autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                onKeyDown={e => e.key === "Enter" && handleCreate()}
                placeholder="ex: nexo-pro, vendas, suporte"
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-green-400 focus:ring-2 focus:ring-green-100 mb-1"
              />
              {createError && <p className="text-xs text-red-500 mb-3 mt-1">{createError}</p>}
              <p className="text-xs text-slate-400 mb-4">Só letras minúsculas, números e hífens.</p>
              <div className="flex gap-2">
                <button onClick={() => setModal({ type: "none" })} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
                <button onClick={handleCreate} disabled={!newName.trim()} className="flex-1 rounded-xl bg-green-600 hover:bg-green-700 py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition">
                  Criar Instância →
                </button>
              </div>
            </>
          )}

          {modal.stage === "creating" && (
            <div className="py-8 text-center">
              <div className="animate-spin h-10 w-10 border-2 border-slate-200 border-t-green-500 rounded-full mx-auto mb-4" />
              <p className="font-semibold text-slate-700">Criando instância no UazAPI...</p>
              <p className="text-xs text-slate-400 mt-1">Aguarde</p>
            </div>
          )}

          {modal.stage === "created" && (
            <>
              <div className="bg-green-50 border border-green-200 rounded-2xl p-4 mb-5 text-center">
                <div className="text-3xl mb-2">✅</div>
                <p className="font-bold text-green-800">Instância <span className="font-mono">{modal.instanceName}</span> criada!</p>
                <p className="text-xs text-green-600 mt-1">Agora configure o webhook e conecte um número.</p>
              </div>

              {/* Passo 1: Webhook — usa o token como identificador seguro */}
              {(() => {
                // O TOKEN é o UUID da instância UazapiGO → seguro e único
                const base = appWebhookUrl.replace(/\/api\/whatsapp\/webhook$/, "");
                const instanceWh = `${base}/api/whatsapp/webhook/${modal.token}`;
                return (
                  <div className="rounded-xl border border-slate-200 p-4 mb-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-semibold text-slate-700">🔗 1. Configurar Webhook</p>
                      {modal.webhookSaved && <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">✓ Salvo</span>}
                    </div>
                    <div className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2 mb-1">
                      <p className="text-xs text-slate-600 font-mono flex-1 break-all">{instanceWh}</p>
                      <button onClick={() => navigator.clipboard.writeText(instanceWh).catch(() => {})}
                        className="text-xs text-blue-600 font-semibold whitespace-nowrap hover:text-blue-800">Copiar</button>
                    </div>
                    <p className="text-xs text-slate-400 mb-3">🔒 O token UUID é a autenticação — impossível de adivinhar</p>
                    <button
                      onClick={() => handleSaveWebhookInCreate(modal.token, modal.instanceName)}
                      disabled={savingWebhook || modal.webhookSaved}
                      className={`w-full rounded-xl py-2 text-sm font-semibold transition ${modal.webhookSaved ? "bg-green-100 text-green-700 cursor-default" : "bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"}`}
                    >
                      {savingWebhook ? "Salvando..." : modal.webhookSaved ? "✓ Webhook configurado" : "Salvar Webhook no UazAPI"}
                    </button>
                  </div>
                );
              })()}

              {/* Passo 2: Conectar */}
              <div className="rounded-xl border border-slate-200 p-4">
                <p className="text-sm font-semibold text-slate-700 mb-2">📱 2. Conectar WhatsApp</p>
                <p className="text-xs text-slate-400 mb-3">Escaneie o QR Code com o WhatsApp para vincular um número.</p>
                <button
                  onClick={() => setModal({ type: "qr", token: modal.token, instanceName: modal.instanceName, forceLogout: true })}
                  className="w-full rounded-xl bg-green-600 hover:bg-green-700 py-2.5 text-sm font-semibold text-white transition"
                >
                  📷 Gerar QR Code e Conectar
                </button>
              </div>
            </>
          )}
        </Modal>
      )}

      {/* QR / Código de pareamento */}
      {modal.type === "qr" && (
        <Modal title={`Conectar — ${modal.instanceName}`} onClose={() => setModal({ type: "none" })} wide>
          {/* Tabs */}
          <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-5">
            {(["qr", "code"] as const).map(tab => (
              <button key={tab} onClick={() => setConnectTab(tab)}
                className={`flex-1 py-2 text-sm font-semibold rounded-lg transition ${connectTab === tab ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>
                {tab === "qr" ? "📷 QR Code" : "🔢 Código de Pareamento"}
              </button>
            ))}
          </div>

          {connectTab === "qr" && (
            <div className="text-center">
              {qrStage === "done" ? (
                <div className="py-6">
                  <div className="text-5xl mb-2">✅</div>
                  <p className="font-bold text-green-700 text-lg">Conectado com sucesso!</p>
                </div>
              ) : qrImage ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrImage} alt="QR Code" className="w-64 h-64 mx-auto rounded-2xl border-4 border-green-100 shadow-md mb-3" />
                  <p className="text-sm font-medium text-slate-700 mb-1">Abra o WhatsApp → <strong>Aparelhos Conectados</strong> → <strong>Vincular</strong></p>
                  <p className="text-xs text-slate-400">Atualiza automaticamente a cada 25s</p>
                </>
              ) : (
                <div className="w-64 h-64 mx-auto rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center mb-3 gap-3">
                  <div className={`animate-spin h-8 w-8 border-2 rounded-full ${qrStage === "logout" ? "border-amber-200 border-t-amber-500" : "border-slate-200 border-t-green-500"}`} />
                  <p className="text-xs text-slate-400 px-4">
                    {qrStage === "logout" ? "Fazendo logout para gerar novo QR..." : "Gerando QR Code..."}
                  </p>
                </div>
              )}
              {qrStage !== "done" && (
                <div className="flex items-center justify-center gap-2 mt-3">
                  <span className={`h-2 w-2 rounded-full ${qrImage ? "bg-yellow-400 animate-pulse" : "bg-slate-300"}`} />
                  <span className="text-xs text-slate-500">
                    {qrImage ? "Aguardando scan..." : qrStage === "logout" ? "Fazendo logout..." : "Gerando QR..."}
                  </span>
                </div>
              )}
            </div>
          )}

          {connectTab === "code" && (
            <div>
              <p className="text-sm text-slate-600 mb-3">Insira o número que será conectado. Um código de 8 dígitos será enviado.</p>
              <div className="flex gap-2 mb-4">
                <input value={pairingPhone} onChange={e => setPairingPhone(e.target.value)}
                  placeholder="5544999999999 (com DDI)"
                  className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-green-400" />
                <button onClick={handleGenerateCode} disabled={generatingCode || !pairingPhone.trim()}
                  className="rounded-xl bg-green-600 hover:bg-green-700 px-4 text-sm font-semibold text-white disabled:opacity-50 transition whitespace-nowrap">
                  {generatingCode ? "..." : "Gerar"}
                </button>
              </div>
              {pairingCode && pairingCode !== "ERRO" && (
                <div className="bg-green-50 border border-green-200 rounded-2xl p-5 text-center">
                  <p className="text-xs text-green-600 font-semibold mb-2 uppercase tracking-wide">Código de Pareamento</p>
                  <p className="font-mono text-4xl font-bold tracking-[0.3em] text-green-700">{pairingCode}</p>
                  <p className="text-xs text-green-600 mt-2">WhatsApp → Aparelhos Conectados → Vincular com número</p>
                </div>
              )}
              {pairingCode === "ERRO" && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-600">
                  Não foi possível gerar o código. Tente o QR Code.
                </div>
              )}
            </div>
          )}
        </Modal>
      )}

      {/* Webhook */}
      {modal.type === "webhook" && (
        <Modal title={`Webhook — ${modal.instanceName}`} onClose={() => setModal({ type: "none" })}>
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-4">
            <p className="text-xs font-semibold text-blue-700 mb-1">📌 URL exclusiva desta instância</p>
            <p className="text-xs text-blue-600">Configure esta URL no UazapiGO para que as mensagens desta instância criem leads no CRM e ativem o Agente IA do cliente vinculado.</p>
          </div>
          <div className="relative mb-2">
            <input value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-mono outline-none focus:border-green-400 pr-20" />
            <button onClick={async () => { await navigator.clipboard.writeText(webhookUrl).catch(() => {}); setWebhookCopied(true); setTimeout(() => setWebhookCopied(false), 2000); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-blue-600 px-2 py-1 rounded">
              {webhookCopied ? "✓ Copiado!" : "Copiar"}
            </button>
          </div>
          <p className="text-xs text-slate-400 mb-4">Salva esta URL no UazapiGO e habilita eventos de mensagem.</p>
          <div className="flex gap-2">
            <button onClick={() => setModal({ type: "none" })} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">Fechar</button>
            <button onClick={handleSaveWebhook} disabled={savingWebhook}
              className={`flex-1 rounded-xl py-2.5 text-sm font-semibold text-white transition ${webhookSaved ? "bg-green-500" : "bg-blue-600 hover:bg-blue-700"} disabled:opacity-50`}>
              {savingWebhook ? "Salvando..." : webhookSaved ? "✓ Salvo!" : "Salvar no UazAPI"}
            </button>
          </div>
        </Modal>
      )}

      {/* Enviar */}
      {modal.type === "send" && (
        <Modal title="Enviar Mensagem" onClose={() => setModal({ type: "none" })} wide>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Instância</label>
              <select value={sendToken} onChange={e => setSendToken(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-green-400">
                {instances.filter(i => i.status === "connected").map(i => (
                  <option key={i.token} value={i.token}>{i.name}{i.phone ? ` (+${i.phone})` : ""}</option>
                ))}
                {instances.filter(i => i.status !== "connected").map(i => (
                  <option key={i.token} value={i.token}>{i.name} (desconectada)</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Destinatário</label>
              <input value={sendPhone} onChange={e => setSendPhone(e.target.value)}
                placeholder="5544999999999" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-green-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Tipo</label>
              <div className="flex gap-2">
                {(["text", "image", "audio", "video"] as const).map(t => (
                  <button key={t} onClick={() => setSendType(t)}
                    className={`flex-1 py-2 text-xs font-semibold rounded-xl border transition ${sendType === t ? "border-green-500 bg-green-600 text-white" : "border-slate-200 text-slate-600"}`}>
                    {t === "text" ? "💬 Texto" : t === "image" ? "🖼️" : t === "audio" ? "🎵" : "🎬"}
                  </button>
                ))}
              </div>
            </div>
            {sendType === "text" ? (
              <textarea value={sendContent} onChange={e => setSendContent(e.target.value)}
                placeholder="Mensagem..." rows={4}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-green-400 resize-none" />
            ) : (
              <input value={sendContent} onChange={e => setSendContent(e.target.value)}
                placeholder="URL do arquivo" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-green-400" />
            )}
            {sendResult !== null && (
              <div className={`rounded-xl px-4 py-2.5 text-sm font-medium ${sendResult ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
                {sendResult ? "✅ Enviado!" : "❌ Falha ao enviar."}
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={() => setModal({ type: "none" })} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">Fechar</button>
              <button onClick={handleSend} disabled={sending || !sendToken || !sendPhone || !sendContent}
                className="flex-1 rounded-xl bg-green-600 hover:bg-green-700 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                {sending ? "Enviando..." : "Enviar"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Vincular */}
      {modal.type === "link" && (
        <Modal title={`Vincular — ${modal.instanceName}`} onClose={() => setModal({ type: "none" })}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">🎯 Funil do CRM</label>
              <ClientFunnelSelect clients={clients} funnels={funnels} value={linkFunnelId} onChange={setLinkFunnelId} accentColor="green" />
              <p className="text-xs text-slate-400 mt-1">Mensagens recebidas criarão leads neste funil.</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">🤖 Agente IA</label>
              <ClientAgentSelect clients={clients} value={linkClientId} onChange={setLinkClientId} accentColor="green" />
              {linkClientId && (
                <label className="flex items-center gap-2.5 cursor-pointer" onClick={() => setLinkAgent(v => !v)}>
                  <div className={`relative w-10 rounded-full transition-colors ${linkAgent ? "bg-green-500" : "bg-slate-300"}`} style={{ height: "22px" }}>
                    <span className="absolute top-[2px] bg-white shadow rounded-full transition-transform" style={{ width: 18, height: 18, left: 2, transform: linkAgent ? "translateX(18px)" : "translateX(0)" }} />
                  </div>
                  <span className="text-sm text-slate-700">Ativar Agente IA nesta instância</span>
                </label>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setModal({ type: "none" })} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">Cancelar</button>
              <button onClick={handleLink} disabled={savingLink} className="flex-1 rounded-xl bg-blue-600 hover:bg-blue-700 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                {savingLink ? "Salvando..." : "Salvar Vínculo"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
      )}
    </div>
  );
}

// ── InstanceCard ──────────────────────────────────────────────────
function InstanceCard({ inst, deletingToken, setDeletingToken, onConnect, onForceConnect, onWebhook, onSend, onLink, onDelete }: {
  inst: EnrichedInstance; deletingToken: string | null; setDeletingToken: (t: string | null) => void;
  onConnect: () => void; onForceConnect: () => void; onWebhook: () => void;
  onSend: () => void; onLink: () => void; onDelete: () => void;
}) {
  const isConnected = inst.status === "connected";
  const isConnecting = inst.status === "connecting";

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4 min-w-0">
          <span className={`mt-1.5 flex-shrink-0 h-3 w-3 rounded-full ${isConnected ? "bg-green-500 animate-pulse" : isConnecting ? "bg-yellow-400 animate-pulse" : "bg-slate-300"}`} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-slate-900">{inst.name}</h3>
              {isConnected && inst.phone && <span className="text-xs font-mono text-slate-500 bg-slate-100 rounded-lg px-2 py-0.5">+{inst.phone}</span>}
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isConnected ? "bg-green-100 text-green-700" : isConnecting ? "bg-yellow-100 text-yellow-700" : "bg-slate-100 text-slate-500"}`}>
                {isConnected ? "Conectado" : isConnecting ? "Conectando..." : "Desconectado"}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {inst.linkedFunnelName
                ? <span className="text-xs text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-2.5 py-0.5 font-medium">🎯 {inst.linkedFunnelName}{inst.linkedClientName ? ` · ${inst.linkedClientName}` : ""}</span>
                : <span className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-0.5">Sem funil</span>}
              {inst.hasAgentLinked && (
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium border ${inst.agentEnabled ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-slate-500 bg-slate-50 border-slate-200"}`}>
                  🤖 Agente {inst.agentEnabled ? "ativo" : "inativo"}
                </span>
              )}
            </div>
            {/* URL de webhook desta instância */}
            {inst.instanceWebhookUrl && (
              <div className="flex items-center gap-2 mt-2 bg-slate-50 rounded-lg px-2.5 py-1.5 max-w-lg">
                <span className="text-xs text-slate-400">🔗</span>
                <span className="text-xs font-mono text-slate-500 truncate flex-1">{inst.instanceWebhookUrl}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(inst.instanceWebhookUrl).catch(() => {}); }}
                  className="text-xs text-blue-600 font-semibold hover:text-blue-800 whitespace-nowrap"
                  title="Copiar URL de webhook">
                  Copiar
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
          {isConnected ? (
            <button onClick={onForceConnect} title="Trocar número (reconectar)"
              className="text-xs font-semibold border border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-xl px-3 py-1.5 transition">
              🔄 Trocar
            </button>
          ) : (
            <button onClick={onConnect} title="Conectar"
              className="text-xs font-semibold border border-green-200 text-green-700 bg-green-50 hover:bg-green-100 rounded-xl px-3 py-1.5 transition">
              ⚡ Conectar
            </button>
          )}
          <ActionBtn onClick={onWebhook} title="Webhook" className="border-slate-200 text-slate-600 hover:text-blue-700 hover:bg-blue-50">🔗</ActionBtn>
          <ActionBtn onClick={onSend} title="Enviar mensagem" className="border-slate-200 text-slate-600 hover:bg-slate-50">💬</ActionBtn>
          <ActionBtn onClick={onLink} title="Vincular CRM/Agente" className="border-slate-200 text-slate-600 hover:text-violet-700 hover:bg-violet-50">🔀</ActionBtn>
          {deletingToken === inst.token ? (
            <div className="flex items-center gap-1">
              <button onClick={onDelete} className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">Confirmar</button>
              <button onClick={() => setDeletingToken(null)} className="text-xs text-slate-400 px-1.5">✕</button>
            </div>
          ) : (
            <ActionBtn onClick={() => setDeletingToken(inst.token)} title="Excluir" className="border-slate-200 text-slate-400 hover:text-red-600 hover:bg-red-50">🗑️</ActionBtn>
          )}
        </div>
      </div>
    </div>
  );
}

// ── MetaApiView ───────────────────────────────────────────────────
type MetaConn = {
  id: string;
  phoneNumberId: string;
  tokenMasked: string;
  verifyToken: string;
  funnelId: string;
  funnelName: string;
  clientId: string | null;
  clientName: string | null;
  hasAgentLinked: boolean;
  agentEnabled: boolean;
};

function MetaApiView({ funnels, clients, appBaseUrl }: { funnels: FunnelOption[]; clients: ClientOption[]; appBaseUrl: string }) {
  const [connections, setConnections] = useState<MetaConn[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [linkingConn, setLinkingConn] = useState<MetaConn | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Add form
  const [addPhoneId, setAddPhoneId] = useState("");
  const [addToken, setAddToken] = useState("");
  const [addVerifyToken, setAddVerifyToken] = useState("trafegopago");
  const [addFunnelId, setAddFunnelId] = useState("");
  const [addClientId, setAddClientId] = useState("");
  const [addLinkAgent, setAddLinkAgent] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");

  // Link form
  const [linkFunnelId, setLinkFunnelId] = useState("");
  const [linkClientId, setLinkClientId] = useState("");
  const [linkAgent, setLinkAgent] = useState(false);
  const [savingLink, setSavingLink] = useState(false);

  const webhookUrl = `${appBaseUrl}/api/whatsapp/meta`;

  const fetchConnections = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/meta-manager");
      if (res.ok) setConnections(await res.json());
    } catch { /**/ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConnections(); }, [fetchConnections]);

  async function handleAdd() {
    if (!addPhoneId || !addToken || !addFunnelId) {
      setAddError("Phone Number ID, Token e Funil são obrigatórios"); return;
    }
    setAdding(true); setAddError("");
    const res = await fetch("/api/whatsapp/meta-manager", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ funnelId: addFunnelId, phoneNumberId: addPhoneId, token: addToken, verifyToken: addVerifyToken, clientId: addClientId || null, linkAgent: addLinkAgent }),
    });
    if (!res.ok) { setAddError("Erro ao salvar"); setAdding(false); return; }
    setShowAddModal(false);
    setAddPhoneId(""); setAddToken(""); setAddFunnelId(""); setAddClientId(""); setAddLinkAgent(false);
    fetchConnections();
    setAdding(false);
  }

  async function handleUpdateLink() {
    if (!linkingConn) return;
    setSavingLink(true);
    await fetch("/api/whatsapp/meta-manager", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connId: linkingConn.id, newFunnelId: linkFunnelId || undefined, clientId: linkClientId || null, linkAgent }),
    });
    setSavingLink(false); setLinkingConn(null); fetchConnections();
  }

  async function handleDelete(connId: string) {
    setDeletingId(null);
    await fetch("/api/whatsapp/meta-manager", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connId }),
    });
    fetchConnections();
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">API Oficial WhatsApp</h1>
          <p className="text-sm text-slate-500 mt-0.5">Gerencie suas conexões Meta Business API</p>
        </div>
        <button
          onClick={() => { setAddPhoneId(""); setAddToken(""); setAddVerifyToken("trafegopago"); setAddFunnelId(""); setAddClientId(""); setAddLinkAgent(false); setAddError(""); setShowAddModal(true); }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl px-4 py-2.5 transition shadow-sm"
        >
          <span className="text-lg leading-none">+</span> Nova Conexão Meta
        </button>
      </div>

      {/* Webhook URL info */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 mb-6 flex items-start gap-3">
        <span className="text-xl mt-0.5">🔗</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-blue-800 mb-1">URL do Webhook (Meta Developer)</p>
          <div className="flex items-center gap-2 bg-white rounded-xl border border-blue-200 px-3 py-2">
            <span className="text-xs font-mono text-blue-700 flex-1 break-all">{webhookUrl}</span>
            <button onClick={() => navigator.clipboard.writeText(webhookUrl).catch(() => {})}
              className="text-xs font-semibold text-blue-600 whitespace-nowrap hover:text-blue-800">Copiar</button>
          </div>
          <p className="text-xs text-blue-600 mt-1.5">Configure no Meta Business → API do WhatsApp → Configuração do Webhook</p>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin h-8 w-8 border-2 border-slate-200 border-t-blue-500 rounded-full" />
        </div>
      ) : connections.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <span className="text-5xl mb-4">🏢</span>
          <p className="text-lg font-semibold text-slate-600 mb-1">Nenhuma conexão Meta configurada</p>
          <p className="text-sm mb-6">Adicione sua primeira conexão via API Oficial do WhatsApp</p>
          <button onClick={() => setShowAddModal(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl px-5 py-2.5 transition">
            + Nova Conexão Meta
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {connections.map(conn => (
            <div key={conn.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4 min-w-0">
                  <span className="mt-1.5 flex-shrink-0 h-3 w-3 rounded-full bg-blue-500" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-slate-900">🏢 {conn.phoneNumberId}</h3>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Configurado</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {conn.funnelName
                        ? <span className="text-xs text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-2.5 py-0.5 font-medium">🎯 {conn.funnelName}</span>
                        : <span className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-0.5">Sem funil</span>}
                      {conn.hasAgentLinked && (
                        <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium border ${conn.agentEnabled ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-slate-500 bg-slate-50 border-slate-200"}`}>
                          🤖 {conn.clientName}{conn.agentEnabled ? " · ativo" : " · inativo"}
                        </span>
                      )}
                      <span className="text-xs text-slate-400">Verify: <code className="font-mono text-slate-600">{conn.verifyToken}</code></span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => { setLinkingConn(conn); setLinkFunnelId(conn.funnelId ?? ""); setLinkClientId(conn.clientId ?? ""); setLinkAgent(conn.hasAgentLinked); }}
                    className="h-9 px-3 flex items-center gap-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:text-violet-700 hover:bg-violet-50 transition"
                    title="Vincular funil/agente">
                    🔀 Vincular
                  </button>
                  {deletingId === conn.id ? (
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleDelete(conn.id)} className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">Confirmar</button>
                      <button onClick={() => setDeletingId(null)} className="text-xs text-slate-400 px-1.5">✕</button>
                    </div>
                  ) : (
                    <button onClick={() => setDeletingId(conn.id)} className="h-9 w-9 flex items-center justify-center rounded-xl border border-slate-200 text-slate-400 hover:text-red-600 hover:bg-red-50 transition text-base">🗑️</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      {(showAddModal || !!linkingConn) && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" onClick={() => { setShowAddModal(false); setLinkingConn(null); }} />
      )}

      {/* Add Modal */}
      {showAddModal && (
        <Modal title="Nova Conexão Meta API" onClose={() => setShowAddModal(false)}>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">📱 Phone Number ID</label>
              <input autoFocus value={addPhoneId} onChange={e => setAddPhoneId(e.target.value)}
                placeholder="Ex: 123456789012345"
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400" />
              <p className="text-xs text-slate-400 mt-1">Meta Business → API do WhatsApp → número do telefone</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">🔑 Access Token</label>
              <input value={addToken} onChange={e => setAddToken(e.target.value)} type="password"
                placeholder="Token de acesso permanente"
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">🔐 Verify Token</label>
              <input value={addVerifyToken} onChange={e => setAddVerifyToken(e.target.value)}
                placeholder="trafegopago"
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400" />
              <p className="text-xs text-slate-400 mt-1">Token de verificação do webhook (você escolhe — deve coincidir no Meta)</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">🎯 Funil do CRM</label>
              <ClientFunnelSelect clients={clients} funnels={funnels} value={addFunnelId} onChange={setAddFunnelId} accentColor="blue" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">🤖 Agente IA</label>
              <ClientAgentSelect clients={clients} value={addClientId} onChange={setAddClientId} accentColor="blue" />
              {addClientId && (
                <label className="flex items-center gap-2.5 cursor-pointer" onClick={() => setAddLinkAgent(v => !v)}>
                  <div className={`relative w-10 rounded-full transition-colors ${addLinkAgent ? "bg-blue-500" : "bg-slate-300"}`} style={{ height: "22px" }}>
                    <span className="absolute top-[2px] bg-white shadow rounded-full transition-transform" style={{ width: 18, height: 18, left: 2, transform: addLinkAgent ? "translateX(18px)" : "translateX(0)" }} />
                  </div>
                  <span className="text-sm text-slate-700">Ativar Agente IA nesta conexão</span>
                </label>
              )}
            </div>
            {addError && <p className="text-xs text-red-500">{addError}</p>}
            <div className="flex gap-2 pt-1">
              <button onClick={() => setShowAddModal(false)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">Cancelar</button>
              <button onClick={handleAdd} disabled={adding || !addPhoneId || !addToken || !addFunnelId}
                className="flex-1 rounded-xl bg-blue-600 hover:bg-blue-700 py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition">
                {adding ? "Salvando..." : "Salvar Conexão"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Link Modal */}
      {linkingConn && (
        <Modal title={`Vincular — ${linkingConn.phoneNumberId}`} onClose={() => setLinkingConn(null)}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">🎯 Funil do CRM</label>
              <ClientFunnelSelect clients={clients} funnels={funnels} value={linkFunnelId} onChange={setLinkFunnelId} accentColor="blue" />
              <p className="text-xs text-slate-400 mt-1">Mensagens recebidas criarão leads neste funil.</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">🤖 Agente IA</label>
              <ClientAgentSelect clients={clients} value={linkClientId} onChange={setLinkClientId} accentColor="blue" />
              {linkClientId && (
                <label className="flex items-center gap-2.5 cursor-pointer" onClick={() => setLinkAgent(v => !v)}>
                  <div className={`relative w-10 rounded-full transition-colors ${linkAgent ? "bg-blue-500" : "bg-slate-300"}`} style={{ height: "22px" }}>
                    <span className="absolute top-[2px] bg-white shadow rounded-full transition-transform" style={{ width: 18, height: 18, left: 2, transform: linkAgent ? "translateX(18px)" : "translateX(0)" }} />
                  </div>
                  <span className="text-sm text-slate-700">Ativar Agente IA nesta conexão</span>
                </label>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setLinkingConn(null)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">Cancelar</button>
              <button onClick={handleUpdateLink} disabled={savingLink}
                className="flex-1 rounded-xl bg-blue-600 hover:bg-blue-700 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                {savingLink ? "Salvando..." : "Salvar Vínculo"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ActionBtn({ onClick, title, className, children }: { onClick: () => void; title: string; className: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} className={`h-9 w-9 flex items-center justify-center rounded-xl border text-base transition ${className}`}>
      {children}
    </button>
  );
}

// ── WppConnectView ─────────────────────────────────────────────────
import type { EnrichedWppSession } from "@/app/api/whatsapp/wppconnect-manager/route";

type WppModalState =
  | { type: "none" }
  | { type: "create"; stage: "name" | "creating" | "created"; id?: string; sessionName?: string }
  | { type: "qr"; id: string; sessionName: string; forceLogout: boolean }
  | { type: "link"; id: string; sessionName: string };

function WppConnectView({ funnels, clients, appBaseUrl }: { funnels: FunnelOption[]; clients: ClientOption[]; appBaseUrl: string }) {
  const [sessions, setSessions] = useState<EnrichedWppSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [wppModal, setWppModal] = useState<WppModalState>({ type: "none" });

  // Create
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState("");

  // QR
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrStage, setQrStage] = useState<"generating" | "scanning" | "done">("generating");
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const qrShownRef = useRef(false);

  // Link
  const [linkFunnelId, setLinkFunnelId] = useState("");
  const [linkClientId, setLinkClientId] = useState("");
  const [linkAgent, setLinkAgent] = useState(false);
  const [reuseConnectionId, setReuseConnectionId] = useState("");
  const [savingLink, setSavingLink] = useState(false);

  // Delete confirm
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [refreshingWebhooks, setRefreshingWebhooks] = useState(false);
  const [webhookRefreshResult, setWebhookRefreshResult] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/wppconnect-manager");
      if (res.ok) setSessions(await res.json());
    } catch { /**/ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    const t = setInterval(fetchSessions, 10000);
    return () => clearInterval(t);
  }, [fetchSessions]);

  // ⚠️ Removido o auto-registro de webhooks ao montar este componente. Ele
  // chamava refresh-webhooks, que por baixo dos panos roda startSession()
  // (fecha + reabre o navegador) em TODAS as sessões já conectadas — toda
  // vez que esta tela era aberta/re-renderizada. Como o close-session do
  // servidor é instável (não fecha de forma limpa), isso desconectava
  // sessões saudáveis sem ninguém ter tocado nelas. Use o botão manual
  // "Atualizar Webhooks" só quando o servidor WPPConnect tiver reiniciado
  // de verdade e perdido os webhooks em memória.

  async function handleRefreshWebhooks() {
    setRefreshingWebhooks(true);
    setWebhookRefreshResult(null);
    try {
      const res = await fetch("/api/whatsapp/wppconnect-manager/refresh-webhooks", { method: "POST" });
      const data = await res.json() as { results?: { sessionName: string; ok: boolean }[]; baseUrl?: string };
      const total = data.results?.length ?? 0;
      const ok = data.results?.filter(r => r.ok).length ?? 0;
      setWebhookRefreshResult(`✓ ${ok}/${total} webhook${total !== 1 ? "s" : ""} registrado${total !== 1 ? "s" : ""} em ${data.baseUrl ?? ""}`);
    } catch {
      setWebhookRefreshResult("Erro ao reconectar webhooks");
    } finally {
      setRefreshingWebhooks(false);
      setTimeout(() => setWebhookRefreshResult(null), 5000);
    }
  }

  // QR polling
  useEffect(() => {
    if (wppModal.type !== "qr") return;

    const { id, forceLogout } = wppModal;
    qrShownRef.current = false;
    setQrImage(null);
    setQrStage("generating");
    setCooldownSeconds(0);

    let poll: ReturnType<typeof setInterval>;
    let cooldownTick: ReturnType<typeof setInterval> | undefined;
    let alive = true;
    let connecting = false;
    // O WhatsApp Web renova o "ref" do QR sozinho a cada ~15-20s, e o WPPConnect
    // acompanha essa renovação — o polling do /status abaixo já pega o QR novo
    // (d.qr muda) e troca a imagem sem precisar de loading. Só entra em "Gerando
    // novo QR..." se passar 65s sem nenhuma renovação: nesse caso o ciclo interno
    // de ~60s (autoClose) do WPPConnect terminou e precisa de um start-session novo.
    let lastQr: string | null = null;
    let qrSetAt = 0;

    const webhookUrl = `${appBaseUrl}/api/whatsapp/webhook/wppconnect/${id}`;

    const connectAndFetchQr = async (force: boolean) => {
      if (connecting || !alive) return;
      connecting = true;
      try {
        const res = await fetch(`/api/whatsapp/wppconnect-manager/${id}/connect`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force, webhookUrl, previousQr: lastQr }),
        });
        const d = await res.json() as { qr?: string | null; cooldownMs?: number };
        if (!alive) return;
        if (d.qr && d.qr !== lastQr) {
          setQrImage(d.qr); setQrStage("scanning"); qrShownRef.current = true;
          lastQr = d.qr; qrSetAt = Date.now();
          clearInterval(cooldownTick);
          setCooldownSeconds(0);
        } else if (d.cooldownMs && d.cooldownMs > 0) {
          // Ciclo interno do WPPConnect (~60s) ainda rodando da tentativa
          // anterior — mostra contagem regressiva em vez de parecer travado,
          // e tenta de novo automaticamente quando o tempo acabar.
          const until = Date.now() + d.cooldownMs;
          setCooldownSeconds(Math.ceil(d.cooldownMs / 1000));
          clearInterval(cooldownTick);
          cooldownTick = setInterval(() => {
            if (!alive) { clearInterval(cooldownTick); return; }
            const left = until - Date.now();
            if (left <= 0) {
              clearInterval(cooldownTick);
              setCooldownSeconds(0);
              connectAndFetchQr(false);
            } else {
              setCooldownSeconds(Math.ceil(left / 1000));
            }
          }, 1000);
        }
      } catch { /**/ } finally {
        connecting = false;
      }
    };

    const startPolling = () => {
      poll = setInterval(async () => {
        if (!alive) return;
        try {
          const res = await fetch(`/api/whatsapp/wppconnect-manager/${id}/status`);
          const d = await res.json() as { connected?: boolean; qr?: string | null };
          if (d.qr) {
            if (d.qr !== lastQr) {
              lastQr = d.qr; qrSetAt = Date.now();
              setQrImage(d.qr); setQrStage("scanning"); qrShownRef.current = true;
            } else if (!d.connected && Date.now() - qrSetAt > 65000) {
              // 65s sem nenhuma renovação natural do QR: o ciclo interno do
              // WPPConnect (~60s) terminou — tira o QR (expirado) da tela e
              // força um start-session novo. force=false — o logout (se
              // necessário) já foi feito na primeira chamada; repeti-lo numa
              // sessão sem login só gera erro.
              setQrImage(null); setQrStage("generating");
              connectAndFetchQr(false);
            }
          }
          if (d.connected && qrShownRef.current) {
            setQrStage("done"); clearInterval(poll); alive = false;
            setTimeout(() => { setWppModal({ type: "none" }); fetchSessions(); }, 1500);
          }
        } catch { /**/ }
      }, 3000);
    };

    connectAndFetchQr(forceLogout).then(() => { if (alive) startPolling(); });

    return () => { alive = false; clearInterval(poll); clearInterval(cooldownTick); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wppModal.type === "qr" ? `${(wppModal as { id: string }).id}-${(wppModal as { forceLogout: boolean }).forceLogout}` : null]);

  async function handleCreate() {
    if (!newName.trim()) { setCreateError("Informe um nome"); return; }
    setCreateError("");
    setWppModal({ type: "create", stage: "creating" });

    const res = await fetch("/api/whatsapp/wppconnect-manager", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    const data = await res.json() as { id?: string; sessionName?: string; error?: string };

    if (!res.ok || !data.id) {
      setWppModal({ type: "create", stage: "name" });
      setCreateError(data.error ?? "Erro ao criar sessão");
      return;
    }

    setWppModal({ type: "create", stage: "created", id: data.id, sessionName: data.sessionName });
    fetchSessions();
  }

  async function handleLink() {
    if (wppModal.type !== "link") return;
    setSavingLink(true);
    await fetch("/api/whatsapp/wppconnect-manager/link", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: wppModal.id, funnelId: linkFunnelId || null, clientId: linkClientId || null, linkAgent,
        reuseConnectionId: reuseConnectionId || undefined,
      }),
    });
    setSavingLink(false); setWppModal({ type: "none" }); setReuseConnectionId(""); fetchSessions();
  }

  async function handleDelete(id: string) {
    setDeletingId(null);
    await fetch(`/api/whatsapp/wppconnect-manager/${id}`, { method: "DELETE" });
    fetchSessions();
  }

  const connectedCount = sessions.filter(s => s.status === "connected").length;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">WPPConnect</h1>
          <p className="text-sm text-slate-500 mt-0.5">Gerencie suas sessões WPPConnect Server</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-4 py-2 shadow-sm">
            <span className={`h-2.5 w-2.5 rounded-full ${connectedCount > 0 ? "bg-violet-500 animate-pulse" : "bg-slate-300"}`} />
            <span className="text-sm font-medium text-slate-700">{connectedCount} / {sessions.length} conectada{sessions.length !== 1 ? "s" : ""}</span>
          </div>
          <button
            onClick={handleRefreshWebhooks}
            disabled={refreshingWebhooks}
            title="Reregistra o webhook no servidor WPPConnect — use se as mensagens não estiverem chegando"
            className="flex items-center gap-2 bg-white border border-slate-200 hover:border-violet-300 hover:bg-violet-50 text-slate-700 hover:text-violet-700 text-sm font-medium rounded-xl px-4 py-2.5 transition shadow-sm disabled:opacity-50"
          >
            {refreshingWebhooks ? (
              <span className="h-4 w-4 rounded-full border-2 border-violet-400 border-t-transparent animate-spin" />
            ) : (
              <span>🔗</span>
            )}
            Reconectar Webhooks
          </button>
          <button
            onClick={() => { setNewName(""); setCreateError(""); setWppModal({ type: "create", stage: "name" }); }}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-xl px-4 py-2.5 transition shadow-sm"
          >
            <span className="text-lg leading-none">+</span> Nova Sessão
          </button>
        </div>
      </div>

      {/* Toast de resultado do refresh webhooks */}
      {webhookRefreshResult && (
        <div className="mb-4 px-4 py-2.5 rounded-xl bg-violet-50 border border-violet-200 text-violet-700 text-sm font-medium">
          {webhookRefreshResult}
        </div>
      )}

      {/* Info banner */}
      <div className="bg-violet-50 border border-violet-200 rounded-2xl p-4 mb-5 flex items-start gap-3">
        <span className="text-xl mt-0.5">🔌</span>
        <div className="flex-1 text-sm text-violet-700">
          <p className="font-semibold mb-0.5">WPPConnect Server</p>
          <p className="text-violet-600 text-xs">Configure <code className="font-mono bg-violet-100 px-1 rounded">WPPCONNECT_SERVER</code> e <code className="font-mono bg-violet-100 px-1 rounded">WPPCONNECT_SECRET_KEY</code> nas variáveis de ambiente. Suporta rastreio CTWa de anúncios via campo <code className="font-mono bg-violet-100 px-1 rounded">referral</code>.</p>
        </div>
      </div>

      {/* Sessions list */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin h-8 w-8 border-2 border-slate-200 border-t-violet-500 rounded-full" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <span className="text-5xl mb-4">🔌</span>
          <p className="text-lg font-semibold text-slate-600 mb-1">Nenhuma sessão encontrada</p>
          <p className="text-sm mb-6">Crie uma nova sessão WPPConnect para começar</p>
          <button onClick={() => { setNewName(""); setCreateError(""); setWppModal({ type: "create", stage: "name" }); }}
            className="bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-xl px-5 py-2.5 transition">
            + Nova Sessão
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {sessions.map(s => {
            const isConnected = s.status === "connected";
            const isConnecting = s.status === "connecting" || s.status === "qrcode";
            return (
              <div key={s.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4 min-w-0">
                    <span className={`mt-1.5 flex-shrink-0 h-3 w-3 rounded-full ${isConnected ? "bg-violet-500 animate-pulse" : isConnecting ? "bg-yellow-400 animate-pulse" : "bg-slate-300"}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-slate-900">{s.sessionName}</h3>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isConnected ? "bg-violet-100 text-violet-700" : isConnecting ? "bg-yellow-100 text-yellow-700" : "bg-slate-100 text-slate-500"}`}>
                          {isConnected ? "Conectado" : isConnecting ? "Aguardando QR..." : "Desconectado"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {s.linkedFunnelName
                          ? <span className="text-xs text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-2.5 py-0.5 font-medium">🎯 {s.linkedFunnelName}{s.linkedClientName ? ` · ${s.linkedClientName}` : ""}</span>
                          : <span className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-0.5">Sem funil</span>}
                      </div>
                      {s.instanceWebhookUrl && (
                        <div className="flex items-center gap-2 mt-2 bg-slate-50 rounded-lg px-2.5 py-1.5 max-w-lg">
                          <span className="text-xs text-slate-400">🔗</span>
                          <span className="text-xs font-mono text-slate-500 truncate flex-1">{s.instanceWebhookUrl}</span>
                          <button onClick={() => navigator.clipboard.writeText(s.instanceWebhookUrl).catch(() => {})}
                            className="text-xs text-blue-600 font-semibold hover:text-blue-800 whitespace-nowrap">Copiar</button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
                    {isConnected ? (
                      <button onClick={() => setWppModal({ type: "qr", id: s.id, sessionName: s.sessionName, forceLogout: true })}
                        className="text-xs font-semibold border border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-xl px-3 py-1.5 transition">
                        🔄 Trocar
                      </button>
                    ) : (
                      <button onClick={() => setWppModal({ type: "qr", id: s.id, sessionName: s.sessionName, forceLogout: false })}
                        className="text-xs font-semibold border border-violet-200 text-violet-700 bg-violet-50 hover:bg-violet-100 rounded-xl px-3 py-1.5 transition">
                        🔌 Conectar
                      </button>
                    )}
                    <ActionBtn onClick={() => { setLinkFunnelId(s.linkedFunnelId ?? ""); setLinkClientId(s.linkedClientId ?? ""); setLinkAgent(s.hasAgentLinked); setReuseConnectionId(""); setWppModal({ type: "link", id: s.id, sessionName: s.sessionName }); }}
                      title="Vincular CRM/Agente" className="border-slate-200 text-slate-600 hover:text-violet-700 hover:bg-violet-50">🔀</ActionBtn>
                    {deletingId === s.id ? (
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleDelete(s.id)} className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">Confirmar</button>
                        <button onClick={() => setDeletingId(null)} className="text-xs text-slate-400 px-1.5">✕</button>
                      </div>
                    ) : (
                      <ActionBtn onClick={() => setDeletingId(s.id)} title="Excluir" className="border-slate-200 text-slate-400 hover:text-red-600 hover:bg-red-50">🗑️</ActionBtn>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Overlay */}
      {wppModal.type !== "none" && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" onClick={() => setWppModal({ type: "none" })} />
      )}

      {/* CRIAR */}
      {wppModal.type === "create" && (
        <Modal title="Nova Sessão WPPConnect" onClose={() => setWppModal({ type: "none" })}>
          {wppModal.stage === "name" && (
            <>
              <p className="text-sm text-slate-500 mb-4">Digite um nome para identificar esta sessão.</p>
              <input autoFocus value={newName}
                onChange={e => setNewName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                onKeyDown={e => e.key === "Enter" && handleCreate()}
                placeholder="ex: vendas, suporte, atendimento"
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 mb-1"
              />
              {createError && <p className="text-xs text-red-500 mb-3 mt-1">{createError}</p>}
              <p className="text-xs text-slate-400 mb-4">Só letras minúsculas, números e hífens.</p>
              <div className="flex gap-2">
                <button onClick={() => setWppModal({ type: "none" })} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">Cancelar</button>
                <button onClick={handleCreate} disabled={!newName.trim()} className="flex-1 rounded-xl bg-violet-600 hover:bg-violet-700 py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition">
                  Criar Sessão →
                </button>
              </div>
            </>
          )}
          {wppModal.stage === "creating" && (
            <div className="py-8 text-center">
              <div className="animate-spin h-10 w-10 border-2 border-slate-200 border-t-violet-500 rounded-full mx-auto mb-4" />
              <p className="font-semibold text-slate-700">Criando sessão no WPPConnect...</p>
            </div>
          )}
          {wppModal.stage === "created" && wppModal.id && (
            <>
              <div className="bg-violet-50 border border-violet-200 rounded-2xl p-4 mb-5 text-center">
                <div className="text-3xl mb-2">✅</div>
                <p className="font-bold text-violet-800">Sessão <span className="font-mono">{wppModal.sessionName}</span> criada!</p>
                <p className="text-xs text-violet-600 mt-1">Agora conecte um número via QR Code.</p>
              </div>
              <button onClick={() => setWppModal({ type: "qr", id: wppModal.id!, sessionName: wppModal.sessionName!, forceLogout: false })}
                className="w-full rounded-xl bg-violet-600 hover:bg-violet-700 py-2.5 text-sm font-semibold text-white transition">
                📷 Conectar via QR Code
              </button>
            </>
          )}
        </Modal>
      )}

      {/* QR Code */}
      {wppModal.type === "qr" && (
        <Modal title={`Conectar — ${wppModal.sessionName}`} onClose={() => setWppModal({ type: "none" })} wide>
          <div className="text-center">
            {qrStage === "done" ? (
              <div className="py-6">
                <div className="text-5xl mb-2">✅</div>
                <p className="font-bold text-violet-700 text-lg">Conectado com sucesso!</p>
              </div>
            ) : qrImage ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrImage} alt="QR Code" className="w-64 h-64 mx-auto rounded-2xl border-4 border-violet-100 shadow-md mb-3" />
                <p className="text-sm font-medium text-slate-700 mb-1">Abra o WhatsApp → <strong>Aparelhos Conectados</strong> → <strong>Vincular</strong></p>
                <p className="text-xs text-slate-400">Atualiza automaticamente</p>
              </>
            ) : cooldownSeconds > 0 ? (
              <div className="w-64 h-64 mx-auto rounded-2xl border-2 border-dashed border-amber-200 bg-amber-50 flex flex-col items-center justify-center mb-3 gap-2">
                <div className="text-3xl font-bold text-amber-600">{cooldownSeconds}s</div>
                <p className="text-xs text-amber-700 px-6 text-center">
                  O servidor está liberando a sessão anterior. Isso é normal — tentando de novo em {cooldownSeconds}s...
                </p>
              </div>
            ) : (
              <div className="w-64 h-64 mx-auto rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center mb-3 gap-3">
                <div className="animate-spin h-8 w-8 border-2 border-slate-200 border-t-violet-500 rounded-full" />
                <p className="text-xs text-slate-400 px-4">Gerando QR Code...</p>
              </div>
            )}
            {qrStage !== "done" && (
              <div className="flex items-center justify-center gap-2 mt-3">
                <span className={`h-2 w-2 rounded-full ${qrImage ? "bg-yellow-400 animate-pulse" : cooldownSeconds > 0 ? "bg-amber-400 animate-pulse" : "bg-slate-300"}`} />
                <span className="text-xs text-slate-500">
                  {qrImage ? "Aguardando scan..." : cooldownSeconds > 0 ? `Aguarde ${cooldownSeconds}s...` : "Gerando QR..."}
                </span>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Vincular */}
      {wppModal.type === "link" && (
        <Modal title={`Vincular — ${wppModal.sessionName}`} onClose={() => setWppModal({ type: "none" })}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">🎯 Funil do CRM</label>
              <ClientFunnelSelect clients={clients} funnels={funnels} value={linkFunnelId} onChange={setLinkFunnelId} accentColor="green" />
              <p className="text-xs text-slate-400 mt-1">Mensagens recebidas criarão leads neste funil.</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">🤖 Agente IA</label>
              <ClientAgentSelect clients={clients} value={linkClientId} onChange={(v) => { setLinkClientId(v); setReuseConnectionId(""); }} accentColor="green" />
              {linkClientId && (
                <>
                  <label className="flex items-center gap-2.5 cursor-pointer mt-2 mb-2" onClick={() => setLinkAgent(v => !v)}>
                    <div className={`relative w-10 rounded-full transition-colors ${linkAgent ? "bg-violet-500" : "bg-slate-300"}`} style={{ height: "22px" }}>
                      <span className="absolute top-[2px] bg-white shadow rounded-full transition-transform" style={{ width: 18, height: 18, left: 2, transform: linkAgent ? "translateX(18px)" : "translateX(0)" }} />
                    </div>
                    <span className="text-sm text-slate-700">Ativar Agente IA nesta sessão</span>
                  </label>
                  {linkAgent && (
                    <ReuseAgentSelect clients={clients} clientId={linkClientId} value={reuseConnectionId} onChange={setReuseConnectionId} accentColor="violet" />
                  )}
                </>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setWppModal({ type: "none" })} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">Cancelar</button>
              <button onClick={handleLink} disabled={savingLink} className="flex-1 rounded-xl bg-violet-600 hover:bg-violet-700 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                {savingLink ? "Salvando..." : "Salvar Vínculo"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 ${wide ? "w-[520px]" : "w-[440px]"} max-w-[95vw] max-h-[90vh] overflow-y-auto`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-slate-900 text-lg">{title}</h2>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
      </div>
      {children}
    </div>
  );
}
