"use client";

import { useState, useRef, useCallback } from "react";
import { clsx } from "clsx";

const CTA_OPTIONS = [
  { value: "WHATSAPP_MESSAGE", label: "Mensagem WhatsApp" },
  { value: "LEARN_MORE",       label: "Saiba mais" },
  { value: "SHOP_NOW",         label: "Comprar agora" },
  { value: "SIGN_UP",          label: "Cadastre-se" },
  { value: "CONTACT_US",       label: "Entre em contato" },
  { value: "SEND_MESSAGE",     label: "Enviar mensagem" },
  { value: "BOOK_TRAVEL",      label: "Reservar" },
  { value: "GET_QUOTE",        label: "Solicitar orçamento" },
];

interface Props {
  clientId?: string;
  adAccountId?: string;
  onClose: () => void;
  onUploaded: () => void;
}

export function UploadCreativeModal({ clientId, adAccountId, onClose, onUploaded }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [useUrl, setUseUrl] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [headline, setHeadline] = useState("");
  const [body, setBody] = useState("");
  const [cta, setCta] = useState("WHATSAPP_MESSAGE");
  const [link, setLink] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(f: File) {
    setFile(f);
    setUseUrl(false);
    const url = URL.createObjectURL(f);
    setPreview(url);
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, []);

  async function submit() {
    if (!useUrl && !file) { setError("Selecione um arquivo ou informe uma URL"); return; }
    if (useUrl && !urlInput.trim()) { setError("Informe a URL do criativo"); return; }

    setSaving(true); setError("");
    try {
      const form = new FormData();
      if (useUrl) {
        form.append("url", urlInput.trim());
      } else {
        form.append("file", file!);
      }
      form.append("copy", JSON.stringify({ headline, body, cta, link: link || null }));
      if (clientId) form.append("clientId", clientId);
      if (adAccountId) form.append("adAccountId", adAccountId);

      const res = await fetch("/api/creatives", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Erro ao enviar"); return; }
      onUploaded();
    } catch { setError("Erro de conexão"); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl overflow-y-auto max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">Enviar criativo para aprovação</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Tipo de envio */}
          <div className="flex gap-2">
            <button
              onClick={() => setUseUrl(false)}
              className={clsx("flex-1 rounded-lg border py-2 text-sm font-medium transition",
                !useUrl ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:border-slate-300")}
            >
              Arquivo
            </button>
            <button
              onClick={() => { setUseUrl(true); setFile(null); setPreview(null); }}
              className={clsx("flex-1 rounded-lg border py-2 text-sm font-medium transition",
                useUrl ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:border-slate-300")}
            >
              URL
            </button>
          </div>

          {/* Upload de arquivo */}
          {!useUrl && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              className={clsx(
                "relative rounded-xl border-2 border-dashed cursor-pointer transition overflow-hidden",
                dragging ? "border-blue-400 bg-blue-50" : "border-slate-200 hover:border-slate-300"
              )}
            >
              <input
                ref={inputRef} type="file" className="hidden"
                accept="image/jpeg,image/png,image/webp,video/mp4"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
              {preview ? (
                <div className="relative">
                  {file?.type.startsWith("video") ? (
                    <video src={preview} className="w-full max-h-48 object-contain bg-black" controls />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={preview} alt="" className="w-full max-h-48 object-contain bg-slate-50" />
                  )}
                  <div className="absolute bottom-2 right-2 rounded-full bg-white/90 px-2 py-0.5 text-xs text-slate-600 shadow">
                    {file?.name}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 py-10 text-slate-400">
                  <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
                  </svg>
                  <p className="text-sm">Arraste ou clique para selecionar</p>
                  <p className="text-xs">JPG, PNG, MP4</p>
                </div>
              )}
            </div>
          )}

          {/* URL */}
          {useUrl && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">URL do criativo</label>
              <input
                type="url" value={urlInput} onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://..."
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>
          )}

          {/* Copy */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Título / Headline</label>
            <input
              value={headline} onChange={(e) => setHeadline(e.target.value)}
              placeholder="Ex: Formação profissional em Coaching"
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Texto do anúncio</label>
            <textarea
              value={body} onChange={(e) => setBody(e.target.value)} rows={3}
              placeholder="Descreva o anúncio..."
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">CTA</label>
              <select
                value={cta} onChange={(e) => setCta(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              >
                {CTA_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Link destino</label>
              <input
                value={link} onChange={(e) => setLink(e.target.value)}
                placeholder="https://... (opcional)"
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">{error}</p>
          )}

          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm text-slate-600 hover:bg-slate-50 transition">
              Cancelar
            </button>
            <button onClick={submit} disabled={saving} className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 transition">
              {saving ? "Enviando..." : "Enviar para aprovação"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
