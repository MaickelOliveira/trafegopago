"use client";
import { useState, useEffect, useRef } from "react";
import type { FunnelConnection, ConnectionType } from "@/lib/funnels";

type InstStatus = { status: string; phone: string | null; name: string | null; qr?: string | null; type?: string };
type Instances = Record<string, InstStatus>;
type FunnelInfo = { id: string; name: string; clientId?: string | null; connections?: FunnelConnection[] };

export function WhatsAppStatus({ clients, funnels: funnelsProp = [] }: {
  clients: { id: string; name: string }[];
  funnels?: FunnelInfo[];
  server?: string; token?: string;
}) {
  const [instances, setInstances] = useState<Instances>({});
  const [showPanel, setShowPanel] = useState(false);
  const [funnels, setFunnels] = useState<FunnelInfo[]>(funnelsProp);
  const [qrData, setQrData] = useState<{ connId: string; qr: string; funnelName: string } | null>(null);

  // Modal adicionar conexão
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newType, setNewType] = useState<ConnectionType>("baileys");
  const [newPhone, setNewPhone] = useState("");
  const [newMetaId, setNewMetaId] = useState("");
  const [newMetaToken, setNewMetaToken] = useState("");
  const [newVerifyToken, setNewVerifyToken] = useState("trafegopago");
  const [saving, setSaving] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchInstances();
    fetchFunnels();
    const t = setInterval(fetchInstances, 8000);
    return () => clearInterval(t);
  }, []);

  // Refetch funis quando painel abre
  useEffect(() => {
    if (showPanel) fetchFunnels();
  }, [showPanel]);

  // Sincroniza funnels com prop (quando cliente muda)
  useEffect(() => { setFunnels(funnelsProp); }, [funnelsProp]);

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

  async function fetchInstances() {
    try {
      const res = await fetch("/api/crm/whatsapp/instances");
      if (res.ok) setInstances(await res.json());
    } catch { /**/ }
  }

  async function fetchFunnels() {
    try {
      const res = await fetch("/api/crm/funnels");
      if (res.ok) {
        const data = await res.json();
        setFunnels(data.map((f: FunnelInfo) => ({ id: f.id, name: f.name, clientId: f.clientId, connections: f.connections ?? [] })));
      }
    } catch { /**/ }
  }

  async function connect(connId: string, funnelId: string, clientId: string | null | undefined) {
    setSaving(true);
    const res = await fetch("/api/crm/whatsapp/instances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: connId, funnelId, baileysClientId: clientId }),
    });
    const data = await res.json();
    if (data.qr) {
      const f = funnels.find(f => f.connections?.some(c => c.id === connId));
      setQrData({ connId, qr: data.qr, funnelName: f?.name ?? "" });
    }
    setSaving(false); fetchInstances();
  }

  async function disconnect(connId: string) {
    await fetch("/api/crm/whatsapp/instances", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: connId }),
    });
    setQrData(null); fetchInstances();
  }

  async function addConnection(funnelId: string) {
    if (!newPhone.trim() && newType === "baileys") return;
    if ((!newMetaId || !newMetaToken) && newType === "meta") return;
    setSaving(true);

    const connId = `${funnelId}_${Date.now()}`;
    const conn: FunnelConnection = {
      id: connId,
      phone: newType === "meta" ? newMetaId : newPhone.replace(/\D/g, ""),
      type: newType,
      ...(newType === "meta" ? { metaPhoneNumberId: newMetaId, metaToken: newMetaToken, metaVerifyToken: newVerifyToken } : {}),
    };

    // Salva no funil via API
    const funnel = funnels.find(f => f.id === funnelId);
    const connections = [...(funnel?.connections ?? []), conn];
    await fetch(`/api/crm/funnels/${funnelId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connections }),
    });

    setFunnels(prev => prev.map(f => f.id === funnelId ? { ...f, connections } : f));

    // Conecta
    if (newType === "meta") {
      await fetch("http://localhost:3002/connect", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId: connId, funnelId, clientId: funnel?.clientId, type: "meta", metaPhoneNumberId: newMetaId, metaToken: newMetaToken }),
      }).catch(() => {});
    } else {
      const res = await fetch("/api/crm/whatsapp/instances", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: connId, funnelId }),
      });
      const data = await res.json();
      if (data.qr) setQrData({ connId, qr: data.qr, funnelName: funnel?.name ?? "" });
    }

    setAddingTo(null); setNewPhone(""); setNewMetaId(""); setNewMetaToken(""); setSaving(false);
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

  const totalConnected = Object.values(instances).filter(i => i?.status === "connected").length;

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
                <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50">
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">{f.name}</p>
                  <button onClick={() => setAddingTo(addingTo === f.id ? null : f.id)}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-800">
                    + Adicionar número
                  </button>
                </div>

                {/* Conexões do funil */}
                {(f.connections ?? []).length === 0 && (
                  <p className="text-xs text-slate-400 px-4 py-2 italic">Nenhum número conectado</p>
                )}
                {(f.connections ?? []).map(conn => {
                  const inst = instances[conn.id];
                  const status = inst?.status ?? "disconnected";
                  return (
                    <div key={conn.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className={`h-2 w-2 rounded-full flex-shrink-0 ${status === "connected" ? "bg-green-500" : status === "connecting" ? "bg-yellow-400 animate-pulse" : "bg-slate-300"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800">
                          {conn.type === "meta" ? "🏢 Meta API" : "📱 Baileys"} · {conn.phone || conn.metaPhoneNumberId}
                        </p>
                        <p className="text-xs text-slate-400">
                          {status === "connected" ? (inst?.phone ? `+${inst.phone}` : "Conectado") : status === "connecting" ? "Aguardando scan..." : "Desconectado"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {status !== "connected" && conn.type === "baileys" && (
                          <button onClick={() => connect(conn.id, f.id, f.clientId)}
                            className="text-xs font-semibold text-white bg-green-600 hover:bg-green-700 rounded-lg px-2.5 py-1">
                            Conectar
                          </button>
                        )}
                        {status === "connected" && (
                          <button onClick={() => disconnect(conn.id)}
                            className="text-xs text-slate-400 hover:text-red-500 border border-slate-200 rounded-lg px-2 py-1">
                            Pausar
                          </button>
                        )}
                        <button onClick={() => removeConnection(f.id, conn.id)}
                          className="text-xs text-slate-300 hover:text-red-500 px-1">✕</button>
                      </div>
                    </div>
                  );
                })}

                {/* Form adicionar número */}
                {addingTo === f.id && (
                  <div className="px-4 pb-3 pt-1 bg-blue-50/50 border-t border-blue-100">
                    <p className="text-xs font-semibold text-slate-600 mb-2">Tipo de conexão</p>
                    <div className="flex gap-2 mb-3">
                      {(["baileys", "meta"] as ConnectionType[]).map(t => (
                        <button key={t} onClick={() => setNewType(t)}
                          className={`flex-1 py-1.5 text-xs font-semibold rounded-lg border transition ${newType === t ? "border-blue-500 bg-blue-600 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                          {t === "baileys" ? "📱 QR Code (Baileys)" : "🏢 Meta API Oficial"}
                        </button>
                      ))}
                    </div>

                    {newType === "baileys" && (
                      <input value={newPhone} onChange={e => setNewPhone(e.target.value)}
                        placeholder="Número do WhatsApp (ex: 5544999999999)"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 mb-2" />
                    )}

                    {newType === "meta" && (
                      <div className="space-y-2 mb-2">
                        <input value={newMetaId} onChange={e => setNewMetaId(e.target.value)}
                          placeholder="Phone Number ID (do Meta Business)"
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400" />
                        <input value={newMetaToken} onChange={e => setNewMetaToken(e.target.value)}
                          placeholder="Token permanente (System User Token)"
                          type="password"
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400" />
                        <div>
                          <input value={newVerifyToken} onChange={e => setNewVerifyToken(e.target.value)}
                            placeholder="Verify Token (para o webhook Meta)"
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400" />
                          <p className="text-[10px] text-slate-400 mt-1">
                            URL do webhook Meta: <span className="font-mono">{typeof window !== "undefined" ? window.location.origin : ""}/api/whatsapp/meta</span>
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button onClick={() => setAddingTo(null)} className="flex-1 rounded-lg border border-slate-200 py-1.5 text-xs text-slate-600">Cancelar</button>
                      <button onClick={() => addConnection(f.id)} disabled={saving}
                        className="flex-1 rounded-lg bg-blue-600 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                        {saving ? "Salvando..." : newType === "baileys" ? "Gerar QR" : "Conectar"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* QR Code */}
          {qrData && (
            <div className="border-t border-slate-100 p-4 bg-slate-50">
              <p className="text-xs font-semibold text-slate-700 mb-1">Escanear — {qrData.funnelName}</p>
              <p className="text-xs text-slate-500 mb-3">WhatsApp Business → <strong>Aparelhos conectados</strong> → <strong>Vincular</strong></p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrData.qr} alt="QR" className="w-full max-w-[240px] mx-auto rounded-xl border border-slate-100" />
              <p className="text-[10px] text-slate-400 text-center mt-2">Atualiza automaticamente a cada 30s</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
