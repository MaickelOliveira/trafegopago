"use client";

import { useState } from "react";

interface Props {
  clientId: string;
  clientName: string;
  pixelId: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 transition"
    >
      {copied ? "✓ Copiado!" : "Copiar"}
    </button>
  );
}

export function WaLinkGenerator({ clientId, clientName, pixelId }: Props) {
  const [tab, setTab] = useState<"pixel" | "link">("pixel");

  const [phone, setPhone]     = useState("");
  const [message, setMessage] = useState("Olá! Vi seu anúncio e tenho interesse. Pode me ajudar?");

  const cleanPhone = phone.replace(/\D/g, "");

  // URL base: no browser sempre temos window.location.origin
  const base = typeof window !== "undefined" ? window.location.origin : "";

  // URL do pixel sempre limpa — Google Ads, Meta Pixel etc. vêm das Configurações do cliente
  const pixelUrl  = `${base}/api/pixel/${clientId}`;
  const scriptTag = `<script src="${pixelUrl}"></script>`;

  // Botão com dados no atributo (telefone e mensagem ficam no botão, não no pixel)
  const buttonExample = cleanPhone
    ? `<a href="#" data-wa-track data-wa-phone="${cleanPhone}" data-wa-msg="${message}">\n  Falar no WhatsApp\n</a>`
    : `<a href="#" data-wa-track data-wa-phone="NUMERO" data-wa-msg="${message}">\n  Falar no WhatsApp\n</a>`;

  // Link direto (sem UTMs — para bio ou testes)
  const directLink = cleanPhone
    ? `https://wa.me/${cleanPhone}${message ? `?text=${encodeURIComponent(message)}` : ""}`
    : "Preencha o número acima para ver o link";

  const tabClass = (t: "pixel" | "link") =>
    `px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition ${
      tab === t
        ? "border-[#C4E91E] text-slate-900"
        : "border-transparent text-slate-500 hover:text-slate-700"
    }`;

  return (
    <div className="max-w-3xl mx-auto space-y-6 p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Rastreamento de WhatsApp — {clientName}</h1>
        <p className="text-sm text-slate-500 mt-1">
          Instale o pixel em qualquer landing page. Ele captura UTMs, dispara Google Ads no clique e envia o evento Lead para o Meta via CAPI somente quando o lead entra no CRM — garantindo qualidade máxima nos dados.
        </p>
      </div>

      {/* Como funciona */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 space-y-1">
        <p className="font-semibold text-slate-700">Como funciona</p>
        <p>1. Pixel carrega na página → captura <code className="bg-white px-1 rounded">utm_source</code>, <code className="bg-white px-1 rounded">fbclid</code>, <code className="bg-white px-1 rounded">gclid</code> etc.</p>
        <p>2. Lead clica no botão → dispara <strong>Google Ads conversion</strong> no browser + salva UTMs no servidor</p>
        <p>3. Redireciona para wa.me (mensagem limpa, sem código oculto)</p>
        <p>4. Lead manda a 1ª mensagem → entra no CRM → plataforma envia <strong>Lead para Meta via CAPI</strong> (só nesse momento — lead confirmado)</p>
      </div>

      {/* Configuração */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <p className="text-sm font-semibold text-slate-800">Configuração</p>

        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className="text-xs font-medium text-slate-600">Número do WhatsApp <span className="text-red-400">*</span></label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="5544998841285  (DDI + DDD + número)"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#C4E91E] focus:ring-1 focus:ring-[#C4E91E]"
            />
            <p className="text-[11px] text-slate-400 mt-0.5">Ex: 5544998841285 (Brasil 55 + DDD + número)</p>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600">Mensagem pré-pronta</label>
            <textarea
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#C4E91E] focus:ring-1 focus:ring-[#C4E91E] resize-none"
            />
          </div>

          {pixelId && (
            <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
              Meta Pixel <strong>{pixelId}</strong> configurado — CAPI disparará automaticamente ao receber o lead.
            </div>
          )}
        </div>
      </div>

      {/* Tabs de saída */}
      <div>
        <div className="flex gap-1 border-b border-slate-200">
          <button className={tabClass("pixel")} onClick={() => setTab("pixel")}>📦 Pixel (instalar na página)</button>
          <button className={tabClass("link")} onClick={() => setTab("link")}>🔗 Link direto</button>
        </div>

        {tab === "pixel" && (
          <div className="rounded-b-xl rounded-tr-xl border border-slate-200 bg-white p-5 space-y-4">
            {/* Step 1 */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-700">Passo 1 — Cole esta tag antes do <code className="bg-slate-100 px-1 rounded">&lt;/body&gt;</code></p>
              <div className="flex items-start gap-2">
                <code className="flex-1 block break-all rounded-lg bg-slate-900 px-3 py-2 text-xs text-green-300 font-mono">
                  {scriptTag}
                </code>
                <CopyButton text={scriptTag} />
              </div>
              <p className="text-[11px] text-slate-400">
                O script é gerado com as suas configurações e carrega uma única vez. Funciona em qualquer página HTML — WordPress, Elementor, Webflow, RD Station, etc.
              </p>
            </div>

            {/* Step 2 */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-700">
                Passo 2 — Substitua seus botões de WhatsApp por este modelo
              </p>
              <div className="flex items-start gap-2">
                <pre className="flex-1 rounded-lg bg-slate-900 px-3 py-2 text-xs text-green-300 font-mono whitespace-pre overflow-x-auto">
                  {buttonExample}
                </pre>
                <CopyButton text={buttonExample} />
              </div>
              <p className="text-[11px] text-slate-400 space-y-0.5">
                O telefone e a mensagem ficam <strong>no botão</strong>, não na URL do pixel.
                Isso permite ter botões diferentes na mesma página (ex: um por produto).
              </p>
            </div>

            {/* Observação */}
            <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-700 space-y-1">
              <p className="font-semibold">Como funciona</p>
              <p>O pixel carrega uma única vez e fica de plantão. Quando o botão é clicado, ele lê o <code className="bg-blue-100 px-0.5 rounded">data-wa-phone</code> e <code className="bg-blue-100 px-0.5 rounded">data-wa-msg</code> do próprio elemento, captura os UTMs da URL e redireciona pelo servidor — a mensagem chega limpa, sem código.</p>
              {!cleanPhone && <p className="text-amber-600 font-medium mt-1">⚠ Preencha o número acima para gerar o botão correto.</p>}
            </div>
          </div>
        )}

        {tab === "link" && (
          <div className="rounded-b-xl rounded-tr-xl border border-slate-200 bg-white p-5 space-y-3">
            <p className="text-xs text-slate-500">Link direto para wa.me, sem rastreamento. Use na bio do Instagram ou para compartilhar manualmente.</p>
            <div className="flex items-start gap-2">
              <code className="flex-1 block break-all rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-700">
                {directLink}
              </code>
              {cleanPhone && <CopyButton text={directLink} />}
            </div>
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
              <strong>Dica:</strong> Para anúncios rastreados, use o pixel acima na sua landing page em vez deste link diretamente. O pixel captura os UTMs do anúncio automaticamente.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
