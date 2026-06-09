"use client";

import { useState, useEffect, useCallback, useRef } from "react";

type Connection = {
  id: string;
  phone: string;
  type: string;
  status: string;
  connected: boolean;
  funnelId: string;
  funnelName: string;
  qr?: string | null;
};

function displayConnection(phone: string, type: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 8) {
    const d = digits;
    if (d.length === 13) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,9)}-${d.slice(9)}`;
    if (d.length === 12) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,8)}-${d.slice(8)}`;
    if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
    return phone;
  }
  return type === "wppconnect" ? "Linha WhatsApp" : phone;
}

export function ClientWhatsAppConnect() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingQr, setLoadingQr] = useState<string | null>(null);
  const [qrData, setQrData] = useState<Record<string, string | null>>({});
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/cliente/connection-status");
      if (res.ok) {
        const data = await res.json();
        setConnections(data.connections ?? []);
        for (const c of data.connections ?? []) {
          if (c.qr) setQrData((prev) => ({ ...prev, [c.id]: c.qr }));
        }
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchStatus();
    const t = setInterval(fetchStatus, 10000);
    return () => clearInterval(t);
  }, [fetchStatus]);

  // Fecha ao clicar fora
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  async function generateQr(connectionId: string) {
    setLoadingQr(connectionId);
    try {
      const res = await fetch("/api/cliente/connection-qr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });
      const data = await res.json();
      setQrData((prev) => ({ ...prev, [connectionId]: data.qr ?? null }));
    } catch {}
    setLoadingQr(null);
  }

  const allConnected = connections.length > 0 && connections.every((c) => c.connected);
  const anyConnected = connections.some((c) => c.connected);

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50 transition shadow-sm"
      >
        <span className={`h-2 w-2 rounded-full ${anyConnected ? "bg-green-500 animate-pulse" : "bg-slate-300"}`} />
        <span className="text-xs font-medium text-slate-700">
          {loading ? "WhatsApp..." : anyConnected ? "📱 Conectado" : "📱 Conectar WhatsApp"}
        </span>
        <span className="text-slate-400 text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 bg-white rounded-2xl border border-slate-200 shadow-2xl w-[400px] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <p className="font-semibold text-slate-800 text-sm">Conexão WhatsApp</p>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
          </div>

          <div className="max-h-[500px] overflow-y-auto p-3 space-y-3">
            {loading ? (
              <div className="flex items-center gap-3 text-slate-400 text-sm p-3">
                <span className="w-4 h-4 border-2 border-slate-300 border-t-violet-500 rounded-full animate-spin" />
                Verificando conexão...
              </div>
            ) : connections.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-4">
                Nenhuma conexão configurada. Entre em contato com o suporte.
              </p>
            ) : (() => {
              // Agrupa por funil
              const byFunnel: Record<string, { funnelName: string; conns: Connection[] }> = {};
              for (const conn of connections) {
                const key = conn.funnelId || "__sem_funil__";
                if (!byFunnel[key]) byFunnel[key] = { funnelName: conn.funnelName || "Sem funil", conns: [] };
                byFunnel[key].conns.push(conn);
              }
              return Object.entries(byFunnel).map(([funnelId, { funnelName, conns }]) => (
                <div key={funnelId}>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 px-1">📋 {funnelName}</p>
                  {conns.map((conn) => {
                    const qr = qrData[conn.id];
                    return (
                      <div key={conn.id} className="rounded-xl border border-slate-100 overflow-hidden mb-2">
                        <div className="flex items-center justify-between px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${conn.connected ? "bg-green-500 animate-pulse" : "bg-amber-400"}`} />
                            <div>
                              <p className="text-sm font-medium text-slate-800">{displayConnection(conn.phone, conn.type)}</p>
                              <p className="text-xs text-slate-400">{conn.connected ? "Conectado" : "Desconectado"}</p>
                            </div>
                          </div>
                          {conn.connected && (
                            <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">✓ Ativo</span>
                          )}
                        </div>
                        {!conn.connected && (
                          <div className="px-4 pb-4 space-y-3 border-t border-slate-50">
                            <p className="text-xs text-amber-700 pt-3">⚠️ Desconectado. Gere o QR Code e escaneie pelo WhatsApp do celular.</p>
                            <button
                              onClick={() => generateQr(conn.id)}
                              disabled={loadingQr === conn.id}
                              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60 transition w-full justify-center"
                            >
                              {loadingQr === conn.id ? <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> : (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 3.5a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" /></svg>
                              )}
                              {loadingQr === conn.id ? "Gerando..." : "Gerar QR Code"}
                            </button>
                            {qr && (
                              <div className="flex flex-col items-center gap-2 bg-slate-50 rounded-xl p-3">
                                <img src={qr} alt="QR Code WhatsApp" className="w-44 h-44 rounded-lg border-4 border-white shadow-md" />
                                <ol className="text-xs text-slate-500 text-left space-y-0.5 w-full">
                                  <li>1. Abra o <strong>WhatsApp</strong> no celular</li>
                                  <li>2. Toque nos <strong>3 pontinhos</strong> → <strong>Aparelhos conectados</strong></li>
                                  <li>3. Toque em <strong>Conectar aparelho</strong> e escaneie</li>
                                </ol>
                              </div>
                            )}
                            {qr === null && loadingQr !== conn.id && (
                              <p className="text-xs text-slate-400">Indisponível no momento. Tente novamente em alguns segundos.</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ));
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
