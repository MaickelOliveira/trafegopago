"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import type { FunnelConnection, ConnectionType } from "@/lib/funnels";

declare global {
  interface Window {
    FB: {
      init: (opts: Record<string, unknown>) => void;
      login: (cb: (r: { authResponse?: { code?: string } }) => void, opts: Record<string, unknown>) => void;
    };
    fbAsyncInit?: () => void;
  }
}

type InstStatus = { status: string; phone: string | null; name: string | null; qr?: string | null; type?: string };
type Instances = Record<string, InstStatus>;
type FunnelInfo = { id: string; name: string; clientId?: string | null; connections?: FunnelConnection[] };
type WppSession = { id: string; sessionName: string; status: string; phone: string | null; linkedFunnelId: string | null; linkedFunnelName: string | null };

export function WhatsAppStatus({ clients, funnels: funnelsProp = [], clientId, readOnly = false }: {
  clients: { id: string; name: string }[];
  funnels?: FunnelInfo[];
  clientId?: string;
  readOnly?: boolean;
  server?: string; token?: string;
}) {
  const [instances, setInstances] = useState<Instances>({});
  const [showPanel, setShowPanel] = useState(false);
  const [funnels, setFunnels] = useState<FunnelInfo[]>(funnelsProp);
  const [wppSessions, setWppSessions] = useState<WppSession[]>([]);
  const [qrData, setQrData] = useState<{ connId: string; qr: string; funnelName: string } | null>(null);
  const [metaAppId, setMetaAppId] = useState<string>("");
  const [metaConfigId, setMetaConfigId] = useState<string>("");

  // Modal adicionar conexão
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newType, setNewType] = useState<ConnectionType>("uazapi");
  const [newInstanceName, setNewInstanceName] = useState("");
  const [newMetaId, setNewMetaId] = useState("");
  const [newMetaToken, setNewMetaToken] = useState("");
  const [newVerifyToken, setNewVerifyToken] = useState("trafegopago");
  const [saving, setSaving] = useState(false);
  const [embeddedStatus, setEmbeddedStatus] = useState<"idle" | "loading" | "running" | "done" | "error">("idle");
  const [embeddedError, setEmbeddedError] = useState("");
  const embeddedFunnelRef = useRef<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchInstances();
    fetchFunnels();
    fetchWppSessions();
    const t = setInterval(() => { fetchInstances(); fetchWppSessions(); }, 8000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // Refetch funis quando painel abre
  useEffect(() => {
    if (showPanel) { fetchFunnels(); fetchWppSessions(); }
  }, [showPanel]);

  // Quando clientId muda, reseta para a prop e busca dados atualizados do servidor
  useEffect(() => {
    setFunnels(funnelsProp);
    fetchFunnels();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // Poll QR
  useEffect(() => {
    if (!qrData) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/crm/whatsapp/status?clientId=${qrData.connId}`);
      const d = await res.json();
      if (d.connected) { setQrData(null); fetchInstances(); }
      else if (d.qr) setQrData(prev => prev ? { ...prev, qr: d.qr } : null);
    }, 5000);
    return () => clearInterval(t);
  }, [qrData]);

  // ── Embedded Signup Meta SDK ─────────────────────────────────────────────
  const loadMetaSDK = useCallback((appId: string) => {
    return new Promise<void>((resolve) => {
      if (typeof window.FB !== "undefined") { resolve(); return; }
      window.fbAsyncInit = () => {
        window.FB.init({ appId, version: "v21.0", xfbml: false, cookie: false });
        resolve();
      };
      if (!document.getElementById("facebook-jssdk")) {
        const s = document.createElement("script");
        s.id = "facebook-jssdk";
        s.src = "https://connect.facebook.net/pt_BR/sdk.js";
        s.async = true;
        document.head.appendChild(s);
      }
    });
  }, []);

  // Listener para capturar wabaId + phoneNumberId da sessão
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== "https://www.facebook.com") return;
      try {
        const d = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (d?.type !== "WA_EMBEDDED_SIGNUP") return;
        if (d.event === "FINISH") {
          const { phone_number_id: phoneNumberId, waba_id: wabaId } = d.data ?? {};
          const code = d.authResponse?.code;
          const funnelId = embeddedFunnelRef.current;
          if (!code || !phoneNumberId || !wabaId || !funnelId) return;
          completEmbeddedSignup(code, wabaId, phoneNumberId, funnelId);
        } else if (d.event === "CANCEL") {
          setEmbeddedStatus("idle");
        } else if (d.event === "ERROR") {
          setEmbeddedError(d.data?.error_message ?? "Erro no fluxo Meta");
          setEmbeddedStatus("error");
        }
      } catch { /* ignora mensagens não JSON */ }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function completEmbeddedSignup(code: string, wabaId: string, phoneNumberId: string, funnelId: string) {
    setEmbeddedStatus("loading");
    try {
      const res = await fetch("/api/meta/embedded-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, wabaId, phoneNumberId, funnelId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setEmbeddedError(data.error ?? "Falha ao salvar conexão");
        setEmbeddedStatus("error");
        return;
      }
      setEmbeddedStatus("done");
      setAddingTo(null);
      fetchFunnels();
    } catch {
      setEmbeddedError("Erro de rede ao finalizar conexão");
      setEmbeddedStatus("error");
    }
  }

  async function launchEmbeddedSignup(funnelId: string) {
    // Busca App ID em runtime via API (evita dependência de NEXT_PUBLIC_ no build)
    let appId = metaAppId;
    let configId = metaConfigId;
    if (!appId) {
      try {
        const cfg = await fetch("/api/meta/app-config").then(r => r.json());
        appId = cfg.appId ?? "";
        configId = cfg.configId ?? "";
        setMetaAppId(appId);
        setMetaConfigId(configId);
      } catch { /**/ }
    }
    if (!appId) {
      setEmbeddedError("META_APP_ID não configurado no servidor");
      setEmbeddedStatus("error");
      return;
    }
    setEmbeddedStatus("running");
    embeddedFunnelRef.current = funnelId;
    await loadMetaSDK(appId);
    window.FB.login(
      (response) => {
        if (response.authResponse?.code) {
          console.log("[EmbeddedSignup] authResponse code recebido via callback");
        }
      },
      {
        config_id: configId || undefined,
        response_type: "code",
        override_default_response_type: true,
        scope: "whatsapp_business_management,whatsapp_business_messaging",
        extras: { sessionInfoVersion: 2 },
      }
    );
  }

  async function fetchInstances() {
    try {
      const res = await fetch("/api/crm/whatsapp/instances");
      if (res.ok) setInstances(await res.json());
    } catch { /**/ }
  }

  async function fetchWppSessions() {
    try {
      const res = await fetch("/api/whatsapp/wppconnect-manager");
      if (res.ok) setWppSessions(await res.json());
    } catch { /**/ }
  }

  async function fetchFunnels() {
    try {
      const url = clientId ? `/api/crm/funnels?clientId=${encodeURIComponent(clientId)}` : "/api/crm/funnels";
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setFunnels(data.map((f: FunnelInfo) => ({ id: f.id, name: f.name, clientId: f.clientId, connections: f.connections ?? [] })));
      }
    } catch { /**/ }
  }

  async function disconnect(connId: string) {
    await fetch("/api/crm/whatsapp/instances", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: connId }),
    });
    setQrData(null); fetchInstances();
  }

  async function addConnection(funnelId: string) {
    if ((!newMetaId || !newMetaToken) && newType === "meta") return;
    setSaving(true);

    const funnel = funnels.find(f => f.id === funnelId);
    const connId = `${funnelId}_${Date.now()}`;

    if (newType === "uazapi") {
      if (!newInstanceName.trim()) { setSaving(false); return; }
      const instanceName = newInstanceName.trim().toLowerCase().replace(/\s+/g, "-");
      const res = await fetch("/api/crm/whatsapp/instances", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "uazapi", funnelId, instanceName }),
      });
      const data = await res.json();
      if (data.qr) setQrData({ connId: data.connId ?? instanceName, qr: data.qr, funnelName: funnel?.name ?? "" });
      setAddingTo(null); setNewInstanceName(""); setSaving(false);
      fetchInstances(); fetchFunnels();
      return;
    }

    // Meta: salva conexão no funil
    const conn: FunnelConnection = {
      id: connId,
      phone: newMetaId,
      type: "meta",
      metaPhoneNumberId: newMetaId,
      metaToken: newMetaToken,
      metaVerifyToken: newVerifyToken,
    };

    const connections = [...(funnel?.connections ?? []), conn];
    await fetch(`/api/crm/funnels/${funnelId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connections }),
    });

    setFunnels(prev => prev.map(f => f.id === funnelId ? { ...f, connections } : f));

    setAddingTo(null); setNewMetaId(""); setNewMetaToken(""); setSaving(false);
    fetchInstances();
  }

  async function removeConnection(funnelId: string, connId: string) {
    await disconnect(connId);
    const funnel = funnels.find(f => f.id === funnelId);
    const connections = (funnel?.connections ?? []).filter(c => c.id !== connId);
    await fetch(`/api/crm/funnels/${funnelId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connections }),
    });
    setFunnels(prev => prev.map(f => f.id === funnelId ? { ...f, connections } : f));
  }

  // Conta apenas instâncias dos funis visíveis (não todas do servidor)
  const funnelConnIds = funnels.flatMap(f => f.connections ?? []).map(c => c.id);
  const clientFunnelIds = new Set(funnels.map(f => f.id));
  const visibleWppSessions = wppSessions.filter(s => s.linkedFunnelId && clientFunnelIds.has(s.linkedFunnelId));
  const totalConnected =
    funnelConnIds.filter(id => instances[id]?.status === "connected").length +
    visibleWppSessions.filter(s => s.status === "connected").length;

  return (
    <div className="relative" ref={panelRef}>
      <button onClick={() => setShowPanel(v => !v)}
        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50 transition shadow-sm">
        <span className={`h-2 w-2 rounded-full ${totalConnected > 0 ? "bg-green-500 animate-pulse" : "bg-slate-300"}`} />
        <span className="text-xs font-medium text-slate-700">
          {totalConnected > 0 ? `💬 ${totalConnected} conectado${totalConnected > 1 ? "s" : ""}` : "📱 WhatsApp"}
        </span>
        <span className="text-slate-400 text-xs">{showPanel ? "▲" : "▼"}</span>
      </button>

      {showPanel && (
        <div className="absolute right-0 top-full mt-2 z-50 bg-white rounded-2xl border border-slate-200 shadow-2xl w-[460px] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <p className="font-semibold text-slate-800 text-sm">WhatsApp por funil</p>
            <button onClick={() => setShowPanel(false)} className="text-slate-400 hover:text-slate-600">✕</button>
          </div>

          <div className="max-h-[500px] overflow-y-auto">
            {funnels.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-6">Nenhum funil disponível</p>
            )}
            {funnels.map(f => (
              <div key={f.id} className="border-b border-slate-50 last:border-0">
                {/* Header do funil */}
                <div className="px-4 py-2.5 bg-slate-50">
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">{f.name}</p>
                </div>

                {/* Conexões do funil */}
                {(f.connections ?? []).length === 0 && visibleWppSessions.filter(s => s.linkedFunnelId === f.id).length === 0 && (
                  <p className="text-xs text-slate-400 px-4 py-2 italic">Sem número vinculado</p>
                )}
                {(f.connections ?? []).map(conn => {
                  const inst = instances[conn.id];
                  const status = inst?.status ?? "disconnected";
                  return (
                    <div key={conn.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className={`h-2 w-2 rounded-full flex-shrink-0 ${status === "connected" ? "bg-green-500" : "bg-slate-300"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800">
                          {conn.type === "meta" ? "🏢 Meta API" : "⚡ UazAPI"} · {conn.phone || conn.metaPhoneNumberId}
                        </p>
                        <p className="text-xs text-slate-400">
                          {status === "connected" ? (inst?.phone ? `+${inst.phone}` : "Conectado") : "Desconectado"}
                        </p>
                      </div>
                      <button onClick={() => removeConnection(f.id, conn.id)}
                        className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded">
                        ✕
                      </button>
                    </div>
                  );
                })}
                {/* Sessões WPPConnect vinculadas a este funil */}
                {visibleWppSessions.filter(s => s.linkedFunnelId === f.id).map(wpp => (
                  <div key={wpp.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className={`h-2 w-2 rounded-full flex-shrink-0 ${wpp.status === "connected" ? "bg-green-500" : wpp.status === "connecting" ? "bg-yellow-400 animate-pulse" : "bg-slate-300"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800">
                        📱 WPPConnect · {wpp.sessionName}
                      </p>
                      <p className="text-xs text-slate-400">
                        {wpp.status === "connected" ? (wpp.phone ? `+${wpp.phone}` : "Conectado") : wpp.status === "connecting" ? "Conectando..." : "Desconectado"}
                      </p>
                    </div>
                  </div>
                ))}

                {/* Botão adicionar + modal inline */}
                {!readOnly && (addingTo === f.id ? (
                  <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 space-y-3">
                    <p className="text-xs font-semibold text-slate-700">Escolha o tipo de conexão:</p>

                    {/* Opção: Meta Embedded Signup */}
                    <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
                      <p className="text-xs font-bold text-blue-800 mb-1">🏢 Meta Cloud API — Rastreio nativo de anúncios</p>
                      <p className="text-xs text-blue-600 mb-2">
                        Conecta via conta Meta do cliente. Captura campanha, conjunto e anúncio automaticamente em leads de Click-to-WhatsApp.
                      </p>
                      {embeddedStatus === "error" && (
                        <p className="text-xs text-red-600 mb-2">⚠️ {embeddedError}</p>
                      )}
                      {embeddedStatus === "done" && (
                        <p className="text-xs text-green-700 mb-2">✅ Conectado com sucesso!</p>
                      )}
                      <button
                        onClick={() => launchEmbeddedSignup(f.id)}
                        disabled={embeddedStatus === "running" || embeddedStatus === "loading"}
                        className="w-full rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold py-2 transition">
                        {embeddedStatus === "running" ? "Aguardando Meta..." :
                         embeddedStatus === "loading" ? "Salvando conexão..." :
                         "Conectar via Meta (Embedded Signup)"}
                      </button>
                    </div>

                    {/* Separador */}
                    <p className="text-xs text-slate-400 text-center">— ou —</p>

                    {/* Opção: UazAPI */}
                    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
                      <p className="text-xs font-bold text-slate-700">⚡ UazAPI (QR Code)</p>
                      <input
                        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
                        placeholder="Nome da instância (ex: nexo-principal)"
                        value={newInstanceName}
                        onChange={e => setNewInstanceName(e.target.value)}
                      />
                      <button
                        onClick={() => { setNewType("uazapi"); addConnection(f.id); }}
                        disabled={saving || !newInstanceName.trim()}
                        className="w-full rounded-lg bg-slate-700 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-semibold py-2 transition">
                        {saving ? "Criando..." : "Criar instância QR Code"}
                      </button>
                    </div>

                    <button onClick={() => { setAddingTo(null); setEmbeddedStatus("idle"); setEmbeddedError(""); }}
                      className="w-full text-xs text-slate-400 hover:text-slate-600 py-1">
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <div className="px-4 py-2">
                    <button
                      onClick={() => { setAddingTo(f.id); setEmbeddedStatus("idle"); setEmbeddedError(""); setNewInstanceName(""); }}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                      + Adicionar número
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
