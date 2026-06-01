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
  if (conn.connected) return { text: "Conectado", color: "text-emerald-600 bg-emerald-50 border-emerald-200", dot: "bg-emerald-500" };
  if (conn.status === "error") return { text: "Erro", color: "text-red-600 bg-red-50 border-red-200", dot: "bg-red-500" };
  return { text: "Desconectado", color: "text-amber-600 bg-amber-50 border-amber-200", dot: "bg-amber-400" };
}

function formatPhone(phone: string) {
  const d = phone.replace(/\D/g, "");
  if (d.length === 13) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,8)}-${d.slice(8)}`;
  if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  return phone;
}

export function ClientAgenteIa({ agentConfigs, clientName }: Props) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loadingQr, setLoadingQr] = useState<string | null>(null);
  const [qrData, setQrData] = useState<Record<string, string | null>>({});
  const [promptExpanded, setPromptExpanded] = useState(false);

  const [changeMsg, setChangeMsg] = useState("");
  const [sendingChange, setSendingChange] = useState(false);
  const [changeSent, setChangeSent] = useState(false);

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
        setTimeout(() => setChangeSent(false), 6000);
      }
    } catch {}
    setSendingChange(false);
  }

  const mainAgent = agentConfigs[0];
  const allConnected = connections.length > 0 && connections.every((c) => c.connected);
  const anyConnected = connections.some((c) => c.connected);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">

      {/* ── HERO ── */}
      <div className={`rounded-2xl p-6 text-white relative overflow-hidden ${mainAgent?.enabled && anyConnected ? "bg-gradient-to-br from-violet-600 to-indigo-700" : "bg-gradient-to-br from-slate-500 to-slate-700"}`}>
        {/* Círculo decorativo */}
        <div className="absolute -right-8 -top-8 w-40 h-40 rounded-full bg-white/10" />
        <div className="absolute -right-2 bottom-4 w-24 h-24 rounded-full bg-white/5" />

        <div className="relative">
          <div className="flex items-start justify-between mb-4">
            <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center text-3xl shadow-inner">
              🤖
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <span className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${mainAgent?.enabled ? "bg-white/20 text-white" : "bg-white/10 text-white/60"}`}>
                <span className={`w-2 h-2 rounded-full ${mainAgent?.enabled && anyConnected ? "bg-emerald-300 animate-pulse" : "bg-white/40"}`} />
                {mainAgent?.enabled && anyConnected ? "IA Ativa" : mainAgent?.enabled ? "IA Ativada (sem conexão)" : "IA Desativada"}
              </span>
              {anyConnected && (
                <span className="flex items-center gap-1 text-[11px] text-white/70">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-300" />
                  WhatsApp conectado
                </span>
              )}
            </div>
          </div>

          <h1 className="text-2xl font-bold mb-1">
            {mainAgent?.name ?? "Seu Agente de IA"}
          </h1>
          <p className="text-white/70 text-sm">
            Atendendo clientes de <span className="text-white font-medium">{clientName}</span> automaticamente, 24 horas por dia.
          </p>

          {/* Stats rápidos */}
          <div className="flex flex-wrap gap-3 mt-5">
            {mainAgent?.followUpEnabled && (mainAgent.followUps?.length ?? 0) > 0 && (
              <div className="flex items-center gap-1.5 bg-white/15 rounded-lg px-3 py-1.5 text-xs">
                <span>🔔</span>
                <span>{mainAgent.followUps.length} follow-up{mainAgent.followUps.length > 1 ? "s" : ""} automático{mainAgent.followUps.length > 1 ? "s" : ""}</span>
              </div>
            )}
            {mainAgent?.splitMessages && (
              <div className="flex items-center gap-1.5 bg-white/15 rounded-lg px-3 py-1.5 text-xs">
                <span>💬</span>
                <span>Mensagens humanizadas</span>
              </div>
            )}
            {mainAgent?.messageWaitSeconds ? (
              <div className="flex items-center gap-1.5 bg-white/15 rounded-lg px-3 py-1.5 text-xs">
                <span>⏱️</span>
                <span>Aguarda {mainAgent.messageWaitSeconds}s antes de responder</span>
              </div>
            ) : null}
            {mainAgent?.googleCalendarId && (
              <div className="flex items-center gap-1.5 bg-white/15 rounded-lg px-3 py-1.5 text-xs">
                <span>📅</span>
                <span>Agenda integrada</span>
              </div>
            )}
            {mainAgent?.mediaLibrary && mainAgent.mediaLibrary.length > 0 && (
              <div className="flex items-center gap-1.5 bg-white/15 rounded-lg px-3 py-1.5 text-xs">
                <span>📎</span>
                <span>{mainAgent.mediaLibrary.length} mídia{mainAgent.mediaLibrary.length > 1 ? "s" : ""} configurada{mainAgent.mediaLibrary.length > 1 ? "s" : ""}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── COMO SUA IA TRABALHA ── */}
      <section>
        <h2 className="text-base font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <span className="w-6 h-6 rounded-md bg-violet-100 flex items-center justify-center text-sm">✨</span>
          O que sua IA faz por você
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-slate-100 bg-white p-4 flex gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-xl shrink-0">⚡</div>
            <div>
              <p className="text-sm font-medium text-slate-800">Resposta instantânea</p>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">Responde seus clientes no WhatsApp em segundos, qualquer hora do dia — mesmo de madrugada ou no final de semana.</p>
            </div>
          </div>
          <div className="rounded-xl border border-slate-100 bg-white p-4 flex gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-xl shrink-0">🧠</div>
            <div>
              <p className="text-sm font-medium text-slate-800">Contexto da conversa</p>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">A IA lembra de toda a conversa com cada cliente, respondendo de forma coerente e personalizada.</p>
            </div>
          </div>
          {mainAgent?.followUpEnabled && (mainAgent.followUps?.length ?? 0) > 0 && (
            <div className="rounded-xl border border-slate-100 bg-white p-4 flex gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-xl shrink-0">🔔</div>
              <div>
                <p className="text-sm font-medium text-slate-800">Follow-ups automáticos</p>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">Quando um cliente some, a IA reentra em contato automaticamente em momentos estratégicos para não perder o lead.</p>
              </div>
            </div>
          )}
          {mainAgent?.splitMessages && (
            <div className="rounded-xl border border-slate-100 bg-white p-4 flex gap-3">
              <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center text-xl shrink-0">💬</div>
              <div>
                <p className="text-sm font-medium text-slate-800">Mensagens humanizadas</p>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">Divide mensagens longas em partes menores, imitando como uma pessoa real escreve no WhatsApp.</p>
              </div>
            </div>
          )}
          {mainAgent?.googleCalendarId && (
            <div className="rounded-xl border border-slate-100 bg-white p-4 flex gap-3">
              <div className="w-10 h-10 rounded-xl bg-sky-50 flex items-center justify-center text-xl shrink-0">📅</div>
              <div>
                <p className="text-sm font-medium text-slate-800">Agendamento integrado</p>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">Consulta e agenda compromissos diretamente na sua agenda do Google sem precisar de intervenção humana.</p>
              </div>
            </div>
          )}
          {mainAgent?.aiResumeKeyword && (
            <div className="rounded-xl border border-slate-100 bg-white p-4 flex gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center text-xl shrink-0">🔑</div>
              <div>
                <p className="text-sm font-medium text-slate-800">Retomada inteligente</p>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">Quando você assume o atendimento, pode reativar a IA depois com a palavra <span className="font-mono text-rose-600">"{mainAgent.aiResumeKeyword}"</span>.</p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── PROMPT / INSTRUÇÕES ── */}
      {mainAgent?.systemPrompt && (
        <section>
          <h2 className="text-base font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <span className="w-6 h-6 rounded-md bg-indigo-100 flex items-center justify-center text-sm">📋</span>
            Instruções do seu Agente
          </h2>
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 overflow-hidden">
            <div className="px-5 py-3 border-b border-indigo-100 bg-white flex items-center justify-between">
              <p className="text-xs text-indigo-600 font-medium uppercase tracking-wide">Prompt completo (como sua IA foi treinada)</p>
              <button
                onClick={() => setPromptExpanded((v) => !v)}
                className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 font-medium transition-colors"
              >
                {promptExpanded ? (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                    Recolher
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                    Ver completo
                  </>
                )}
              </button>
            </div>
            <div className="px-5 py-4">
              <p className={`text-sm text-slate-700 leading-relaxed whitespace-pre-wrap font-mono ${!promptExpanded ? "line-clamp-5" : ""}`}>
                {mainAgent.systemPrompt}
              </p>
              {!promptExpanded && mainAgent.systemPrompt.length > 300 && (
                <button
                  onClick={() => setPromptExpanded(true)}
                  className="mt-2 text-xs text-indigo-500 hover:text-indigo-700 font-medium"
                >
                  ... ler tudo ({mainAgent.systemPrompt.length} caracteres)
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── DETALHES TÉCNICOS ── */}
      <section>
        <h2 className="text-base font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <span className="w-6 h-6 rounded-md bg-slate-100 flex items-center justify-center text-sm">⚙️</span>
          Configurações ativas
        </h2>
        <div className="rounded-xl border border-slate-100 bg-white divide-y divide-slate-50">
          <div className="flex items-center justify-between px-5 py-3.5">
            <div className="flex items-center gap-3">
              <span className="text-base">🤖</span>
              <div>
                <p className="text-sm font-medium text-slate-700">Agente de IA</p>
                <p className="text-xs text-slate-400">Resposta automática via WhatsApp</p>
              </div>
            </div>
            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${mainAgent?.enabled ? "text-emerald-600 bg-emerald-50 border-emerald-200" : "text-slate-400 bg-slate-50 border-slate-200"}`}>
              {mainAgent?.enabled ? "Ativado" : "Desativado"}
            </span>
          </div>

          {mainAgent?.name && (
            <div className="flex items-center justify-between px-5 py-3.5">
              <div className="flex items-center gap-3">
                <span className="text-base">🏷️</span>
                <div>
                  <p className="text-sm font-medium text-slate-700">Nome do agente</p>
                  <p className="text-xs text-slate-400">Como o agente se identifica</p>
                </div>
              </div>
              <span className="text-sm text-slate-600 font-medium">{mainAgent.name}</span>
            </div>
          )}

          <div className="flex items-center justify-between px-5 py-3.5">
            <div className="flex items-center gap-3">
              <span className="text-base">🔔</span>
              <div>
                <p className="text-sm font-medium text-slate-700">Follow-ups automáticos</p>
                <p className="text-xs text-slate-400">Re-engajamento de leads que pararam de responder</p>
              </div>
            </div>
            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${mainAgent?.followUpEnabled ? "text-blue-600 bg-blue-50 border-blue-200" : "text-slate-400 bg-slate-50 border-slate-200"}`}>
              {mainAgent?.followUpEnabled ? `${mainAgent.followUps?.length ?? 0} etapa${(mainAgent.followUps?.length ?? 0) !== 1 ? "s" : ""}` : "Desativado"}
            </span>
          </div>

          <div className="flex items-center justify-between px-5 py-3.5">
            <div className="flex items-center gap-3">
              <span className="text-base">💬</span>
              <div>
                <p className="text-sm font-medium text-slate-700">Mensagens humanizadas</p>
                <p className="text-xs text-slate-400">Divide respostas longas em várias partes</p>
              </div>
            </div>
            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${mainAgent?.splitMessages ? "text-indigo-600 bg-indigo-50 border-indigo-200" : "text-slate-400 bg-slate-50 border-slate-200"}`}>
              {mainAgent?.splitMessages ? "Ativado" : "Desativado"}
            </span>
          </div>

          {(mainAgent?.messageWaitSeconds ?? 0) > 0 && (
            <div className="flex items-center justify-between px-5 py-3.5">
              <div className="flex items-center gap-3">
                <span className="text-base">⏳</span>
                <div>
                  <p className="text-sm font-medium text-slate-700">Aguarda acumulação de mensagens</p>
                  <p className="text-xs text-slate-400">Espera antes de responder para capturar toda a mensagem</p>
                </div>
              </div>
              <span className="text-sm text-slate-600 font-medium">{mainAgent.messageWaitSeconds}s</span>
            </div>
          )}

          {mainAgent?.maxMessageLength && (
            <div className="flex items-center justify-between px-5 py-3.5">
              <div className="flex items-center gap-3">
                <span className="text-base">📏</span>
                <div>
                  <p className="text-sm font-medium text-slate-700">Tamanho máximo por mensagem</p>
                  <p className="text-xs text-slate-400">Limite de caracteres em cada resposta</p>
                </div>
              </div>
              <span className="text-sm text-slate-600 font-medium">{mainAgent.maxMessageLength} caracteres</span>
            </div>
          )}

          {mainAgent?.googleCalendarId && (
            <div className="flex items-center justify-between px-5 py-3.5">
              <div className="flex items-center gap-3">
                <span className="text-base">📅</span>
                <div>
                  <p className="text-sm font-medium text-slate-700">Google Agenda</p>
                  <p className="text-xs text-slate-400">Integração com Google Calendar para agendamentos</p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold border text-emerald-600 bg-emerald-50 border-emerald-200">
                Conectada
              </span>
            </div>
          )}

          {mainAgent?.aiResumeKeyword && (
            <div className="flex items-center justify-between px-5 py-3.5">
              <div className="flex items-center gap-3">
                <span className="text-base">🔑</span>
                <div>
                  <p className="text-sm font-medium text-slate-700">Palavra para reativar IA</p>
                  <p className="text-xs text-slate-400">Envie essa palavra para retomar o atendimento automático</p>
                </div>
              </div>
              <span className="font-mono text-xs bg-slate-100 text-slate-600 border border-slate-200 px-2.5 py-1 rounded-md">
                {mainAgent.aiResumeKeyword}
              </span>
            </div>
          )}

          {mainAgent?.mediaLibrary && mainAgent.mediaLibrary.length > 0 && (
            <div className="flex items-center justify-between px-5 py-3.5">
              <div className="flex items-center gap-3">
                <span className="text-base">📎</span>
                <div>
                  <p className="text-sm font-medium text-slate-700">Biblioteca de mídias</p>
                  <p className="text-xs text-slate-400">Arquivos que a IA pode enviar automaticamente</p>
                </div>
              </div>
              <span className="text-sm text-slate-600 font-medium">{mainAgent.mediaLibrary.length} arquivo{mainAgent.mediaLibrary.length !== 1 ? "s" : ""}</span>
            </div>
          )}

          {agentConfigs.length > 1 && (
            <div className="flex items-center justify-between px-5 py-3.5 bg-slate-50/50">
              <div className="flex items-center gap-3">
                <span className="text-base">🔗</span>
                <div>
                  <p className="text-sm font-medium text-slate-700">Agentes adicionais</p>
                  <p className="text-xs text-slate-400">Agentes configurados para conexões específicas</p>
                </div>
              </div>
              <span className="text-sm text-slate-500">+{agentConfigs.length - 1}</span>
            </div>
          )}
        </div>
      </section>

      {/* ── FOLLOW-UPS DETALHADOS ── */}
      {mainAgent?.followUpEnabled && (mainAgent.followUps?.length ?? 0) > 0 && (
        <section>
          <h2 className="text-base font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <span className="w-6 h-6 rounded-md bg-amber-100 flex items-center justify-center text-sm">🔔</span>
            Sequência de Follow-ups
          </h2>
          <div className="space-y-2">
            {mainAgent.followUps.map((fu, i) => (
              <div key={i} className="rounded-xl border border-slate-100 bg-white p-4 flex items-start gap-4">
                <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center text-xs font-bold text-amber-700 shrink-0">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                      Após {(fu as unknown as { delayMinutes?: number }).delayMinutes != null
                        ? (() => {
                            const m = (fu as unknown as { delayMinutes: number }).delayMinutes;
                            if (m < 60) return `${m} min`;
                            if (m < 1440) return `${Math.round(m / 60)}h`;
                            return `${Math.round(m / 1440)} dia${Math.round(m / 1440) !== 1 ? "s" : ""}`;
                          })()
                        : "intervalo configurado"}
                    </span>
                  </div>
                  <p className="text-sm text-slate-600 leading-relaxed line-clamp-3">
                    {(fu as unknown as { message?: string }).message ?? "(mensagem personalizada)"}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-400 mt-2 pl-1">
            A sequência é enviada automaticamente quando o cliente para de responder.
          </p>
        </section>
      )}

      {/* ── CONEXÃO WHATSAPP ── */}
      <section>
        <h2 className="text-base font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <span className="w-6 h-6 rounded-md bg-emerald-100 flex items-center justify-center text-sm">📱</span>
          Conexão WhatsApp
        </h2>
        {loadingStatus ? (
          <div className="rounded-xl border border-slate-100 bg-white p-5 flex items-center gap-3 text-slate-400 text-sm">
            <span className="w-4 h-4 border-2 border-slate-300 border-t-violet-500 rounded-full animate-spin" />
            Verificando conexão...
          </div>
        ) : connections.length === 0 ? (
          <div className="rounded-xl border border-slate-100 bg-white p-5 text-slate-500 text-sm">
            Nenhuma conexão configurada. Entre em contato com o suporte.
          </div>
        ) : (
          <div className="space-y-3">
            {connections.map((conn) => {
              const badge = statusLabel(conn);
              const qr = qrData[conn.id];
              return (
                <div key={conn.id} className="rounded-xl border border-slate-100 bg-white overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl ${conn.connected ? "bg-emerald-50" : "bg-amber-50"}`}>
                        📱
                      </div>
                      <div>
                        <p className="font-medium text-slate-800 text-sm">{formatPhone(conn.phone)}</p>
                        <p className="text-xs text-slate-400 capitalize">{conn.type === "wppconnect" ? "WhatsApp" : conn.type}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${badge.dot} ${conn.connected ? "animate-pulse" : ""}`} />
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${badge.color}`}>
                        {badge.text}
                      </span>
                    </div>
                  </div>

                  {conn.connected ? (
                    <div className="px-5 pb-4 flex items-center gap-2 text-sm text-emerald-600">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Pronto para atender — a IA está funcionando neste número
                    </div>
                  ) : (
                    <div className="px-5 pb-4 space-y-3 border-t border-slate-50">
                      <p className="text-sm text-amber-700 pt-3">
                        ⚠️ WhatsApp desconectado. Gere um novo QR Code e escaneie pelo celular para reconectar.
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
                        <div className="flex flex-col items-center gap-3 pt-2 bg-slate-50 rounded-xl p-4">
                          <img src={qr} alt="QR Code WhatsApp" className="w-52 h-52 rounded-lg border-4 border-white shadow-md" />
                          <div className="text-center space-y-1">
                            <p className="text-sm font-medium text-slate-700">Como escanear:</p>
                            <ol className="text-xs text-slate-500 text-left space-y-1 max-w-xs">
                              <li>1. Abra o <strong>WhatsApp</strong> no seu celular</li>
                              <li>2. Toque nos <strong>3 pontinhos</strong> (⋮) no canto superior</li>
                              <li>3. Acesse <strong>"Aparelhos conectados"</strong></li>
                              <li>4. Toque em <strong>"Conectar aparelho"</strong></li>
                              <li>5. Aponte a câmera para o QR Code acima</li>
                            </ol>
                          </div>
                        </div>
                      )}
                      {qr === null && loadingQr !== conn.id && (
                        <p className="text-xs text-slate-400">QR Code indisponível no momento. Aguarde alguns segundos e tente novamente.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── SOLICITAR ALTERAÇÃO ── */}
      <section>
        <h2 className="text-base font-semibold text-slate-700 mb-1 flex items-center gap-2">
          <span className="w-6 h-6 rounded-md bg-violet-100 flex items-center justify-center text-sm">✏️</span>
          Solicitar alteração na IA
        </h2>
        <p className="text-sm text-slate-500 mb-3 pl-8">
          Quer mudar algo no comportamento da sua IA? Escreva abaixo e nossa equipe irá ajustar.
        </p>

        {/* Exemplos de solicitação */}
        <div className="flex flex-wrap gap-2 mb-3">
          {[
            "Quero que a IA mencione o preço somente quando perguntarem",
            "Adicionar informação sobre nosso horário de atendimento",
            "A IA deve ser mais objetiva e direta",
            "Incluir link de pagamento nas respostas",
          ].map((ex) => (
            <button
              key={ex}
              onClick={() => setChangeMsg(ex)}
              className="text-xs text-violet-600 bg-violet-50 border border-violet-200 rounded-full px-3 py-1 hover:bg-violet-100 transition-colors text-left"
            >
              {ex}
            </button>
          ))}
        </div>

        <div className="rounded-xl border border-slate-100 bg-white p-5 space-y-4">
          <textarea
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-400 resize-none transition"
            rows={4}
            placeholder="Descreva a alteração que deseja. Quanto mais detalhes, melhor!&#10;Ex: Quero que a IA apresente um desconto de 10% para clientes que perguntarem sobre preço..."
            value={changeMsg}
            onChange={(e) => setChangeMsg(e.target.value)}
          />
          <div className="flex items-center justify-between gap-3">
            {changeSent ? (
              <div className="flex items-center gap-2 text-sm text-emerald-600 font-medium">
                <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                Solicitação enviada! Entraremos em contato em breve.
              </div>
            ) : (
              <span className="text-xs text-slate-400">
                💡 Nossa equipe geralmente responde em até 24h.
              </span>
            )}
            <button
              onClick={sendChangeRequest}
              disabled={sendingChange || !changeMsg.trim()}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50 transition shrink-0"
            >
              {sendingChange ? (
                <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              )}
              Enviar
            </button>
          </div>
        </div>
      </section>

    </div>
  );
}


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
