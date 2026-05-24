"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { EnrichedInstance } from "@/app/api/whatsapp/manager/route";

type FunnelOption = { id: string; name: string; clientId: string | null };
type ClientOption = { id: string; name: string; color: string; agentEnabled: boolean; agentConnectionId: string | null };

type ModalState =
  | { type: "none" }
  | { type: "create" }
  | { type: "connect"; token: string; instanceName: string }
  | { type: "webhook"; token: string; instanceName: string }
  | { type: "send"; token?: string }
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

  // Create modal
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  // Connect modal
  const [connectTab, setConnectTab] = useState<"qr" | "code">("qr");
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingPhone, setPairingPhone] = useState("");
  const [generatingCode, setGeneratingCode] = useState(false);
  const [connectStatus, setConnectStatus] = useState<string>("connecting");
  const connectTokenRef = useRef<string>("");

  // Webhook modal
  const [webhookUrl, setWebhookUrl] = useState(appWebhookUrl);
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [webhookCopied, setWebhookCopied] = useState(false);
  const [webhookSaved, setWebhookSaved] = useState(false);

  // Send modal
  const [sendToken, setSendToken] = useState("");
  const [sendPhone, setSendPhone] = useState("");
  const [sendType, setSendType] = useState<"text" | "image" | "audio" | "video">("text");
  const [sendContent, setSendContent] = useState("");
  const [sendCaption, setSendCaption] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<boolean | null>(null);

  // Link modal
  const [linkFunnelId, setLinkFunnelId] = useState<string>("");
  const [linkClientId, setLinkClientId] = useState<string>("");
  const [linkAgent, setLinkAgent] = useState(false);
  const [savingLink, setSavingLink] = useState(false);

  // Confirm delete
  const [deletingToken, setDeletingToken] = useState<string | null>(null);

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

  // QR polling when connect modal is open
  useEffect(() => {
    if (modal.type !== "connect") {
      setQrImage(null);
      setPairingCode(null);
      setPairingPhone("");
      setConnectStatus("connecting");
      setConnectTab("qr");
      return;
    }

    const token = modal.token;
    connectTokenRef.current = token;

    // Trigger initial connect to get QR
    fetch(`/api/whatsapp/manager/${token}/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "qr" }),
    }).then(r => r.json()).then(d => {
      if (d.qr) setQrImage(d.qr);
    }).catch(() => {});

    // Poll status every 3s
    const poll = setInterval(async () => {
      if (connectTokenRef.current !== token) return;
      try {
        const res = await fetch(`/api/whatsapp/manager/${token}/status`);
        const d = await res.json();
        setConnectStatus(d.status);
        if (d.qr) setQrImage(d.qr);
        if (d.connected) {
          clearInterval(poll);
          clearInterval(qrRefresh);
          setModal({ type: "none" });
          fetchInstances();
        }
      } catch { /**/ }
    }, 3000);

    // Refresh QR every 30s
    const qrRefresh = setInterval(() => {
      if (connectTab !== "qr") return;
      fetch(`/api/whatsapp/manager/${token}/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "qr" }),
      }).then(r => r.json()).then(d => {
        if (d.qr) setQrImage(d.qr);
      }).catch(() => {});
    }, 30000);

    return () => {
      clearInterval(poll);
      clearInterval(qrRefresh);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal.type === "connect" ? modal.token : null]);

  // ── Handlers ──────────────────────────────────────────────────

  async function handleCreate() {
    if (!newName.trim()) { setCreateError("Informe um nome"); return; }
    setCreating(true);
    setCreateError("");
    try {
      const res = await fetch("/api/whatsapp/manager", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.token) {
        setCreateError(data.error ?? "Erro ao criar instância");
        return;
      }
      setNewName("");
      setModal({ type: "connect", token: data.token, instanceName: data.name });
      fetchInstances();
    } catch {
      setCreateError("Erro de conexão");
    } finally {
      setCreating(false);
    }
  }

  async function handleGenerateCode() {
    if (!pairingPhone.trim() || modal.type !== "connect") return;
    setGeneratingCode(true);
    setPairingCode(null);
    try {
      const res = await fetch(`/api/whatsapp/manager/${modal.token}/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "code", phone: pairingPhone }),
      });
      const data = await res.json();
      if (data.code) setPairingCode(data.code);
      else setPairingCode("ERRO");
    } catch {
      setPairingCode("ERRO");
    } finally {
      setGeneratingCode(false);
    }
  }

  async function handleSaveWebhook() {
    if (modal.type !== "webhook") return;
    setSavingWebhook(true);
    setWebhookSaved(false);
    try {
      await fetch(`/api/whatsapp/manager/${modal.token}/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: webhookUrl }),
      });
      setWebhookSaved(true);
      setTimeout(() => setWebhookSaved(false), 2500);
    } finally {
      setSavingWebhook(false);
    }
  }

  async function handleSend() {
    if (!sendToken || !sendPhone || !sendContent) return;
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch("/api/whatsapp/manager/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: sendToken, phone: sendPhone, type: sendType, content: sendContent, caption: sendCaption }),
      });
      const data = await res.json();
      setSendResult(data.ok === true);
      if (data.ok) {
        setSendPhone(""); setSendContent(""); setSendCaption("");
      }
    } catch {
      setSendResult(false);
    } finally {
      setSending(false);
    }
  }

  async function handleLink() {
    if (modal.type !== "link") return;
    setSavingLink(true);
    try {
      await fetch("/api/whatsapp/manager/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instanceToken: modal.token,
          instanceName: modal.instanceName,
          instancePhone: modal.instancePhone,
          funnelId: linkFunnelId || null,
          clientId: linkClientId || null,
          linkAgent,
        }),
      });
      setModal({ type: "none" });
      fetchInstances();
    } finally {
      setSavingLink(false);
    }
  }

  async function handleDelete(token: string) {
    setDeletingToken(null);
    await fetch(`/api/whatsapp/manager/${token}`, { method: "DELETE" });
    fetchInstances();
  }

  function openLink(inst: EnrichedInstance) {
    setLinkFunnelId(inst.linkedFunnelId ?? "");
    setLinkClientId(inst.linkedClientId ?? "");
    setLinkAgent(inst.hasAgentLinked);
    setModal({ type: "link", token: inst.token, instanceName: inst.name, instancePhone: inst.phone ?? "" });
  }

  function openWebhook(inst: EnrichedInstance) {
    setWebhookUrl(appWebhookUrl);
    setWebhookSaved(false);
    setModal({ type: "webhook", token: inst.token, instanceName: inst.name });
  }

  function openSend(inst?: EnrichedInstance) {
    setSendToken(inst?.token ?? (instances[0]?.token ?? ""));
    setSendPhone(""); setSendContent(""); setSendCaption("");
    setSendType("text"); setSendResult(null);
    setModal({ type: "send", token: inst?.token });
  }

  const connectedCount = instances.filter(i => i.status === "connected").length;

  // ── Render ─────────────────────────────────────────────────────

  return (
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
            <span className="text-sm font-medium text-slate-700">
              {connectedCount} / {instances.length} conectada{instances.length !== 1 ? "s" : ""}
            </span>
          </div>
          <button
            onClick={() => { setNewName(""); setCreateError(""); setModal({ type: "create" }); }}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-xl px-4 py-2.5 transition shadow-sm"
          >
            <span className="text-base leading-none">+</span>
            Nova Instância
          </button>
        </div>
      </div>

      {/* Instances grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <div className="text-center">
            <div className="animate-spin h-8 w-8 border-2 border-slate-200 border-t-green-500 rounded-full mx-auto mb-3" />
            <p className="text-sm">Carregando instâncias...</p>
          </div>
        </div>
      ) : instances.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <span className="text-5xl mb-4">📱</span>
          <p className="text-lg font-semibold text-slate-600 mb-1">Nenhuma instância encontrada</p>
          <p className="text-sm mb-6">Crie uma nova instância UazAPI para começar</p>
          <button
            onClick={() => { setNewName(""); setCreateError(""); setModal({ type: "create" }); }}
            className="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-xl px-5 py-2.5 transition"
          >
            + Nova Instância
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {instances.map(inst => (
            <InstanceCard
              key={inst.token}
              inst={inst}
              deletingToken={deletingToken}
              setDeletingToken={setDeletingToken}
              onConnect={() => setModal({ type: "connect", token: inst.token, instanceName: inst.name })}
              onWebhook={() => openWebhook(inst)}
              onSend={() => openSend(inst)}
              onLink={() => openLink(inst)}
              onDelete={() => handleDelete(inst.token)}
            />
          ))}
        </div>
      )}

      {/* ── MODAIS ────────────────────────────────────────── */}

      {/* Backdrop */}
      {modal.type !== "none" && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
          onClick={() => setModal({ type: "none" })}
        />
      )}

      {/* Nova Instância */}
      {modal.type === "create" && (
        <Modal title="Nova Instância UazAPI" onClose={() => setModal({ type: "none" })}>
          <p className="text-sm text-slate-500 mb-4">
            Digite um nome curto e único. Ele será usado como identificador da instância no UazAPI.
          </p>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleCreate()}
            placeholder="ex: nexo-pro, sbcie, clinica-norte"
            className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-green-400 focus:ring-2 focus:ring-green-100 mb-1"
            autoFocus
          />
          {createError && <p className="text-xs text-red-500 mb-3">{createError}</p>}
          <p className="text-xs text-slate-400 mb-4">Letras minúsculas, números e hífens apenas.</p>
          <div className="flex gap-2">
            <button onClick={() => setModal({ type: "none" })}
              className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600 hover:bg-slate-50">
              Cancelar
            </button>
            <button onClick={handleCreate} disabled={creating || !newName.trim()}
              className="flex-1 rounded-xl bg-green-600 hover:bg-green-700 py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition">
              {creating ? "Criando..." : "Criar e Conectar"}
            </button>
          </div>
        </Modal>
      )}

      {/* Conectar (QR ou Código) */}
      {modal.type === "connect" && (
        <Modal title={`Conectar — ${modal.instanceName}`} onClose={() => setModal({ type: "none" })} wide>
          {/* Tabs */}
          <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-5">
            {(["qr", "code"] as const).map(tab => (
              <button key={tab} onClick={() => setConnectTab(tab)}
                className={`flex-1 py-2 text-sm font-semibold rounded-lg transition ${connectTab === tab ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>
                {tab === "qr" ? "📷 QR Code" : "🔢 Código de Pareamento"}
              </button>
            ))}
          </div>

          {connectTab === "qr" ? (
            <div className="text-center">
              {qrImage ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrImage} alt="QR Code WhatsApp" className="w-64 h-64 mx-auto rounded-2xl border-4 border-green-100 shadow-md mb-3" />
                  <p className="text-xs text-slate-500 mb-1">Abra o WhatsApp → <strong>Aparelhos Conectados</strong> → <strong>Vincular</strong></p>
                  <p className="text-xs text-slate-400">Atualiza automaticamente a cada 30s</p>
                </>
              ) : (
                <div className="w-64 h-64 mx-auto rounded-2xl border-2 border-dashed border-slate-200 flex items-center justify-center mb-3">
                  <div className="text-center text-slate-400">
                    <div className="animate-spin h-8 w-8 border-2 border-slate-200 border-t-green-500 rounded-full mx-auto mb-2" />
                    <p className="text-xs">Gerando QR Code...</p>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-center gap-2 mt-3">
                <span className={`h-2 w-2 rounded-full ${connectStatus === "connected" ? "bg-green-500" : connectStatus === "connecting" ? "bg-yellow-400 animate-pulse" : "bg-slate-300"}`} />
                <span className="text-xs text-slate-500">
                  {connectStatus === "connected" ? "Conectado!" : connectStatus === "connecting" ? "Aguardando scan..." : connectStatus}
                </span>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-sm text-slate-600 mb-3">
                Insira o número do WhatsApp que será conectado a esta instância. Um código de 8 dígitos será gerado.
              </p>
              <div className="flex gap-2 mb-4">
                <input
                  value={pairingPhone}
                  onChange={e => setPairingPhone(e.target.value)}
                  placeholder="5544999999999 (com DDI)"
                  className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-green-400 focus:ring-2 focus:ring-green-100"
                />
                <button onClick={handleGenerateCode} disabled={generatingCode || !pairingPhone.trim()}
                  className="rounded-xl bg-green-600 hover:bg-green-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition whitespace-nowrap">
                  {generatingCode ? "..." : "Gerar Código"}
                </button>
              </div>
              {pairingCode && pairingCode !== "ERRO" && (
                <div className="bg-green-50 border border-green-200 rounded-2xl p-5 text-center mb-3">
                  <p className="text-xs text-green-600 font-semibold mb-2 uppercase tracking-wide">Código de Pareamento</p>
                  <p className="font-mono text-4xl font-bold tracking-[0.3em] text-green-700">{pairingCode}</p>
                  <p className="text-xs text-green-600 mt-2">WhatsApp → Aparelhos Conectados → Vincular com número de telefone</p>
                </div>
              )}
              {pairingCode === "ERRO" && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-600">
                  Não foi possível gerar o código. Verifique se a instância existe e está desconectada.
                </div>
              )}
              <div className="flex items-center justify-center gap-2 mt-2">
                <span className={`h-2 w-2 rounded-full ${connectStatus === "connected" ? "bg-green-500" : "bg-yellow-400 animate-pulse"}`} />
                <span className="text-xs text-slate-500">
                  {connectStatus === "connected" ? "✅ Conectado!" : "Aguardando pareamento..."}
                </span>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* Webhook */}
      {modal.type === "webhook" && (
        <Modal title={`Webhook — ${modal.instanceName}`} onClose={() => setModal({ type: "none" })}>
          <p className="text-sm text-slate-500 mb-3">
            Configure a URL de webhook desta instância no UazAPI. As mensagens recebidas serão enviadas para este endereço.
          </p>
          <div className="relative mb-2">
            <input
              value={webhookUrl}
              onChange={e => setWebhookUrl(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-mono outline-none focus:border-green-400 focus:ring-2 focus:ring-green-100 pr-20"
            />
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(webhookUrl).catch(() => {});
                setWebhookCopied(true);
                setTimeout(() => setWebhookCopied(false), 2000);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-blue-600 hover:text-blue-800 px-2 py-1 rounded"
            >
              {webhookCopied ? "✓ Copiado" : "Copiar"}
            </button>
          </div>
          <p className="text-xs text-slate-400 mb-4">
            Esta é a URL padrão da plataforma. Altere apenas se souber o que está fazendo.
          </p>
          <div className="flex gap-2">
            <button onClick={() => setModal({ type: "none" })}
              className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600 hover:bg-slate-50">
              Fechar
            </button>
            <button onClick={handleSaveWebhook} disabled={savingWebhook}
              className={`flex-1 rounded-xl py-2.5 text-sm font-semibold text-white transition disabled:opacity-50 ${webhookSaved ? "bg-green-500" : "bg-blue-600 hover:bg-blue-700"}`}>
              {savingWebhook ? "Salvando..." : webhookSaved ? "✓ Salvo!" : "Salvar no UazAPI"}
            </button>
          </div>
        </Modal>
      )}

      {/* Enviar Mensagem */}
      {modal.type === "send" && (
        <Modal title="Enviar Mensagem" onClose={() => setModal({ type: "none" })} wide>
          <div className="space-y-3">
            {/* Instância */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Instância</label>
              <select
                value={sendToken}
                onChange={e => setSendToken(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-green-400"
              >
                {instances.filter(i => i.status === "connected").map(i => (
                  <option key={i.token} value={i.token}>
                    {i.name}{i.phone ? ` (+${i.phone})` : ""}
                  </option>
                ))}
                {instances.filter(i => i.status !== "connected").length > 0 && (
                  <optgroup label="Desconectadas">
                    {instances.filter(i => i.status !== "connected").map(i => (
                      <option key={i.token} value={i.token}>{i.name} (desconectada)</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            {/* Telefone */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Destinatário</label>
              <input
                value={sendPhone}
                onChange={e => setSendPhone(e.target.value)}
                placeholder="5544999999999 (com DDI, sem + ou espaços)"
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-green-400"
              />
            </div>

            {/* Tipo */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Tipo de mensagem</label>
              <div className="flex gap-2">
                {(["text", "image", "audio", "video"] as const).map(t => (
                  <button key={t} onClick={() => setSendType(t)}
                    className={`flex-1 py-2 text-xs font-semibold rounded-xl border transition ${sendType === t ? "border-green-500 bg-green-600 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                    {t === "text" ? "💬 Texto" : t === "image" ? "🖼️ Imagem" : t === "audio" ? "🎵 Áudio" : "🎬 Vídeo"}
                  </button>
                ))}
              </div>
            </div>

            {/* Conteúdo */}
            {sendType === "text" ? (
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Mensagem</label>
                <textarea
                  value={sendContent}
                  onChange={e => setSendContent(e.target.value)}
                  placeholder="Digite sua mensagem..."
                  rows={4}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-green-400 resize-none"
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    URL do arquivo {sendType === "image" ? "(imagem)" : sendType === "audio" ? "(áudio)" : "(vídeo)"}
                  </label>
                  <input
                    value={sendContent}
                    onChange={e => setSendContent(e.target.value)}
                    placeholder="https://exemplo.com/arquivo.mp4"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-green-400"
                  />
                </div>
                {(sendType === "image" || sendType === "video") && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Legenda (opcional)</label>
                    <input
                      value={sendCaption}
                      onChange={e => setSendCaption(e.target.value)}
                      placeholder="Legenda da mídia"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-green-400"
                    />
                  </div>
                )}
              </>
            )}

            {sendResult !== null && (
              <div className={`rounded-xl px-4 py-2.5 text-sm font-medium ${sendResult ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
                {sendResult ? "✅ Mensagem enviada com sucesso!" : "❌ Falha ao enviar. Verifique se a instância está conectada."}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button onClick={() => setModal({ type: "none" })}
                className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600 hover:bg-slate-50">
                Fechar
              </button>
              <button onClick={handleSend} disabled={sending || !sendToken || !sendPhone || !sendContent}
                className="flex-1 rounded-xl bg-green-600 hover:bg-green-700 py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition">
                {sending ? "Enviando..." : "Enviar"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Vincular CRM / Agente */}
      {modal.type === "link" && (
        <Modal title={`Vincular — ${modal.instanceName}`} onClose={() => setModal({ type: "none" })}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">🎯 Funil do CRM</label>
              <select
                value={linkFunnelId}
                onChange={e => setLinkFunnelId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-green-400"
              >
                <option value="">— Sem vínculo com funil —</option>
                {funnels.map(f => (
                  <option key={f.id} value={f.id}>
                    {f.name}{f.clientId ? ` (${clients.find(c => c.id === f.clientId)?.name ?? f.clientId})` : ""}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-400 mt-1">Mensagens recebidas nessa instância criarão leads neste funil.</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">🤖 Agente IA</label>
              <select
                value={linkClientId}
                onChange={e => setLinkClientId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-green-400 mb-2"
              >
                <option value="">— Sem cliente —</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {linkClientId && (
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <div
                    onClick={() => setLinkAgent(v => !v)}
                    className={`relative w-10 h-5.5 rounded-full transition-colors cursor-pointer flex-shrink-0 ${linkAgent ? "bg-green-500" : "bg-slate-300"}`}
                    style={{ height: "22px" }}
                  >
                    <span className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-transform ${linkAgent ? "translate-x-5" : "translate-x-0.5"}`}
                      style={{ height: "18px", width: "18px", top: "2px", left: "2px", transform: linkAgent ? "translateX(18px)" : "translateX(0)" }} />
                  </div>
                  <span className="text-sm text-slate-700">Ativar Agente IA nesta instância</span>
                </label>
              )}
              {linkAgent && linkClientId && linkFunnelId && (() => {
                const selectedFunnel = funnels.find(f => f.id === linkFunnelId);
                if (selectedFunnel?.clientId && selectedFunnel.clientId !== linkClientId) {
                  return (
                    <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mt-2 border border-amber-200">
                      ⚠️ O cliente do agente é diferente do cliente do funil. O roteamento pode não funcionar corretamente.
                    </p>
                  );
                }
                return null;
              })()}
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={() => setModal({ type: "none" })}
                className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600 hover:bg-slate-50">
                Cancelar
              </button>
              <button onClick={handleLink} disabled={savingLink}
                className="flex-1 rounded-xl bg-blue-600 hover:bg-blue-700 py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition">
                {savingLink ? "Salvando..." : "Salvar Vínculo"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── InstanceCard ────────────────────────────────────────────────

function InstanceCard({
  inst, deletingToken, setDeletingToken,
  onConnect, onWebhook, onSend, onLink, onDelete,
}: {
  inst: EnrichedInstance;
  deletingToken: string | null;
  setDeletingToken: (t: string | null) => void;
  onConnect: () => void;
  onWebhook: () => void;
  onSend: () => void;
  onLink: () => void;
  onDelete: () => void;
}) {
  const isConnected = inst.status === "connected";
  const isConnecting = inst.status === "connecting";

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition p-5">
      <div className="flex items-start justify-between gap-4">
        {/* Left: status + info */}
        <div className="flex items-start gap-4 min-w-0">
          <div className="flex-shrink-0 mt-0.5">
            <span className={`flex h-3 w-3 rounded-full ${isConnected ? "bg-green-500" : isConnecting ? "bg-yellow-400" : "bg-slate-300"} ${(isConnected || isConnecting) ? "animate-pulse" : ""}`} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-slate-900">{inst.name}</h3>
              {isConnected && inst.phone && (
                <span className="text-xs font-mono text-slate-500 bg-slate-100 rounded-lg px-2 py-0.5">
                  +{inst.phone}
                </span>
              )}
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isConnected ? "bg-green-100 text-green-700" : isConnecting ? "bg-yellow-100 text-yellow-700" : "bg-slate-100 text-slate-500"}`}>
                {isConnected ? "Conectado" : isConnecting ? "Conectando..." : "Desconectado"}
              </span>
            </div>

            {/* Badges CRM / Agente */}
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {inst.linkedFunnelName ? (
                <span className="text-xs text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-2.5 py-0.5 font-medium">
                  🎯 {inst.linkedFunnelName}
                  {inst.linkedClientName && ` · ${inst.linkedClientName}`}
                </span>
              ) : (
                <span className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-0.5">
                  Sem funil
                </span>
              )}
              {inst.hasAgentLinked && (
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium border ${inst.agentEnabled ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-slate-500 bg-slate-50 border-slate-200"}`}>
                  🤖 Agente {inst.agentEnabled ? "ativo" : "inativo"}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <ActionBtn onClick={onConnect} title={isConnected ? "Reconectar" : "Conectar"}
            className={isConnected ? "border-slate-200 text-slate-600 hover:text-green-700" : "border-green-200 text-green-700 bg-green-50 hover:bg-green-100"}>
            {isConnected ? "↺" : "⚡"}
          </ActionBtn>

          <ActionBtn onClick={onWebhook} title="Configurar webhook"
            className="border-slate-200 text-slate-600 hover:text-blue-700 hover:bg-blue-50">
            🔗
          </ActionBtn>

          <ActionBtn onClick={onSend} title="Enviar mensagem"
            className="border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50">
            💬
          </ActionBtn>

          <ActionBtn onClick={onLink} title="Vincular ao CRM / Agente"
            className="border-slate-200 text-slate-600 hover:text-violet-700 hover:bg-violet-50">
            🔀
          </ActionBtn>

          {deletingToken === inst.token ? (
            <div className="flex items-center gap-1">
              <button onClick={onDelete}
                className="text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg px-2.5 py-1.5 transition">
                Confirmar
              </button>
              <button onClick={() => setDeletingToken(null)}
                className="text-xs text-slate-500 hover:text-slate-700 px-1.5 py-1.5">
                ✕
              </button>
            </div>
          ) : (
            <ActionBtn onClick={() => setDeletingToken(inst.token)} title="Excluir instância"
              className="border-slate-200 text-slate-400 hover:text-red-600 hover:bg-red-50 hover:border-red-200">
              🗑️
            </ActionBtn>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionBtn({ onClick, title, className, children }: {
  onClick: () => void;
  title: string;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} title={title}
      className={`h-9 w-9 flex items-center justify-center rounded-xl border text-base transition ${className}`}>
      {children}
    </button>
  );
}

function Modal({ title, onClose, wide, children }: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 ${wide ? "w-[520px]" : "w-[420px]"} max-w-[95vw] max-h-[90vh] overflow-y-auto`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-slate-900 text-lg">{title}</h2>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
      </div>
      {children}
    </div>
  );
}
