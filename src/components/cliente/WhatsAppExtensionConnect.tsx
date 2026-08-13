"use client";

import { useState, useEffect, useCallback } from "react";
import type { DeviceStatusView, ExtensionConnectorState } from "@/lib/extension-types";

const STATE_LABEL: Record<ExtensionConnectorState, string> = {
  connected: "Conectado",
  waiting_qr: "Aguardando QR Code",
  disconnected: "Desconectado",
};

const STATE_DOT: Record<ExtensionConnectorState, string> = {
  connected: "bg-green-500 animate-pulse",
  waiting_qr: "bg-amber-400",
  disconnected: "bg-slate-300",
};

function timeAgo(iso: string): string {
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return "agora mesmo";
  if (diffSec < 3600) return `há ${Math.floor(diffSec / 60)} min`;
  return `há ${Math.floor(diffSec / 3600)} h`;
}

function secondsUntil(iso: string): number {
  return Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
}

export function WhatsAppExtensionConnect() {
  const [devices, setDevices] = useState<DeviceStatusView[]>([]);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/whatsapp-extension/status");
      if (res.ok) {
        const data = await res.json();
        setDevices(data.devices ?? []);
      }
    } catch {}
    setLoadingStatus(false);
  }, []);

  useEffect(() => {
    fetchStatus();
    const t = setInterval(fetchStatus, 10000);
    return () => clearInterval(t);
  }, [fetchStatus]);

  // Código expirado localmente — só limpa a exibição, a validade real é
  // sempre checada no servidor no momento do claim pela extensão.
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => {
      if (new Date(expiresAt).getTime() < Date.now()) {
        setCode(null);
        setExpiresAt(null);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [expiresAt]);

  async function generateCode() {
    setGenerating(true);
    setMsg(null);
    try {
      const res = await fetch("/api/integrations/whatsapp-extension/pairing-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao gerar código");
      setCode(data.code);
      setExpiresAt(data.expiresAt);
    } catch (e) {
      setMsg({ type: "err", text: e instanceof Error ? e.message : "Falha ao gerar código" });
    } finally {
      setGenerating(false);
    }
  }

  async function revoke(deviceId: string) {
    if (!confirm("Desconectar este dispositivo? A extensão vai parar de reportar o status da conversa até um novo pareamento.")) return;
    try {
      const res = await fetch("/api/integrations/whatsapp-extension/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId }),
      });
      if (!res.ok) throw new Error();
      setMsg({ type: "ok", text: "Dispositivo desconectado." });
      fetchStatus();
    } catch {
      setMsg({ type: "err", text: "Erro ao desconectar." });
    }
  }

  const secondsLeft = expiresAt ? secondsUntil(expiresAt) : 0;

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">🧩 Conector WhatsApp (extensão do navegador)</h1>
        <p className="text-sm text-slate-500 mt-1">
          Vincula o WhatsApp Web já aberto no seu Chrome à sua conta na plataforma — sem precisar de um número dedicado.
        </p>
      </div>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        ⚠️ Esse método depende do seu computador e do Chrome permanecerem ligados e com a aba do WhatsApp Web aberta. Se o computador desligar ou a aba fechar, o status muda para &quot;Desconectado&quot; automaticamente.
      </div>

      {!consentAccepted && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3 text-sm text-slate-600">
          <p className="font-semibold text-slate-800">Antes de continuar</p>
          <ul className="list-disc list-inside space-y-1">
            <li>A extensão lê o nome do contato e o conteúdo de mensagens de texto novas em cada conversa, pra criar/atualizar o lead no seu CRM — igual às outras integrações de WhatsApp da plataforma.</li>
            <li>Quando a mensagem vier de um clique em anúncio, também capturamos automaticamente de qual campanha/anúncio ela veio — mesmo rastreio de campanha das outras integrações.</li>
            <li>Não temos acesso à sua senha, QR Code de login ou aos cookies/credenciais do WhatsApp — a extensão nunca toca nesses dados, em nenhuma hipótese, e nunca envia mensagem nem executa nenhuma ação no seu WhatsApp: só lê.</li>
            <li className="text-amber-700">
              ⚠️ Pra ler mensagem e contexto de anúncio, a extensão usa uma técnica não-oficial (lê o estado interno do próprio WhatsApp Web no seu navegador) — fora dos termos de uso do WhatsApp. Isso carrega um risco real, embora não determinístico, de restrição/banimento da conta. Diferente de outras integrações da plataforma (que usam um número dedicado da agência), aqui o número em risco é o <strong>seu número pessoal</strong>.
            </li>
            <li>O funil de CRM dessa conexão é definido pelo seu gestor de tráfego depois que você conectar — se as conversas não aparecerem no CRM, fale com ele.</li>
            <li>Você pode desconectar a qualquer momento pelo botão &quot;Desconectar&quot; abaixo.</li>
          </ul>
          <p>
            Leia a <a href="/privacidade/extensao-whatsapp" target="_blank" className="text-blue-600 underline">política de privacidade da extensão</a> completa.
          </p>
          <button
            onClick={() => setConsentAccepted(true)}
            className="rounded-lg bg-slate-800 text-white text-sm font-medium px-4 py-2 hover:bg-slate-900 transition"
          >
            Entendi o risco, continuar
          </button>
        </div>
      )}

      {consentAccepted && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
          <p className="font-semibold text-slate-800 text-sm">Como conectar</p>
          <ol className="text-sm text-slate-600 list-decimal list-inside space-y-1.5">
            <li>Instale a extensão &quot;Conector WhatsApp — Tráfego Pago Plataforma&quot; no Chrome.</li>
            <li>Abra <a href="https://web.whatsapp.com/" target="_blank" rel="noreferrer" className="text-blue-600 underline">web.whatsapp.com</a> e conecte normalmente (QR Code do próprio WhatsApp).</li>
            <li>Com as conversas visíveis, gere o código abaixo e cole na extensão.</li>
          </ol>

          {code ? (
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-center">
              <p className="text-2xl font-mono font-bold tracking-widest text-slate-800">{code}</p>
              <p className="text-xs text-slate-400 mt-1">
                Expira em {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
              </p>
            </div>
          ) : (
            <>
              <p className="text-xs text-slate-400 mb-3">Depois de conectar, seu gestor de tráfego vincula essa conexão a um funil do CRM.</p>
              <button
                onClick={generateCode}
                disabled={generating}
                className="rounded-lg bg-emerald-600 text-white text-sm font-medium px-4 py-2.5 hover:bg-emerald-700 disabled:opacity-60 transition"
              >
                {generating ? "Gerando..." : "Gerar código de conexão"}
              </button>
            </>
          )}

          {msg && (
            <p className={`text-xs ${msg.type === "ok" ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</p>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="font-semibold text-slate-800 text-sm mb-3">Dispositivos conectados</p>
        {loadingStatus ? (
          <p className="text-sm text-slate-400">Carregando...</p>
        ) : devices.length === 0 ? (
          <p className="text-sm text-slate-400">Nenhum dispositivo conectado ainda.</p>
        ) : (
          <div className="space-y-2">
            {devices.map((d) => (
              <div key={d.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATE_DOT[d.connectorState]}`} />
                  <div>
                    <p className="text-sm font-medium text-slate-800">{STATE_LABEL[d.connectorState]}</p>
                    <p className="text-xs text-slate-400">Última atividade {timeAgo(d.lastSeenAt)}</p>
                  </div>
                </div>
                <button
                  onClick={() => revoke(d.id)}
                  className="text-xs font-medium text-red-600 hover:text-red-700 px-3 py-1.5 rounded-lg hover:bg-red-50 transition"
                >
                  Desconectar
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
