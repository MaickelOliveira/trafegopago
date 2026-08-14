"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

type Stage = "loading" | "invalid" | "choose" | "generating" | "scanning" | "code-input" | "code-shown" | "done";

export default function ConectarEvolutionPage() {
  const { token } = useParams<{ token: string }>();
  const [stage, setStage] = useState<Stage>("loading");
  const [error, setError] = useState<string | null>(null);
  const [instanceName, setInstanceName] = useState("");
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [phoneInput, setPhoneInput] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [generatingCode, setGeneratingCode] = useState(false);
  const qrShownRef = useRef(false);
  const forceRegenerateRef = useRef<(() => void) | null>(null);
  const startQrFlowRef = useRef<(() => void) | null>(null);
  const webhookUrlRef = useRef<string>("");
  const aliveRef = useRef(true);

  // Valida o token e prepara (sem ainda decidir QR ou código — ver stage "choose")
  useEffect(() => {
    let alive = true;
    aliveRef.current = true;
    let poll: ReturnType<typeof setInterval>;
    let cooldownTick: ReturnType<typeof setInterval> | undefined;
    let connecting = false;
    let lastQr: string | null = null;
    let qrSetAt = 0;

    fetch(`/api/conectar-evolution/${token}`)
      .then((r) => r.json())
      .then((data: { valid: boolean; error?: string; instanceName?: string; evolutionSessionId?: string }) => {
        if (!alive) return;
        if (!data.valid || !data.evolutionSessionId) {
          setError(data.error ?? "Link inválido.");
          setStage("invalid");
          return;
        }
        setInstanceName(data.instanceName ?? "");

        const webhookUrl = `${window.location.origin}/api/whatsapp/webhook/evolution/${data.evolutionSessionId}`;
        webhookUrlRef.current = webhookUrl;

        const connectAndFetchQr = async (force: boolean) => {
          if (connecting || !alive) return;
          connecting = true;
          try {
            const res = await fetch(`/api/conectar-evolution/${token}/connect`, {
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
              const res = await fetch(`/api/conectar-evolution/${token}/status`);
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
                qrSetAt = Date.now();
                connectAndFetchQr(false);
              }
              if (d.connected && qrShownRef.current) {
                setStage("done"); clearInterval(poll); alive = false;
              }
            } catch { /* tenta de novo no próximo ciclo */ }
          }, 3000);
        };

        // Só começa a gerar QR quando o usuário escolher esse modo na tela
        // "choose" — ver startQrFlowRef, chamado pelo botão "Escanear QR Code".
        startQrFlowRef.current = () => {
          setStage("generating");
          connectAndFetchQr(false).then(() => { if (alive) startPolling(); });
        };

        setStage("choose");
      })
      .catch(() => { setError("Erro ao carregar o link."); setStage("invalid"); });

    return () => {
      alive = false;
      aliveRef.current = false;
      clearInterval(poll);
      clearInterval(cooldownTick);
      forceRegenerateRef.current = null;
      startQrFlowRef.current = null;
    };
  }, [token]);

  // Polling simples pro modo código — só checa "connected", não mexe em QR.
  useEffect(() => {
    if (stage !== "code-shown") return;
    const poll = setInterval(async () => {
      if (!aliveRef.current) return;
      try {
        const res = await fetch(`/api/conectar-evolution/${token}/status`);
        if (res.status === 410) {
          clearInterval(poll);
          setError("Este link já foi usado ou expirou. Peça um link novo.");
          setStage("invalid");
          return;
        }
        const d = await res.json() as { connected?: boolean };
        if (d.connected) { setStage("done"); clearInterval(poll); }
      } catch { /* tenta de novo no próximo ciclo */ }
    }, 3000);
    return () => clearInterval(poll);
  }, [stage, token]);

  async function generateCode() {
    const digits = phoneInput.replace(/\D/g, "");
    if (digits.length < 10) {
      setCodeError("Digite o número completo, com DDD.");
      return;
    }
    setGeneratingCode(true);
    setCodeError(null);
    try {
      const res = await fetch(`/api/conectar-evolution/${token}/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true, webhookUrl: webhookUrlRef.current, phoneNumber: digits }),
      });
      if (res.status === 410) {
        setError("Este link já foi usado ou expirou. Peça um link novo.");
        setStage("invalid");
        return;
      }
      const d = await res.json() as { pairingCode?: string | null };
      if (!d.pairingCode) {
        setCodeError("Não foi possível gerar o código agora. Tente novamente ou use o QR Code.");
        return;
      }
      setPairingCode(d.pairingCode);
      setStage("code-shown");
    } catch {
      setCodeError("Erro ao gerar o código. Tente novamente.");
    } finally {
      setGeneratingCode(false);
    }
  }

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

        {stage === "choose" && (
          <div>
            <h1 className="text-slate-900 text-xl font-bold mb-1">Conectar WhatsApp</h1>
            {instanceName && <p className="text-slate-400 text-xs mb-6">{instanceName}</p>}
            <div className="space-y-3">
              <button
                onClick={() => startQrFlowRef.current?.()}
                className="w-full rounded-2xl border-2 border-violet-200 bg-white hover:bg-violet-50 transition-colors p-4 text-left"
              >
                <p className="font-semibold text-slate-800 text-sm">📷 Escanear QR Code</p>
                <p className="text-xs text-slate-500 mt-0.5">Aponta a câmera do WhatsApp pro código na tela.</p>
              </button>
              <button
                onClick={() => { setStage("code-input"); }}
                className="w-full rounded-2xl border-2 border-slate-200 bg-white hover:bg-slate-50 transition-colors p-4 text-left"
              >
                <p className="font-semibold text-slate-800 text-sm">🔢 Digitar código no celular</p>
                <p className="text-xs text-slate-500 mt-0.5">Sem câmera — digita um código de 8 dígitos direto no WhatsApp.</p>
              </button>
            </div>
          </div>
        )}

        {stage === "code-input" && (
          <div>
            <h1 className="text-slate-900 text-xl font-bold mb-1">Digitar código no WhatsApp</h1>
            <p className="text-slate-500 text-xs mb-6">Informe o número do WhatsApp que vai ser conectado (com DDD).</p>

            <input
              type="tel"
              inputMode="numeric"
              placeholder="(11) 99999-9999"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-center text-lg tracking-wide outline-none focus:border-violet-400 mb-3"
            />

            {codeError && <p className="text-xs text-red-600 mb-3">{codeError}</p>}

            <button
              onClick={generateCode}
              disabled={generatingCode}
              className="w-full rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white font-semibold text-sm px-4 py-3 transition-colors"
            >
              {generatingCode ? "Gerando..." : "Gerar código"}
            </button>

            <button
              onClick={() => { setStage("choose"); setCodeError(null); }}
              className="mt-3 text-xs text-slate-400 hover:text-slate-600 underline"
            >
              Voltar
            </button>
          </div>
        )}

        {stage === "code-shown" && (
          <div>
            <h1 className="text-slate-900 text-xl font-bold mb-4">Digite este código no WhatsApp</h1>

            <div className="rounded-2xl bg-white border-2 border-violet-200 p-6 mb-4">
              <p className="text-3xl font-mono font-bold tracking-[0.2em] text-slate-800">{pairingCode}</p>
            </div>

            <div className="text-left bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
              <p className="text-sm font-semibold text-slate-700 mb-2">Como conectar:</p>
              <p className="text-xs text-slate-500"><strong className="text-slate-700">1.</strong> Abra o WhatsApp no celular informado</p>
              <p className="text-xs text-slate-500"><strong className="text-slate-700">2.</strong> Toque em ⋮ (Android) ou Configurações (iPhone)</p>
              <p className="text-xs text-slate-500"><strong className="text-slate-700">3.</strong> Toque em <strong>Aparelhos conectados</strong></p>
              <p className="text-xs text-slate-500"><strong className="text-slate-700">4.</strong> Toque em <strong>Conectar com número de telefone</strong></p>
              <p className="text-xs text-slate-500"><strong className="text-slate-700">5.</strong> Digite o código acima</p>
            </div>

            <p className="text-xs text-slate-400 mt-4">A página atualiza sozinha assim que a conexão for feita.</p>
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
            {instanceName && <p className="text-slate-400 text-xs mb-6">{instanceName}</p>}

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
