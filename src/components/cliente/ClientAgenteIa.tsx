"use client";

import { useState, useEffect, useCallback } from "react";
import type { AgentConfig } from "@/lib/clients";

type Connection = {
  id: string;
  phone: string;
  type: string;
  status: string;
  connected: boolean;
  qr?: string | null;
};

type Props = {
  agentConfigs: AgentConfig[];
  clientName: string;
};

function statusLabel(conn: Connection) {
  if (conn.connected) return { text: "Conectado", color: "text-emerald-600 bg-emerald-50 border-emerald-200" };
  if (conn.status === "error") return { text: "Erro", color: "text-red-600 bg-red-50 border-red-200" };
  return { text: "Desconectado", color: "text-amber-600 bg-amber-50 border-amber-200" };
}

export function ClientAgenteIa({ agentConfigs, clientName }: Props) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loadingQr, setLoadingQr] = useState<string | null>(null);
  const [qrData, setQrData] = useState<Record<string, string | null>>({});

  const [changeMsg, setChangeMsg] = useState("");
  const [sendingChange, setSendingChange] = useState(false);
  const [changeSent, setChangeSent] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/cliente/connection-status");
      if (res.ok) {
        const data = await res.json();
        setConnections(data.connections ?? []);
        // Update QR from status response
        for (const c of data.connections ?? []) {
          if (c.qr) setQrData((prev) => ({ ...prev, [c.id]: c.qr }));
        }
      }
    } catch {}
    setLoadingStatus(false);
  }, []);

  useEffect(() => {
    fetchStatus();
    const t = setInterval(fetchStatus, 10000);
    return () => clearInterval(t);
  }, [fetchStatus]);

  async function generateQr(connectionId: string) {
    setLoadingQr(connectionId);
    try {
      const res = await fetch("/api/cliente/connection-qr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });
      const data = await res.json();
      if (data.qr) setQrData((prev) => ({ ...prev, [connectionId]: data.qr }));
      else setQrData((prev) => ({ ...prev, [connectionId]: null }));
    } catch {}
    setLoadingQr(null);
  }

  async function sendChangeRequest() {
    if (!changeMsg.trim() || sendingChange) return;
    setSendingChange(true);
    try {
      const res = await fetch("/api/cliente/change-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: changeMsg.trim() }),
      });
      if (res.ok) {
        setChangeSent(true);
        setChangeMsg("");
        setTimeout(() => setChangeSent(false), 5000);
      }
    } catch {}
    setSendingChange(false);
  }

  const mainAgent = agentConfigs[0];

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">

      {/* ── Conexão WhatsApp ──────────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <span>📱</span> Conexão WhatsApp
        </h2>
        {loadingStatus ? (
          <div className="text-slate-500 text-sm">Verificando conexão...</div>
        ) : connections.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-5 text-slate-500 text-sm">
            Nenhuma conexão configurada ainda. Fale com o suporte.
          </div>
        ) : (
          <div className="space-y-4">
            {connections.map((conn) => {
              const badge = statusLabel(conn);
              const qr = qrData[conn.id];
              return (
                <div key={conn.id} className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-slate-800 text-sm">{conn.phone}</p>
                      <p className="text-xs text-slate-400 uppercase mt-0.5">{conn.type}</p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${badge.color}`}>
                      {badge.text}
                    </span>
                  </div>

                  {conn.connected ? (
                    <div className="flex items-center gap-2 text-sm text-emerald-600">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      WhatsApp conectado e pronto para uso
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-amber-700">
                        Seu WhatsApp está desconectado. Clique no botão abaixo para gerar o QR Code e reconectar.
                      </p>
                      <button
                        onClick={() => generateQr(conn.id)}
                        disabled={loadingQr === conn.id}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60 transition"
                      >
                        {loadingQr === conn.id ? (
                          <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 3.5a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                          </svg>
                        )}
                        Gerar QR Code
                      </button>

                      {qr && (
                        <div className="flex flex-col items-center gap-2 pt-2">
                          <img src={qr} alt="QR Code WhatsApp" className="w-52 h-52 rounded-lg border border-slate-200" />
                          <p className="text-xs text-slate-500 text-center">
                            Abra o WhatsApp → Aparelhos conectados → Conectar aparelho e escaneie o QR
                          </p>
                        </div>
                      )}
                      {qr === null && loadingQr !== conn.id && (
                        <p className="text-xs text-slate-500">QR Code não disponível no momento. Aguarde e tente novamente.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Resumo da IA ─────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <span>🤖</span> Configuração da sua IA
        </h2>
        {!mainAgent ? (
          <div className="rounded-xl border border-slate-200 bg-white p-5 text-slate-500 text-sm">
            Nenhum agente configurado ainda. Entre em contato com o suporte.
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            {/* Status */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Status do Agente</span>
              <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${mainAgent.enabled ? "text-emerald-600 bg-emerald-50 border-emerald-200" : "text-slate-500 bg-slate-50 border-slate-200"}`}>
                {mainAgent.enabled ? "Ativado" : "Desativado"}
              </span>
            </div>

            {/* Nome */}
            {mainAgent.name && (
              <div className="flex items-center justify-between border-t border-slate-100 pt-4">
                <span className="text-sm font-medium text-slate-700">Nome do Agente</span>
                <span className="text-sm text-slate-600">{mainAgent.name}</span>
              </div>
            )}

            {/* Follow-ups */}
            <div className="flex items-center justify-between border-t border-slate-100 pt-4">
              <span className="text-sm font-medium text-slate-700">Follow-ups automáticos</span>
              <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${mainAgent.followUpEnabled ? "text-blue-600 bg-blue-50 border-blue-200" : "text-slate-500 bg-slate-50 border-slate-200"}`}>
                {mainAgent.followUpEnabled ? `${mainAgent.followUps?.length ?? 0} configurado(s)` : "Desativado"}
              </span>
            </div>

            {/* Prompt */}
            {mainAgent.systemPrompt && (
              <div className="border-t border-slate-100 pt-4 space-y-1">
                <span className="text-sm font-medium text-slate-700">Instruções do agente</span>
                <p className="text-sm text-slate-500 bg-slate-50 rounded-lg p-3 leading-relaxed line-clamp-4">
                  {mainAgent.systemPrompt}
                </p>
              </div>
            )}

            {/* Message wait */}
            {mainAgent.messageWaitSeconds ? (
              <div className="flex items-center justify-between border-t border-slate-100 pt-4">
                <span className="text-sm font-medium text-slate-700">Tempo de espera entre mensagens</span>
                <span className="text-sm text-slate-600">{mainAgent.messageWaitSeconds}s</span>
              </div>
            ) : null}

            {/* Split messages */}
            <div className="flex items-center justify-between border-t border-slate-100 pt-4">
              <span className="text-sm font-medium text-slate-700">Dividir mensagens longas</span>
              <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${mainAgent.splitMessages ? "text-indigo-600 bg-indigo-50 border-indigo-200" : "text-slate-500 bg-slate-50 border-slate-200"}`}>
                {mainAgent.splitMessages ? "Sim" : "Não"}
              </span>
            </div>

            {agentConfigs.length > 1 && (
              <p className="text-xs text-slate-400 border-t border-slate-100 pt-4">
                + {agentConfigs.length - 1} agente(s) adicional(is) configurado(s)
              </p>
            )}
          </div>
        )}
      </section>

      {/* ── Solicitar alteração ───────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-slate-800 mb-1 flex items-center gap-2">
          <span>✏️</span> Solicitar alteração na IA
        </h2>
        <p className="text-sm text-slate-500 mb-4">
          Descreva o que você gostaria de mudar no comportamento da sua IA. Nossa equipe receberá a solicitação e retornará em breve.
        </p>
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <textarea
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-400 resize-none"
            rows={4}
            placeholder={`Ex: Quero que a IA seja mais direta e mencione o preço apenas quando o cliente perguntar...`}
            value={changeMsg}
            onChange={(e) => setChangeMsg(e.target.value)}
          />
          <div className="flex items-center justify-between">
            {changeSent ? (
              <span className="text-sm text-emerald-600 font-medium flex items-center gap-1.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Solicitação enviada! Entraremos em contato.
              </span>
            ) : (
              <span className="text-xs text-slate-400">Sua solicitação será enviada via WhatsApp para nossa equipe.</span>
            )}
            <button
              onClick={sendChangeRequest}
              disabled={sendingChange || !changeMsg.trim()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50 transition"
            >
              {sendingChange ? (
                <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              ) : null}
              Enviar solicitação
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
