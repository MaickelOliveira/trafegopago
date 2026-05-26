"use client";
import { useState, useEffect, useRef } from "react";
import type { FunnelConnection, ConnectionType } from "@/lib/funnels";

type InstStatus = { status: string; phone: string | null; name: string | null; qr?: string | null; type?: string };
type Instances = Record<string, InstStatus>;
type FunnelInfo = { id: string; name: string; clientId?: string | null; connections?: FunnelConnection[] };

export function WhatsAppStatus({ clients, funnels: funnelsProp = [], clientId }: {
  clients: { id: string; name: string }[];
  funnels?: FunnelInfo[];
  clientId?: string;
  server?: string; token?: string;
}) {
  const [instances, setInstances] = useState<Instances>({});
  const [showPanel, setShowPanel] = useState(false);
  const [funnels, setFunnels] = useState<FunnelInfo[]>(funnelsProp);
  const [qrData, setQrData] = useState<{ connId: string; qr: string; funnelName: string } | null>(null);

  // Modal adicionar conexão
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newType, setNewType] = useState<ConnectionType>("uazapi");
  const [newInstanceName, setNewInstanceName] = useState("");
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

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
  const totalConnected = funnelConnIds.filter(id => instances[id]?.status === "connected").length;

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
                {(f.connections ?? []).length === 0 && (
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
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
