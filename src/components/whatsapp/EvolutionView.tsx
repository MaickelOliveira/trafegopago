"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { EnrichedEvolutionSession } from "@/app/api/whatsapp/evolution-manager/route";
import {
  ActionBtn,
  Modal,
  ReuseAgentSelect,
  ClientAgentSelect,
  ClientFunnelSelect,
  type FunnelOption,
  type ClientOption,
} from "./WhatsAppManagerView";

type EvoModalState =
  | { type: "none" }
  | { type: "create"; stage: "name" | "creating" | "created"; id?: string; instanceName?: string }
  | { type: "qr"; id: string; instanceName: string; forceLogout: boolean }
  | { type: "link"; id: string; instanceName: string };

export function EvolutionView({ funnels, clients, appBaseUrl }: { funnels: FunnelOption[]; clients: ClientOption[]; appBaseUrl: string }) {
  const [sessions, setSessions] = useState<EnrichedEvolutionSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [evoModal, setEvoModal] = useState<EvoModalState>({ type: "none" });

  // Create
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState("");

  // QR
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrStage, setQrStage] = useState<"generating" | "scanning" | "done">("generating");
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const qrShownRef = useRef(false);

  // Link compartilhável de QR (pra enviar a quem tem o celular físico)
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

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
      const res = await fetch("/api/whatsapp/evolution-manager");
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

  async function handleRefreshWebhooks() {
    setRefreshingWebhooks(true);
    setWebhookRefreshResult(null);
    try {
      const res = await fetch("/api/whatsapp/evolution-manager/refresh-webhooks", { method: "POST" });
      const data = await res.json() as { results?: { instanceName: string; ok: boolean }[]; baseUrl?: string };
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
    if (evoModal.type !== "qr") return;

    const { id, forceLogout } = evoModal;
    qrShownRef.current = false;
    setQrImage(null);
    setQrStage("generating");
    setCooldownSeconds(0);
    setShareUrl(null);
    setShareCopied(false);

    let poll: ReturnType<typeof setInterval>;
    let cooldownTick: ReturnType<typeof setInterval> | undefined;
    let alive = true;
    let connecting = false;
    let lastQr: string | null = null;
    let qrSetAt = 0;

    const webhookUrl = `${appBaseUrl}/api/whatsapp/webhook/evolution/${id}`;

    const connectAndFetchQr = async (force: boolean) => {
      if (connecting || !alive) return;
      connecting = true;
      try {
        const res = await fetch(`/api/whatsapp/evolution-manager/${id}/connect`, {
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
          const res = await fetch(`/api/whatsapp/evolution-manager/${id}/status`);
          const d = await res.json() as { connected?: boolean; qr?: string | null };
          if (d.qr) {
            if (d.qr !== lastQr) {
              lastQr = d.qr; qrSetAt = Date.now();
              setQrImage(d.qr); setQrStage("scanning"); qrShownRef.current = true;
            } else if (!d.connected && Date.now() - qrSetAt > 65000) {
              setQrImage(null); setQrStage("generating");
              connectAndFetchQr(false);
            }
          }
          if (d.connected && qrShownRef.current) {
            setQrStage("done"); clearInterval(poll); alive = false;
            setTimeout(() => { setEvoModal({ type: "none" }); fetchSessions(); }, 1500);
          }
        } catch { /**/ }
      }, 3000);
    };

    connectAndFetchQr(forceLogout).then(() => { if (alive) startPolling(); });

    return () => { alive = false; clearInterval(poll); clearInterval(cooldownTick); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evoModal.type === "qr" ? `${(evoModal as { id: string }).id}-${(evoModal as { forceLogout: boolean }).forceLogout}` : null]);

  async function handleCreate() {
    if (!newName.trim()) { setCreateError("Informe um nome"); return; }
    setCreateError("");
    setEvoModal({ type: "create", stage: "creating" });

    const res = await fetch("/api/whatsapp/evolution-manager", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    const data = await res.json() as { id?: string; instanceName?: string; error?: string };

    if (!res.ok || !data.id) {
      setEvoModal({ type: "create", stage: "name" });
      setCreateError(data.error ?? "Erro ao criar instância");
      return;
    }

    setEvoModal({ type: "create", stage: "created", id: data.id, instanceName: data.instanceName });
    fetchSessions();
  }

  async function handleLink() {
    if (evoModal.type !== "link") return;
    setSavingLink(true);
    await fetch("/api/whatsapp/evolution-manager/link", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: evoModal.id, funnelId: linkFunnelId || null, clientId: linkClientId || null, linkAgent,
        reuseConnectionId: reuseConnectionId || undefined,
      }),
    });
    setSavingLink(false); setEvoModal({ type: "none" }); setReuseConnectionId(""); fetchSessions();
  }

  async function handleDelete(id: string) {
    setDeletingId(null);
    await fetch(`/api/whatsapp/evolution-manager/${id}`, { method: "DELETE" });
    fetchSessions();
  }

  async function handleGenerateShareLink(force = false) {
    if (evoModal.type !== "qr") return;
    setShareLoading(true);
    setShareCopied(false);
    try {
      const res = await fetch(`/api/whatsapp/evolution-manager/${evoModal.id}/share-link`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = await res.json() as { token?: string };
      if (data.token) setShareUrl(`${appBaseUrl}/conectar-evolution/${data.token}`);
    } finally {
      setShareLoading(false);
    }
  }

  function handleCopyShareUrl() {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    });
  }

  const connectedCount = sessions.filter(s => s.status === "connected").length;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Evolution API</h1>
          <p className="text-sm text-slate-500 mt-0.5">Gerencie suas instâncias Evolution API</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-4 py-2 shadow-sm">
            <span className={`h-2.5 w-2.5 rounded-full ${connectedCount > 0 ? "bg-emerald-500 animate-pulse" : "bg-slate-300"}`} />
            <span className="text-sm font-medium text-slate-700">{connectedCount} / {sessions.length} conectada{sessions.length !== 1 ? "s" : ""}</span>
          </div>
          <button
            onClick={handleRefreshWebhooks}
            disabled={refreshingWebhooks}
            title="Reregistra o webhook no servidor Evolution — use se as mensagens não estiverem chegando"
            className="flex items-center gap-2 bg-white border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 text-sm font-medium rounded-xl px-4 py-2.5 transition shadow-sm disabled:opacity-50"
          >
            {refreshingWebhooks ? (
              <span className="h-4 w-4 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" />
            ) : (
              <span>🔗</span>
            )}
            Reconectar Webhooks
          </button>
          <button
            onClick={() => { setNewName(""); setCreateError(""); setEvoModal({ type: "create", stage: "name" }); }}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl px-4 py-2.5 transition shadow-sm"
          >
            <span className="text-lg leading-none">+</span> Nova Instância
          </button>
        </div>
      </div>

      {/* Toast de resultado do refresh webhooks */}
      {webhookRefreshResult && (
        <div className="mb-4 px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-medium">
          {webhookRefreshResult}
        </div>
      )}

      {/* Info banner */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 mb-5 flex items-start gap-3">
        <span className="text-xl mt-0.5">🧬</span>
        <div className="flex-1 text-sm text-emerald-700">
          <p className="font-semibold mb-0.5">Evolution API Server</p>
          <p className="text-emerald-600 text-xs">Configure o servidor e a API key admin em Configurações. Suporta rastreio CTWa de anúncios via <code className="font-mono bg-emerald-100 px-1 rounded">contextInfo.externalAdReplyInfo</code>.</p>
        </div>
      </div>

      {/* Sessions list */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin h-8 w-8 border-2 border-slate-200 border-t-emerald-500 rounded-full" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <span className="text-5xl mb-4">🧬</span>
          <p className="text-lg font-semibold text-slate-600 mb-1">Nenhuma instância encontrada</p>
          <p className="text-sm mb-6">Crie uma nova instância Evolution para começar</p>
          <button onClick={() => { setNewName(""); setCreateError(""); setEvoModal({ type: "create", stage: "name" }); }}
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl px-5 py-2.5 transition">
            + Nova Instância
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
                    <span className={`mt-1.5 flex-shrink-0 h-3 w-3 rounded-full ${isConnected ? "bg-emerald-500 animate-pulse" : isConnecting ? "bg-yellow-400 animate-pulse" : "bg-slate-300"}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-slate-900">{s.instanceName}</h3>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isConnected ? "bg-emerald-100 text-emerald-700" : isConnecting ? "bg-yellow-100 text-yellow-700" : "bg-slate-100 text-slate-500"}`}>
                          {isConnected ? "Conectado" : isConnecting ? "Aguardando QR..." : "Desconectado"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {s.linkedFunnelName
                          ? <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-0.5 font-medium">🎯 {s.linkedFunnelName}{s.linkedClientName ? ` · ${s.linkedClientName}` : ""}</span>
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
                      <button onClick={() => setEvoModal({ type: "qr", id: s.id, instanceName: s.instanceName, forceLogout: true })}
                        className="text-xs font-semibold border border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-xl px-3 py-1.5 transition">
                        🔄 Trocar
                      </button>
                    ) : (
                      <button onClick={() => setEvoModal({ type: "qr", id: s.id, instanceName: s.instanceName, forceLogout: false })}
                        className="text-xs font-semibold border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-xl px-3 py-1.5 transition">
                        🔌 Conectar
                      </button>
                    )}
                    <ActionBtn onClick={() => { setLinkFunnelId(s.linkedFunnelId ?? ""); setLinkClientId(s.linkedClientId ?? ""); setLinkAgent(s.hasAgentLinked); setReuseConnectionId(""); setEvoModal({ type: "link", id: s.id, instanceName: s.instanceName }); }}
                      title="Vincular CRM/Agente" className="border-slate-200 text-slate-600 hover:text-emerald-700 hover:bg-emerald-50">🔀</ActionBtn>
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
      {evoModal.type !== "none" && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" onClick={() => setEvoModal({ type: "none" })} />
      )}

      {/* CRIAR */}
      {evoModal.type === "create" && (
        <Modal title="Nova Instância Evolution" onClose={() => setEvoModal({ type: "none" })}>
          {evoModal.stage === "name" && (
            <>
              <p className="text-sm text-slate-500 mb-4">Digite um nome para identificar esta instância.</p>
              <input autoFocus value={newName}
                onChange={e => setNewName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                onKeyDown={e => e.key === "Enter" && handleCreate()}
                placeholder="ex: vendas, suporte, atendimento"
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 mb-1"
              />
              {createError && <p className="text-xs text-red-500 mb-3 mt-1">{createError}</p>}
              <p className="text-xs text-slate-400 mb-4">Só letras minúsculas, números e hífens.</p>
              <div className="flex gap-2">
                <button onClick={() => setEvoModal({ type: "none" })} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">Cancelar</button>
                <button onClick={handleCreate} disabled={!newName.trim()} className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition">
                  Criar Instância →
                </button>
              </div>
            </>
          )}
          {evoModal.stage === "creating" && (
            <div className="py-8 text-center">
              <div className="animate-spin h-10 w-10 border-2 border-slate-200 border-t-emerald-500 rounded-full mx-auto mb-4" />
              <p className="font-semibold text-slate-700">Criando instância na Evolution...</p>
            </div>
          )}
          {evoModal.stage === "created" && evoModal.id && (
            <>
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 mb-5 text-center">
                <div className="text-3xl mb-2">✅</div>
                <p className="font-bold text-emerald-800">Instância <span className="font-mono">{evoModal.instanceName}</span> criada!</p>
                <p className="text-xs text-emerald-600 mt-1">Agora conecte um número via QR Code.</p>
              </div>
              <button onClick={() => setEvoModal({ type: "qr", id: evoModal.id!, instanceName: evoModal.instanceName!, forceLogout: false })}
                className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 py-2.5 text-sm font-semibold text-white transition">
                📷 Conectar via QR Code
              </button>
            </>
          )}
        </Modal>
      )}

      {/* QR Code */}
      {evoModal.type === "qr" && (
        <Modal title={`Conectar — ${evoModal.instanceName}`} onClose={() => setEvoModal({ type: "none" })} wide>
          <div className="text-center">
            {qrStage === "done" ? (
              <div className="py-6">
                <div className="text-5xl mb-2">✅</div>
                <p className="font-bold text-emerald-700 text-lg">Conectado com sucesso!</p>
              </div>
            ) : qrImage ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrImage} alt="QR Code" className="w-64 h-64 mx-auto rounded-2xl border-4 border-emerald-100 shadow-md mb-3" />
                <p className="text-sm font-medium text-slate-700 mb-1">Abra o WhatsApp → <strong>Aparelhos Conectados</strong> → <strong>Vincular</strong></p>
                <p className="text-xs text-slate-400">Atualiza automaticamente</p>
              </>
            ) : cooldownSeconds > 0 ? (
              <div className="w-64 h-64 mx-auto rounded-2xl border-2 border-dashed border-amber-200 bg-amber-50 flex flex-col items-center justify-center mb-3 gap-2">
                <div className="text-3xl font-bold text-amber-600">{cooldownSeconds}s</div>
                <p className="text-xs text-amber-700 px-6 text-center">
                  O servidor está liberando a instância anterior. Isso é normal — tentando de novo em {cooldownSeconds}s...
                </p>
              </div>
            ) : (
              <div className="w-64 h-64 mx-auto rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center mb-3 gap-3">
                <div className="animate-spin h-8 w-8 border-2 border-slate-200 border-t-emerald-500 rounded-full" />
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

            {qrStage !== "done" && (
              <div className="mt-5 pt-4 border-t border-slate-100 text-left">
                <p className="text-xs font-semibold text-slate-600 mb-2">📱 Não está com o celular? Envie o link abaixo pra quem estiver</p>
                {shareUrl ? (
                  <>
                    <div className="flex items-center gap-2 bg-slate-900 rounded-lg px-3 py-2">
                      <span className="text-xs text-slate-300 font-mono truncate flex-1">{shareUrl}</span>
                      <button
                        onClick={handleCopyShareUrl}
                        className="shrink-0 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold rounded px-2.5 py-1 transition"
                      >
                        {shareCopied ? "Copiado ✓" : "Copiar"}
                      </button>
                    </div>
                    <p className="text-xs text-amber-600 mt-2">⚠️ Não envie print do QR Code, ele expira rápido — envie este link.</p>
                    <button
                      onClick={() => handleGenerateShareLink(true)}
                      disabled={shareLoading}
                      className="text-xs text-slate-400 hover:text-slate-600 mt-2 underline disabled:opacity-50"
                    >
                      Gerar um link novo
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => handleGenerateShareLink(false)}
                    disabled={shareLoading}
                    className="w-full rounded-lg border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 text-sm font-medium py-2 transition disabled:opacity-50"
                  >
                    {shareLoading ? "Gerando link..." : "🔗 Gerar link para enviar"}
                  </button>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Vincular */}
      {evoModal.type === "link" && (
        <Modal title={`Vincular — ${evoModal.instanceName}`} onClose={() => setEvoModal({ type: "none" })}>
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
                    <div className={`relative w-10 rounded-full transition-colors ${linkAgent ? "bg-emerald-500" : "bg-slate-300"}`} style={{ height: "22px" }}>
                      <span className="absolute top-[2px] bg-white shadow rounded-full transition-transform" style={{ width: 18, height: 18, left: 2, transform: linkAgent ? "translateX(18px)" : "translateX(0)" }} />
                    </div>
                    <span className="text-sm text-slate-700">Ativar Agente IA nesta instância</span>
                  </label>
                  {linkAgent && (
                    <ReuseAgentSelect clients={clients} clientId={linkClientId} value={reuseConnectionId} onChange={setReuseConnectionId} accentColor="violet" />
                  )}
                </>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEvoModal({ type: "none" })} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600">Cancelar</button>
              <button onClick={handleLink} disabled={savingLink} className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                {savingLink ? "Salvando..." : "Salvar Vínculo"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
