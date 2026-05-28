"use client";

import { useState } from "react";

type Preset = {
  label: string;
  icon: string;
  source: string;
  medium: string;
  campaign?: string;
  content?: string;
};

const PRESETS: Preset[] = [
  { label: "Meta Ads",    icon: "🟦", source: "facebook",   medium: "cpc",        campaign: "nome-da-campanha" },
  { label: "Google Ads",  icon: "🔴", source: "google",     medium: "cpc",        campaign: "nome-da-campanha" },
  { label: "E-mail",      icon: "📧", source: "email",      medium: "newsletter", campaign: "nome-da-campanha" },
  { label: "WhatsApp",    icon: "💬", source: "whatsapp",   medium: "social",     campaign: "organico" },
  { label: "Instagram",   icon: "📸", source: "instagram",  medium: "social",     campaign: "organico" },
  { label: "YouTube",     icon: "▶️", source: "youtube",    medium: "video",      campaign: "nome-do-video" },
];

const FIELD_HELP: Record<string, string> = {
  utm_source:   "Identifica de onde vem o tráfego. Ex: facebook, google, email.",
  utm_medium:   "Canal de marketing. Ex: cpc (anúncio pago), newsletter, social.",
  utm_campaign: "Nome da campanha. Ex: promo-black-friday, lancamento-produto.",
  utm_content:  "Diferencia variações do mesmo anúncio. Ex: banner-azul, cta-verde.",
  utm_term:     "Palavras-chave (Google Ads). Ex: curso-online, consultoria-marketing.",
};

type Props = {
  clientId: string;
  clientName: string;
  webhookUrl: string;
};

export function UtmBuilder({ clientName, webhookUrl }: Props) {
  const [baseUrl, setBaseUrl] = useState("https://");
  const [source,   setSource]   = useState("");
  const [medium,   setMedium]   = useState("");
  const [campaign, setCampaign] = useState("");
  const [content,  setContent]  = useState("");
  const [term,     setTerm]     = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  function applyPreset(p: Preset) {
    setSource(p.source);
    setMedium(p.medium);
    if (p.campaign) setCampaign(p.campaign);
    if (p.content)  setContent(p.content);
    setTerm("");
  }

  function buildUrl() {
    try {
      const url = new URL(baseUrl.trim() || "https://example.com");
      if (source)   url.searchParams.set("utm_source",   source.trim());
      if (medium)   url.searchParams.set("utm_medium",   medium.trim());
      if (campaign) url.searchParams.set("utm_campaign", campaign.trim());
      if (content)  url.searchParams.set("utm_content",  content.trim());
      if (term)     url.searchParams.set("utm_term",     term.trim());
      return url.toString();
    } catch {
      return baseUrl;
    }
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  const finalUrl = buildUrl();
  const hasParams = source || medium || campaign || content || term;

  const formSnippet = `<!-- Cole este script antes de </body> -->
<script>
(function(){
  var form = document.querySelector("form"); // ajuste se necessário
  if(!form) return;
  form.addEventListener("submit", function(e){
    e.preventDefault();
    var data = Object.fromEntries(new FormData(form));
    var p = new URLSearchParams(window.location.search);
    ["utm_source","utm_medium","utm_campaign","utm_content","utm_term","fbclid","gclid"].forEach(function(k){
      if(p.get(k)) data[k] = p.get(k);
    });
    fetch("${webhookUrl}", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(data)
    });
    // Descomente para enviar o form normalmente após captura:
    // form.submit();
  });
})();
</script>`;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-900">🧰 UTM Builder</h1>
        <p className="text-sm text-slate-500 mt-0.5">Gere URLs rastreadas para campanhas de {clientName}.</p>
      </div>

      {/* Presets */}
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Preset rápido</p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button key={p.label} onClick={() => applyPreset(p)}
              className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-violet-400 hover:text-violet-700 transition">
              <span>{p.icon}</span> {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Builder */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1 block">
            URL da página de destino *
          </label>
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://seusite.com/pagina"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          {([
            { key: "utm_source",   label: "utm_source *",  value: source,   set: setSource },
            { key: "utm_medium",   label: "utm_medium *",  value: medium,   set: setMedium },
            { key: "utm_campaign", label: "utm_campaign *", value: campaign, set: setCampaign },
            { key: "utm_content",  label: "utm_content",   value: content,  set: setContent },
            { key: "utm_term",     label: "utm_term",      value: term,     set: setTerm },
          ] as const).map(({ key, label, value, set }) => (
            <div key={key}>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1 block">{label}</label>
              <input value={value} onChange={(e) => set(e.target.value)}
                placeholder={key.replace("utm_", "")}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" />
              <p className="text-xs text-slate-400 mt-0.5">{FIELD_HELP[key]}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Result */}
      {hasParams && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 space-y-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">URL Gerada</p>
          <div className="flex items-start gap-2">
            <code className="flex-1 rounded-lg bg-white border border-violet-200 px-3 py-2 text-xs font-mono text-slate-700 break-all">{finalUrl}</code>
            <button onClick={() => copy(finalUrl, "url")}
              className="shrink-0 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700 transition">
              {copied === "url" ? "✓ Copiado" : "Copiar"}
            </button>
          </div>
        </div>
      )}

      {/* Webhook URL */}
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Webhook do Formulário (POST)</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-lg bg-white border border-blue-200 px-3 py-2 text-xs font-mono text-slate-700 break-all">{webhookUrl}</code>
          <button onClick={() => copy(webhookUrl, "webhook")}
            className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition">
            {copied === "webhook" ? "✓ Copiado" : "Copiar"}
          </button>
        </div>
        <p className="text-xs text-slate-500">
          Conecte seu formulário HTML a este endpoint para capturar leads automaticamente com UTMs, fbclid e gclid.
        </p>
      </div>

      {/* Form snippet */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Snippet JavaScript</p>
          <button onClick={() => copy(formSnippet, "snippet")}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition">
            {copied === "snippet" ? "✓ Copiado" : "Copiar código"}
          </button>
        </div>
        <pre className="rounded-lg bg-slate-900 p-3 text-xs text-green-300 overflow-x-auto whitespace-pre-wrap">{formSnippet}</pre>
      </div>

      {/* Guide */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
        <p className="text-sm font-semibold text-slate-800">📖 Guia rápido de UTMs</p>
        <div className="space-y-2">
          {Object.entries(FIELD_HELP).map(([k, v]) => (
            <div key={k} className="flex gap-3">
              <code className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-violet-700">{k}</code>
              <p className="text-xs text-slate-600">{v}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3">
          <p className="text-xs font-semibold text-amber-800 mb-1">💡 Exemplo completo — Meta Ads:</p>
          <code className="text-xs text-amber-700 break-all">
            {`https://seusite.com/lp?utm_source=facebook&utm_medium=cpc&utm_campaign=promo-maio&utm_content=banner-azul`}
          </code>
        </div>
      </div>
    </div>
  );
}
