"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

type Stage = "loading" | "invalid" | "generating" | "scanning" | "done";

export default function ConectarPage() {
  const { token } = useParams<{ token: string }>();
  const [stage, setStage] = useState<Stage>("loading");
  const [error, setError] = useState<string | null>(null);
  const [sessionName, setSessionName] = useState("");
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const qrShownRef = useRef(false);
  const forceRegenerateRef = useRef<(() => void) | null>(null);

  // Valida o token e, se válido, inicia o fluxo de conexão/polling
  useEffect(() => {
    let alive = true;
    let poll: ReturnType<typeof setInterval>;
    let cooldownTick: ReturnType<typeof setInterval> | undefined;
    let connecting = false;
    let lastQr: string | null = null;
    let qrSetAt = 0;

    fetch(`/api/conectar/${token}`)
      .then((r) => r.json())
      .then((data: { valid: boolean; error?: string; sessionName?: string; wppSessionId?: string }) => {
        if (!alive) return;
        if (!data.valid || !data.wppSessionId) {
          setError(data.error ?? "Link inválido.");
          setStage("invalid");
          return;
        }
        setSessionName(data.sessionName ?? "");
        setStage("generating");

        const webhookUrl = `${window.location.origin}/api/whatsapp/webhook/wppconnect/${data.wppSessionId}`;

        const connectAndFetchQr = async (force: boolean) => {
          if (connecting || !alive) return;
          connecting = true;
          try {
            const res = await fetch(`/api/conectar/${token}/connect`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ force, webhookUrl, previousQr: lastQr }),
            });
            if (res.status === 410) {
              setError("Este link já foi usado ou expirou. Peça um link novo.");
              setStage("invalid");
              return;
            }
            const d = await res.json() as { qr?: string | null; cooldownMs?: number };
            if (!alive) return;
            if (d.qr && d.qr !== lastQr) {
              setQrImage(d.qr); setStage("scanning"); qrShownRef.current = true;
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
          } catch { /* tenta de novo no próximo ciclo */ }
          finally { connecting = false; }
        };

        forceRegenerateRef.current = () => {
          setQrImage(null);
          setStage("generating");
          connectAndFetchQr(true);
        };

        const startPolling = () => {
          if (qrSetAt === 0) qrSetAt = Date.now();
          poll = setInterval(async () => {
            if (!alive) return;
            try {
              const res = await fetch(`/api/conectar/${token}/status`);
              if (res.status === 410) {
                clearInterval(poll);
                setError("Este link já foi usado ou expirou. Peça um link novo.");
                setStage("invalid");
                return;
              }
              const d = await res.json() as { connected?: boolean; qr?: string | null };
              if (d.qr) {
                if (d.qr !== lastQr) {
                  lastQr = d.qr; qrSetAt = Date.now();
                  setQrImage(d.qr); setStage("scanning"); qrShownRef.current = true;
                } else if (!d.connected && Date.now() - qrSetAt > 65000) {
                  setQrImage(null); setStage("generating");
                  connectAndFetchQr(false);
                }
              } else if (!d.connected && Date.now() - qrSetAt > 90000) {
                // Nenhum QR chegou (nem novo, nem cooldown) por tempo demais —
                // sem isso a tela ficava presa em "Gerando QR Code..." pra sempre.
                // Não força (force=false): o WPPConnect pode só estar demorando
                // pra abrir o navegador — forçar aqui interromperia bem na hora
                // em que estava quase terminando, criando um loop que nunca
                // conclui. Deixa o cooldown natural decidir se já pode reiniciar.
                qrSetAt = Date.now();
                connectAndFetchQr(false);
              }
              if (d.connected && qrShownRef.current) {
                setStage("done"); clearInterval(poll); alive = false;
              }
            } catch { /* tenta de novo no próximo ciclo */ }
          }, 3000);
        };

        connectAndFetchQr(false).then(() => { if (alive) startPolling(); });
      })
      .catch(() => { setError("Erro ao carregar o link."); setStage("invalid"); });

    return () => { alive = false; clearInterval(poll); clearInterval(cooldownTick); forceRegenerateRef.current = null; };
  }, [token]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-sm w-full text-center">
        {stage === "loading" && (
          <p className="text-slate-500 text-sm animate-pulse">Carregando...</p>
        )}

        {stage === "invalid" && (
          <div>
            <div className="text-4xl mb-4">❌</div>
            <p className="text-slate-900 font-semibold text-lg mb-2">Link indisponível</p>
            <p className="text-slate-500 text-sm">{error}</p>
          </div>
        )}

        {stage === "done" && (
          <div className="py-6">
            <div className="text-6xl mb-6">✅</div>
            <h1 className="text-slate-900 font-bold text-2xl mb-3">Conectado com sucesso!</h1>
            <p className="text-slate-500 text-sm">Você pode fechar esta janela.</p>
          </div>
        )}

        {(stage === "generating" || stage === "scanning") && (
          <>
            <h1 className="text-slate-900 text-xl font-bold mb-1">Conectar WhatsApp</h1>
            {sessionName && <p className="text-slate-400 text-xs mb-6">{sessionName}</p>}

            {qrImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrImage} alt="QR Code" className="w-64 h-64 mx-auto rounded-2xl border-4 border-violet-100 shadow-md mb-4" />
            ) : cooldownSeconds > 0 ? (
              <div className="w-64 h-64 mx-auto rounded-2xl border-2 border-dashed border-amber-200 bg-amber-50 flex flex-col items-center justify-center mb-4 gap-2">
                <div className="text-3xl font-bold text-amber-600">{cooldownSeconds}s</div>
                <p className="text-xs text-amber-700 px-6 text-center">Preparando a conexão, aguarde...</p>
              </div>
            ) : (
              <div className="w-64 h-64 mx-auto rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center mb-4 gap-3">
                <div className="animate-spin h-8 w-8 border-2 border-slate-200 border-t-violet-500 rounded-full" />
                <p className="text-xs text-slate-400 px-4">Gerando QR Code...</p>
              </div>
            )}

            {qrImage && (
              <button
                onClick={() => forceRegenerateRef.current?.()}
                className="text-xs text-violet-600 hover:text-violet-700 font-medium underline mb-4"
              >
                QR expirou? Gerar um novo
              </button>
            )}

            <div className="text-left bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
              <p className="text-sm font-semibold text-slate-700 mb-2">Como conectar:</p>
              <p className="text-xs text-slate-500"><strong className="text-slate-700">1.</strong> Abra o WhatsApp no seu celular</p>
              <p className="text-xs text-slate-500"><strong className="text-slate-700">2.</strong> Toque em ⋮ (Android) ou Configurações (iPhone)</p>
              <p className="text-xs text-slate-500"><strong className="text-slate-700">3.</strong> Toque em <strong>Aparelhos conectados</strong></p>
              <p className="text-xs text-slate-500"><strong className="text-slate-700">4.</strong> Toque em <strong>Conectar um aparelho</strong></p>
              <p className="text-xs text-slate-500"><strong className="text-slate-700">5.</strong> Aponte a câmera para o QR Code acima</p>
            </div>

            <p className="text-xs text-slate-400 mt-4">A página atualiza sozinha assim que a conexão for feita.</p>
          </>
        )}
      </div>
    </div>
  );
}
