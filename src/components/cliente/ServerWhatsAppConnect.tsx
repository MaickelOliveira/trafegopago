"use client";

import { useCallback, useEffect, useState } from "react";

type ServerConnection = {
  id: string;
  phone: string;
  name?: string;
  status: "connected" | "connecting" | "disconnected";
  funnelName: string;
};

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 13) return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  if (digits.length === 12) return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  return `+${digits}`;
}

function displayCode(code: string): string {
  const clean = code.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return clean.match(/.{1,4}/g)?.join(" ") ?? clean;
}

export function ServerWhatsAppConnect({ clientId }: { clientId?: string }) {
  const [connections, setConnections] = useState<ServerConnection[]>([]);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [consent, setConsent] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const query = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";
      const response = await fetch(`/api/integrations/whatsapp-server${query}`, { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as { connections?: ServerConnection[] };
      const next = data.connections ?? [];
      setConnections(next);
      const current = next[0];
      if (current?.phone) setPhone(current.phone);
      if (current?.status === "connected") {
        setCode(null);
        setMessage({ type: "ok", text: "WhatsApp conectado ao servidor. Você já pode fechar o navegador." });
      }
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  async function generatePairingCode() {
    setGenerating(true);
    setMessage(null);
    try {
      const response = await fetch("/api/integrations/whatsapp-server", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, ...(clientId ? { clientId } : {}) }),
      });
      const data = await response.json() as {
        error?: string;
        code?: string;
        status?: string;
        alreadyConnected?: boolean;
      };
      if (!response.ok) throw new Error(data.error || "Não foi possível gerar o código");
      if (data.alreadyConnected) {
        setCode(null);
        setMessage({ type: "ok", text: "Este WhatsApp já está conectado ao servidor." });
      } else if (data.code) {
        setCode(data.code);
        setMessage({ type: "ok", text: "Código gerado. Digite-o agora no aplicativo do WhatsApp." });
      }
      await fetchStatus();
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Não foi possível gerar o código",
      });
    } finally {
      setGenerating(false);
    }
  }

  async function disconnect(connectionId: string) {
    if (!confirm("Desconectar o WhatsApp do servidor? As novas conversas deixarão de chegar por esta conexão.")) return;
    setMessage(null);
    const response = await fetch("/api/integrations/whatsapp-server", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId, ...(clientId ? { clientId } : {}) }),
    });
    if (response.ok) {
      setConnections([]);
      setCode(null);
      setMessage({ type: "ok", text: "Conexão removida do servidor." });
    } else {
      const data = await response.json().catch(() => ({})) as { error?: string };
      setMessage({ type: "error", text: data.error || "Não foi possível desconectar" });
    }
  }

  const current = connections[0];
  const connected = current?.status === "connected";

  return (
    <section className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-slate-800">☁️ WhatsApp conectado 24h</h1>
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700">Teste</span>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          O WhatsApp fica conectado no servidor da plataforma e continua recebendo conversas com o navegador fechado.
        </p>
      </div>

      <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-900">
        Esta conexão usa uma integração não oficial com o WhatsApp Web. Ela pode exigir nova vinculação após mudanças do WhatsApp e possui risco de restrição da conta. Use sem disparos em massa.
      </div>

      {connected ? (
        <div className="rounded-2xl border border-emerald-200 bg-white p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-800">Conectado no servidor</p>
                <p className="text-xs text-slate-500">{formatPhone(current.phone)} · {current.funnelName}</p>
              </div>
            </div>
            <button
              onClick={() => disconnect(current.id)}
              className="rounded-lg px-3 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-50"
            >
              Desconectar
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Número do WhatsApp com DDI</label>
            <input
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value.replace(/\D/g, ""))}
              placeholder="5511999999999"
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </div>

          {!code && (
            <label className="flex items-start gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                className="mt-0.5"
              />
              <span>Entendi que esta é uma integração de teste, não oficial, e que não devo usá-la para spam ou disparos em massa.</span>
            </label>
          )}

          {code ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-center">
                <p className="font-mono text-3xl font-black tracking-[0.18em] text-violet-900">{displayCode(code)}</p>
                <p className="mt-1 text-xs text-violet-600">Use agora; se expirar, gere outro código.</p>
              </div>
              <ol className="list-inside list-decimal space-y-1.5 text-sm text-slate-600">
                <li>Abra o WhatsApp no seu celular.</li>
                <li>Entre em <strong>Aparelhos conectados</strong> e toque em <strong>Conectar um aparelho</strong>.</li>
                <li>Escolha <strong>Conectar com número de telefone</strong>.</li>
                <li>Digite o código acima e aguarde aparecer “Conectado”.</li>
              </ol>
              <button
                onClick={generatePairingCode}
                disabled={generating}
                className="text-xs font-semibold text-violet-700 hover:text-violet-900 disabled:opacity-50"
              >
                {generating ? "Gerando..." : "Gerar outro código"}
              </button>
            </div>
          ) : (
            <button
              onClick={generatePairingCode}
              disabled={generating || !consent || phone.replace(/\D/g, "").length < 10}
              className="rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generating ? "Preparando conexão..." : "Gerar código para conectar no servidor"}
            </button>
          )}

          {loading && <p className="text-xs text-slate-400">Verificando conexão...</p>}
        </div>
      )}

      {message && (
        <p className={`text-xs ${message.type === "ok" ? "text-emerald-700" : "text-red-600"}`}>{message.text}</p>
      )}
    </section>
  );
}

