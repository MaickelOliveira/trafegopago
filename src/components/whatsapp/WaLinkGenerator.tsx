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

export function WaLinkGenerator({ pixelId }: Props) {
  const [tab, setTab] = useState<"link" | "snippet">("link");

  // Inputs do gerador de link
  const [phone, setPhone]         = useState("");
  const [message, setMessage]     = useState("Olá! Vi seu anúncio e tenho interesse. Pode me ajudar?");
  const [googleAdsId, setGoogleAdsId]     = useState("");
  const [googleConvLabel, setGoogleConvLabel] = useState("");

  // Preview do link com UTMs de exemplo
  const sampleUTMs = "utm_source=google&utm_campaign=minha-campanha&gclid=EAIa...";
  const sampleMsg  = message
    .replace(/\{campanha\}/g, "minha-campanha")
    .replace(/\{origem\}/g,   "google")
    + " [_:src=google&cmp=minha-campanha&gcd=EAIa...]";
  const previewLink = phone
    ? `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(sampleMsg)}`
    : "Preencha o número acima para ver o link";

  const cleanPhone = phone.replace(/\D/g, "");

  const snippet = `<!-- ====================================================
  Rastreamento WhatsApp — gerado por Nexo
  Adicione este bloco antes do </body> da sua página.
  ===================================================== -->

<!-- 1. Coloque data-wa-track em todos os botões de WhatsApp -->
<!-- Exemplo: <a href="#" data-wa-track>Falar no WhatsApp</a>  -->

<script>
(function () {
  var _WA = {
    phone:           "${cleanPhone}",
    message:         ${JSON.stringify(message)},
    pixelId:         "${pixelId}",          // Meta Pixel ID
    googleAdsId:     "${googleAdsId}",      // ex: AW-12345678
    googleConvLabel: "${googleConvLabel}",  // ex: xXxXxXxXxX
  };

  function rastrearWhatsApp(e) {
    if (e && e.preventDefault) e.preventDefault();

    // --- Lê UTMs da URL da página ---
    var p   = new URLSearchParams(location.search);
    var src = p.get("utm_source")   || "";
    var cmp = p.get("utm_campaign") || "";
    var med = p.get("utm_medium")   || "";
    var cnt = p.get("utm_content")  || "";
    var trm = p.get("utm_term")     || "";
    var fbc = p.get("fbclid")       || "";
    var gcd = p.get("gclid")        || "";

    // --- Dispara Meta Pixel ---
    if (window.fbq && _WA.pixelId) {
      fbq("track", "Lead", {
        content_name:     cmp || "WhatsApp",
        content_category: src || "direto",
      });
    }

    // --- Dispara Google Ads ---
    if (window.gtag && _WA.googleAdsId && _WA.googleConvLabel) {
      gtag("event", "conversion", {
        send_to: _WA.googleAdsId + "/" + _WA.googleConvLabel,
      });
    }

    // --- Monta payload oculto de rastreamento ---
    var parts = [];
    if (src) parts.push("src="  + encodeURIComponent(src));
    if (cmp) parts.push("cmp="  + encodeURIComponent(cmp));
    if (med) parts.push("med="  + encodeURIComponent(med));
    if (cnt) parts.push("cnt="  + encodeURIComponent(cnt));
    if (trm) parts.push("trm="  + encodeURIComponent(trm));
    if (fbc) parts.push("fbc="  + encodeURIComponent(fbc));
    if (gcd) parts.push("gcd="  + encodeURIComponent(gcd));

    var msg = _WA.message;
    if (parts.length) msg += " [_:" + parts.join("&") + "]";

    // --- Redireciona para o WhatsApp ---
    setTimeout(function () {
      window.open(
        "https://wa.me/" + _WA.phone + "?text=" + encodeURIComponent(msg),
        "_blank"
      );
    }, 300);
  }

  // Vincula o evento a todos os elementos com data-wa-track
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-wa-track]").forEach(function (el) {
      el.addEventListener("click", rastrearWhatsApp);
    });
  });

  // Expõe globalmente (para usar via onclick="rastrearWhatsApp(event)" se preferir)
  window.rastrearWhatsApp = rastrearWhatsApp;
})();
</script>`;

  const tabClass = (t: "link" | "snippet") =>
    `px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition ${
      tab === t
        ? "border-[#C4E91E] text-slate-900"
        : "border-transparent text-slate-500 hover:text-slate-700"
    }`;

  return (
    <div className="max-w-3xl mx-auto space-y-6 p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Rastreamento de WhatsApp</h1>
        <p className="text-sm text-slate-500 mt-1">
          Gere o link e o snippet para rastrear cliques no botão de WhatsApp — captura UTMs, dispara pixels e registra o lead automaticamente quando ele mandar a primeira mensagem.
        </p>
      </div>

      {/* Como funciona */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 space-y-1">
        <p className="font-semibold text-slate-700">Como funciona</p>
        <p>1. Lead clica no botão → snippet lê <code className="bg-white px-1 rounded">utm_source</code>, <code className="bg-white px-1 rounded">fbclid</code>, <code className="bg-white px-1 rounded">gclid</code> etc. da URL</p>
        <p>2. Dispara <strong>Meta Pixel Lead</strong> + <strong>Google Ads conversion</strong> no navegador</p>
        <p>3. Redireciona para WhatsApp com mensagem pré-pronta + payload oculto <code className="bg-white px-1 rounded">[_:src=google&cmp=...]</code></p>
        <p>4. Quando o lead mandar a mensagem, a plataforma lê o payload, salva <strong>nome + telefone + UTMs</strong> no CRM e envia <strong>Lead para Meta CAPI</strong></p>
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
              placeholder="5544998841285  (com DDI, sem espaços)"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#C4E91E] focus:ring-1 focus:ring-[#C4E91E]"
            />
            <p className="text-[11px] text-slate-400 mt-0.5">DDI + DDD + número. Ex: 5544998841285</p>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600">Mensagem pré-pronta</label>
            <textarea
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#C4E91E] focus:ring-1 focus:ring-[#C4E91E] resize-none"
            />
            <p className="text-[11px] text-slate-400 mt-0.5">Variáveis disponíveis: <code className="bg-slate-100 px-1 rounded">{"{campanha}"}</code> <code className="bg-slate-100 px-1 rounded">{"{origem}"}</code></p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600">Google Ads ID</label>
              <input
                value={googleAdsId}
                onChange={(e) => setGoogleAdsId(e.target.value)}
                placeholder="AW-12345678"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#C4E91E] focus:ring-1 focus:ring-[#C4E91E]"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Label da conversão</label>
              <input
                value={googleConvLabel}
                onChange={(e) => setGoogleConvLabel(e.target.value)}
                placeholder="xXxXxXxXxX"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#C4E91E] focus:ring-1 focus:ring-[#C4E91E]"
              />
            </div>
          </div>

          {pixelId && (
            <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
              Meta Pixel <strong>{pixelId}</strong> já configurado — CAPI disparará automaticamente ao receber o lead no WhatsApp.
            </div>
          )}
        </div>
      </div>

      {/* Tabs de saída */}
      <div>
        <div className="flex gap-1 border-b border-slate-200">
          <button className={tabClass("link")} onClick={() => setTab("link")}>📎 Link WhatsApp</button>
          <button className={tabClass("snippet")} onClick={() => setTab("snippet")}>⚙️ Snippet JS</button>
        </div>

        {tab === "link" && (
          <div className="rounded-b-xl rounded-tr-xl border border-slate-200 bg-white p-5 space-y-3">
            <p className="text-xs text-slate-500">Use este link diretamente nos seus anúncios (com os UTMs na URL do anúncio). O link abaixo é uma prévia com UTMs de exemplo:</p>
            <div className="flex items-start gap-2">
              <code className="flex-1 block break-all rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-700">
                {previewLink}
              </code>
              {phone && <CopyButton text={`https://wa.me/${cleanPhone}?text=${encodeURIComponent(message + " [_:" + sampleUTMs.replace("utm_source=google&utm_campaign=minha-campanha&gclid=EAIa...", "src=google&cmp=minha-campanha&gcd=EAIa...") + "]")}`} />}
            </div>
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
              <strong>Dica:</strong> Nos anúncios do Google/Meta, configure os UTMs como parâmetros da URL de destino. O snippet na sua página vai lê-los automaticamente — você <em>não</em> precisa alterar o link manualmente por campanha.
            </div>
          </div>
        )}

        {tab === "snippet" && (
          <div className="rounded-b-xl rounded-tr-xl border border-slate-200 bg-white p-5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500">Cole este código antes do <code className="bg-slate-100 px-1 rounded">&lt;/body&gt;</code> de cada landing page. Depois, adicione <code className="bg-slate-100 px-1 rounded">data-wa-track</code> nos botões de WhatsApp.</p>
              <CopyButton text={snippet} />
            </div>
            <pre className="text-[11px] text-slate-700 bg-slate-900 text-green-300 rounded-xl p-4 overflow-x-auto whitespace-pre-wrap leading-relaxed">
              {snippet}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
