"use client";

import { useState } from "react";
import { clsx } from "clsx";

type Client = { id: string; name: string; color: string };

type Criativo = { nome: string; url: string; arquivo: string };

type Resultado = {
  legenda: string;
  promptImagem: string;
  cta: string;
  hashtags: string[];
  imageUrl: string | null;
  tema: string;
  plataforma: string;
  formato: string;
  erro?: string;
};

const PLATAFORMAS = ["Instagram", "Facebook", "TikTok", "LinkedIn", "YouTube"];
const FORMATOS = ["Post estático", "Carrossel", "Reels / TikTok", "Stories", "LinkedIn Post"];
const TONS = ["Profissional e direto", "Descontraído e informal", "Educativo", "Inspiracional", "Urgente / Oferta"];

export function SocialMediaView({ clients }: { clients: Client[] }) {
  const [clientId, setClientId]       = useState(clients[0]?.id ?? "");
  const [tema, setTema]               = useState("");
  const [plataforma, setPlataforma]   = useState("Instagram");
  const [formato, setFormato]         = useState("Post estático");
  const [tom, setTom]                 = useState("Profissional e direto");
  const [gerando, setGerando]         = useState(false);
  const [resultado, setResultado]     = useState<Resultado | null>(null);
  const [editLegenda, setEditLegenda] = useState("");
  const [postando, setPostando]       = useState(false);
  const [postResult, setPostResult]   = useState<string | null>(null);
  const [historico, setHistorico]     = useState<Resultado[]>([]);
  const [criativos, setCriativos]     = useState<Criativo[]>([]);
  const [abaAtiva, setAbaAtiva]       = useState<"gerar" | "galeria">("gerar");

  // Carrega galeria ao trocar cliente
  useState(() => {
    if (!clientId) return;
    fetch(`/api/social/criativos?clientId=${clientId}`)
      .then((r) => r.json())
      .then((data) => setCriativos(Array.isArray(data) ? data : []));
  });

  async function carregarGaleria(id: string) {
    const data = await fetch(`/api/social/criativos?clientId=${id}`).then((r) => r.json());
    setCriativos(Array.isArray(data) ? data : []);
  }

  async function gerar() {
    if (!tema.trim() || !clientId) return;
    setGerando(true);
    setResultado(null);
    setPostResult(null);

    const res = await fetch("/api/social/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, tema, plataforma, formato, tom }),
    });

    const data: Resultado = await res.json();
    setResultado(data);
    setEditLegenda(data.legenda);
    setGerando(false);
  }

  async function postar() {
    if (!resultado?.imageUrl) return;
    setPostando(true);
    setPostResult(null);

    const res = await fetch("/api/social/post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageUrl: resultado.imageUrl,
        legenda: editLegenda,
        instagramAccountId: "me", // configurar por cliente
      }),
    });

    const data = await res.json();
    if (data.ok) {
      setPostResult(`✅ Publicado! ID: ${data.postId}`);
      setHistorico((prev) => [{ ...resultado, legenda: editLegenda }, ...prev]);
    } else {
      setPostResult(`❌ ${data.error}`);
    }
    setPostando(false);
  }

  function salvarNoHistorico() {
    if (resultado) {
      setHistorico((prev) => [{ ...resultado, legenda: editLegenda }, ...prev]);
    }
  }

  const client = clients.find((c) => c.id === clientId);

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Social Media IA</h1>
          <p className="text-sm text-slate-500 mt-0.5">Gere criativos e legendas com IA para seus clientes</p>
        </div>
        <div className="flex rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          <button onClick={() => setAbaAtiva("gerar")}
            className={clsx("px-5 py-2.5 text-sm font-semibold transition",
              abaAtiva === "gerar" ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"
            )}>
            ✨ Gerar
          </button>
          <button onClick={() => { setAbaAtiva("galeria"); carregarGaleria(clientId); }}
            className={clsx("px-5 py-2.5 text-sm font-semibold transition",
              abaAtiva === "galeria" ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"
            )}>
            🖼️ Galeria {criativos.length > 0 && `(${criativos.length})`}
          </button>
        </div>
      </div>

      {/* Galeria */}
      {abaAtiva === "galeria" && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <select value={clientId} onChange={(e) => { setClientId(e.target.value); carregarGaleria(e.target.value); }}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 bg-white">
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <span className="text-sm text-slate-400">{criativos.length} criativo{criativos.length !== 1 ? "s" : ""}</span>
          </div>
          {criativos.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 p-16 text-center">
              <p className="text-4xl mb-3">🖼️</p>
              <p className="text-sm font-semibold text-slate-600">Nenhum criativo salvo para este cliente</p>
              <p className="text-xs text-slate-400 mt-1">Gere criativos na aba ✨ Gerar e eles aparecerão aqui</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {criativos.map((c) => (
                <div key={c.arquivo} className="group relative rounded-2xl overflow-hidden border border-slate-200 shadow-sm bg-black">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.url} alt={c.nome} className="w-full aspect-square object-cover" />
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex flex-col items-center justify-center gap-3 p-3">
                    <p className="text-white text-xs font-semibold text-center capitalize">{c.nome}</p>
                    <a href={c.url} download={c.arquivo}
                      className="rounded-xl bg-white px-4 py-2 text-xs font-bold text-slate-900 hover:bg-slate-100 transition">
                      ⬇ Baixar
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {abaAtiva === "gerar" && <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Formulário */}
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <h2 className="text-sm font-semibold text-slate-700">Configurar conteúdo</h2>

            {/* Cliente */}
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1.5">Cliente</label>
              <select value={clientId} onChange={(e) => setClientId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-400 bg-white">
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {/* Tema */}
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1.5">Tema / Assunto do post</label>
              <textarea
                value={tema}
                onChange={(e) => setTema(e.target.value)}
                placeholder="Ex: 5 erros no tráfego pago que custam dinheiro, ou: Promoção de fim de mês, ou: Dica de como aumentar o CTR..."
                rows={3}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-400 resize-none"
              />
            </div>

            {/* Plataforma */}
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1.5">Plataforma</label>
              <div className="flex flex-wrap gap-1.5">
                {PLATAFORMAS.map((p) => (
                  <button key={p} onClick={() => setPlataforma(p)}
                    className={clsx("rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                      plataforma === p ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:border-slate-300"
                    )}>
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Formato */}
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1.5">Formato</label>
              <select value={formato} onChange={(e) => setFormato(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-400 bg-white">
                {FORMATOS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>

            {/* Tom */}
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1.5">Tom de voz</label>
              <select value={tom} onChange={(e) => setTom(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-400 bg-white">
                {TONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <button
              onClick={gerar}
              disabled={gerando || !tema.trim() || !clientId}
              className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 py-3 text-sm font-bold text-white hover:from-indigo-700 hover:to-violet-700 disabled:opacity-50 transition shadow-lg shadow-indigo-200"
            >
              {gerando ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Gerando criativo... (~10s)
                </span>
              ) : "✨ Gerar com IA"}
            </button>
          </div>

          {/* Histórico */}
          {historico.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-700 mb-3">Histórico ({historico.length})</h2>
              <div className="space-y-2">
                {historico.map((h, i) => (
                  <button key={i} onClick={() => { setResultado(h); setEditLegenda(h.legenda); }}
                    className="w-full text-left rounded-xl border border-slate-100 p-3 hover:bg-slate-50 transition">
                    <p className="text-xs font-semibold text-slate-700 truncate">{h.tema}</p>
                    <p className="text-xs text-slate-400">{h.plataforma} · {h.formato}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Preview */}
        <div className="lg:col-span-3">
          {gerando && (
            <div className="rounded-2xl border border-slate-200 bg-white p-12 shadow-sm flex flex-col items-center justify-center gap-4">
              <div className="h-16 w-16 rounded-full border-4 border-indigo-100 border-t-indigo-500 animate-spin" />
              <div className="text-center">
                <p className="text-sm font-semibold text-slate-700">Claude está escrevendo o conteúdo...</p>
                <p className="text-xs text-slate-400 mt-1">Nano Banana está gerando a imagem...</p>
              </div>
            </div>
          )}

          {resultado && !gerando && (
            <div className="space-y-4">
              {/* Imagem gerada */}
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    {client && (
                      <span className="h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
                        style={{ backgroundColor: client.color }}>{client.name[0]}</span>
                    )}
                    <span className="text-sm font-semibold text-slate-700">{client?.name}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{resultado.plataforma} · {resultado.formato}</span>
                  </div>
                  <button onClick={gerar} className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">
                    ↺ Regenerar
                  </button>
                </div>

                {resultado.imageUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={resultado.imageUrl} alt="Criativo gerado" className="w-full object-cover max-h-[400px]" />
                ) : (
                  <div className="bg-slate-50 p-6 text-center">
                    <p className="text-sm text-slate-400">
                      {resultado.erro ? `Erro na imagem: ${resultado.erro}` : "Imagem não gerada"}
                    </p>
                    <p className="text-xs text-slate-300 mt-1 italic">{resultado.promptImagem}</p>
                  </div>
                )}
              </div>

              {/* Legenda editável */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-700">Legenda</h3>
                  <span className="text-xs text-slate-400">{editLegenda.length} caracteres</span>
                </div>
                <textarea
                  value={editLegenda}
                  onChange={(e) => setEditLegenda(e.target.value)}
                  rows={6}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-400 resize-none"
                />

                {/* Hashtags */}
                {resultado.hashtags?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {resultado.hashtags.map((h) => (
                      <span key={h} className="rounded-full bg-blue-50 border border-blue-100 px-2.5 py-1 text-xs text-blue-600 font-medium">
                        #{h}
                      </span>
                    ))}
                  </div>
                )}

                {/* Ações */}
                <div className="flex gap-3 pt-1">
                  <button onClick={salvarNoHistorico}
                    className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600 hover:bg-slate-50 transition">
                    Salvar rascunho
                  </button>
                  <button
                    onClick={() => navigator.clipboard.writeText(editLegenda)}
                    className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600 hover:bg-slate-50 transition">
                    Copiar legenda
                  </button>
                  <button
                    onClick={postar}
                    disabled={postando || !resultado.imageUrl}
                    className="flex-1 rounded-xl bg-gradient-to-r from-green-600 to-emerald-600 py-2.5 text-sm font-bold text-white hover:from-green-700 hover:to-emerald-700 disabled:opacity-50 transition"
                  >
                    {postando ? "Publicando..." : "📤 Publicar"}
                  </button>
                </div>

                {postResult && (
                  <p className={clsx("rounded-xl px-4 py-3 text-sm font-medium",
                    postResult.startsWith("✅") ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-600 border border-red-200"
                  )}>
                    {postResult}
                  </p>
                )}
              </div>

              {/* Prompt da imagem */}
              <details className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <summary className="text-xs font-medium text-slate-500 cursor-pointer">Ver prompt da imagem</summary>
                <p className="text-xs text-slate-400 mt-2 italic">{resultado.promptImagem}</p>
              </details>
            </div>
          )}

          {!resultado && !gerando && (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 p-16 flex flex-col items-center justify-center gap-3 text-center">
              <span className="text-5xl">🎨</span>
              <p className="text-base font-semibold text-slate-700">Seu criativo aparece aqui</p>
              <p className="text-sm text-slate-400">Preencha o formulário ao lado e clique em Gerar com IA</p>
            </div>
          )}
        </div>
      </div>}
    </div>
  );
}
