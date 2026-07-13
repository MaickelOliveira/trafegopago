"use client";

import { useState } from "react";
import type { Briefing } from "@/lib/briefings";

const NICHES = [
  "Pousada / Hotel Fazenda",
  "Dentista / Clínica Odontológica",
  "Construtora / Reforma",
  "Clínica de Estética",
  "Gráfica / Comunicação Visual",
  "Imobiliária",
  "Barbearia",
  "Salão de Beleza",
  "Manicure / Nail Designer",
  "Nutricionista",
  "Psicólogo / Terapeuta",
  "Personal Trainer / Academia",
  "Advogado / Escritório de Advocacia",
  "Contador / Contabilidade",
  "Restaurante / Delivery",
  "Pet Shop / Veterinária",
  "Médico / Clínica Médica",
  "Fotógrafo / Videomaker",
  "Loja de Roupa / Boutique",
  "Automecânica / Oficina",
  "Setor Financeiro / Cobrança",
  "Financeiro Interno (uso da equipe)",
];

const NICHE_ICONS: Record<string, string> = {
  "Pousada / Hotel Fazenda": "🏡",
  "Dentista / Clínica Odontológica": "🦷",
  "Construtora / Reforma": "🏗️",
  "Clínica de Estética": "✨",
  "Gráfica / Comunicação Visual": "🖨️",
  "Imobiliária": "🏠",
  "Barbearia": "💈",
  "Salão de Beleza": "💇",
  "Manicure / Nail Designer": "💅",
  "Nutricionista": "🥗",
  "Psicólogo / Terapeuta": "🧠",
  "Personal Trainer / Academia": "💪",
  "Advogado / Escritório de Advocacia": "⚖️",
  "Contador / Contabilidade": "📊",
  "Restaurante / Delivery": "🍽️",
  "Pet Shop / Veterinária": "🐾",
  "Médico / Clínica Médica": "🩺",
  "Fotógrafo / Videomaker": "📷",
  "Loja de Roupa / Boutique": "👗",
  "Automecânica / Oficina": "🔧",
  "Setor Financeiro / Cobrança": "💰",
  "Financeiro Interno (uso da equipe)": "🏢",
};

// ─── Labels das perguntas ─────────────────────────────────────────────────────
const QUESTION_LABELS: Record<string, string> = {
  nome_negocio: "Nome do negócio",
  nicho: "Segmento",
  cidade: "Cidade / região",
  horario: "Horário de funcionamento",
  servico_principal: "Principal serviço / produto",
  publico_alvo: "Cliente ideal",
  diferencial: "Diferencial",
  cta_principal: "CTA principal",
  ticket_medio: "Ticket médio",
  objecoes: "Objeções dos clientes",
  nome_assistente: "Nome do assistente",
  tom_comunicacao: "Tom de comunicação",
  info_extra: "Informações extras",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function BriefingsView({
  clientId, clientName, briefings: initialBriefings,
}: {
  clientId: string;
  clientName: string;
  briefings: Briefing[];
}) {
  const [briefings, setBriefings] = useState<Briefing[]>(initialBriefings);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ clientName, niche: "" });
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [selected, setSelected] = useState<Briefing | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.niche.trim()) { alert("Selecione o nicho do cliente"); return; }
    const res = await fetch("/api/briefing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, clientName: form.clientName, niche: form.niche || undefined }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error ?? "Erro ao criar"); return; }
    setGeneratedUrl(data.url);
    // Refresh list
    const listRes = await fetch(`/api/briefing?clientId=${clientId}`);
    const listData = await listRes.json();
    if (listData.briefings) setBriefings(listData.briefings);
  }

  function copyUrl() {
    if (!generatedUrl) return;
    navigator.clipboard.writeText(generatedUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function buildPromptText(b: Briefing): string {
    if (!b.answers) return "";
    const lines: string[] = [
      `# Briefing — ${b.clientName}`,
      `Nicho: ${b.answers["nicho"] ?? b.niche ?? ""}`,
      "",
    ];
    for (const [key, val] of Object.entries(b.answers)) {
      if (key === "nicho") continue;
      const label = QUESTION_LABELS[key] ?? key.replace(/_/g, " ");
      lines.push(`**${label}:** ${val}`);
    }
    lines.push("", "---", "Com base nas informações acima, crie um prompt de sistema completo para um assistente de WhatsApp com IA. O prompt deve conter: persona, tom, apresentação, qualificação de leads, respostas às objeções, fluxo de conversa e CTA principal.");
    return lines.join("\n");
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">📋 Briefings</h1>
          <p className="text-slate-500 text-sm mt-0.5">Envie formulários de onboarding para seus clientes</p>
        </div>
        <button
          onClick={() => { setCreating(true); setGeneratedUrl(null); setForm({ clientName, niche: "" }); }}
          className="bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
        >
          + Novo Briefing
        </button>
      </div>

      {/* Modal criar */}
      {creating && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            {!generatedUrl ? (
              <>
                <h2 className="font-bold text-slate-900 text-lg">Novo briefing</h2>
                <form onSubmit={handleCreate} className="space-y-4">
                  <div>
                    <label className="text-xs font-medium text-slate-500 block mb-1">Nome do negócio do cliente <span className="text-violet-500">*</span></label>
                    <input
                      value={form.clientName}
                      onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-500 block mb-2">Nicho do cliente <span className="text-violet-500">*</span></label>
                    <div className="grid grid-cols-2 gap-1.5 max-h-52 overflow-y-auto pr-1">
                      {NICHES.map((n) => (
                        <button
                          type="button"
                          key={n}
                          onClick={() => setForm((f) => ({ ...f, niche: n }))}
                          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-left text-xs font-medium transition ${
                            form.niche === n
                              ? "border-violet-500 bg-violet-50 text-violet-700"
                              : "border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                          }`}
                        >
                          <span>{NICHE_ICONS[n] ?? "📋"}</span>
                          <span className="leading-tight">{n}</span>
                        </button>
                      ))}
                    </div>
                    {form.niche && (
                      <p className="text-xs text-violet-600 mt-1.5 font-medium">✓ {form.niche}</p>
                    )}
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button type="submit" className="flex-1 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold py-2 rounded-xl transition">
                      Gerar link
                    </button>
                    <button type="button" onClick={() => setCreating(false)} className="flex-1 border border-slate-300 text-slate-600 text-sm py-2 rounded-xl hover:bg-slate-50 transition">
                      Cancelar
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <div className="space-y-4 text-center">
                <div className="text-4xl">🔗</div>
                <h2 className="font-bold text-slate-900 text-lg">Link gerado!</h2>
                <p className="text-slate-500 text-sm">Envie este link para seu cliente preencher o briefing:</p>
                <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-mono text-slate-800 break-all">
                  {generatedUrl}
                </div>
                <div className="flex gap-2">
                  <button onClick={copyUrl} className="flex-1 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold py-2.5 rounded-xl transition">
                    {copied ? "✅ Copiado!" : "📋 Copiar link"}
                  </button>
                  <button onClick={() => setCreating(false)} className="flex-1 border border-slate-300 text-slate-600 text-sm py-2.5 rounded-xl hover:bg-slate-50 transition">
                    Fechar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal ver respostas */}
      {selected && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-slate-900">{selected.clientName}</h2>
                <p className="text-xs text-slate-500 mt-0.5">Preenchido em {formatDate(selected.submittedAt!)}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-700 transition text-xl leading-none">×</button>
            </div>

            <div className="overflow-y-auto flex-1 p-5 space-y-3">
              {Object.entries(selected.answers ?? {}).map(([key, val]) => (
                <div key={key} className="bg-slate-50 rounded-xl px-4 py-3">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-0.5">
                    {QUESTION_LABELS[key] ?? key.replace(/_/g, " ")}
                  </p>
                  <p className="text-sm text-slate-800">{val}</p>
                </div>
              ))}
            </div>

            <div className="p-5 border-t border-slate-100">
              <p className="text-xs text-slate-500 mb-3 font-medium">📌 Gerar prompt para o Agente IA:</p>
              <div className="bg-slate-900 text-slate-300 text-xs font-mono rounded-xl p-4 max-h-44 overflow-y-auto whitespace-pre-wrap">
                {buildPromptText(selected)}
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(buildPromptText(selected));
                  alert("Texto copiado! Cole no chat do Copilot para gerar o prompt completo.");
                }}
                className="mt-3 w-full bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold py-2.5 rounded-xl transition"
              >
                📋 Copiar texto para gerar prompt
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lista */}
      {briefings.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <div className="text-4xl mb-3">📋</div>
          <p className="font-medium">Nenhum briefing ainda</p>
          <p className="text-sm mt-1">Clique em &quot;+ Novo Briefing&quot; para criar o primeiro.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {briefings.map((b) => (
            <div key={b.id} className="bg-white border border-slate-200 rounded-2xl px-5 py-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="font-semibold text-slate-900 truncate">{b.clientName}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  Criado em {formatDate(b.createdAt)}
                  {b.niche && ` · ${b.niche}`}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${
                  b.status === "submitted"
                    ? "bg-green-100 text-green-700"
                    : "bg-amber-100 text-amber-700"
                }`}>
                  {b.status === "submitted" ? "✅ Preenchido" : "⏳ Aguardando"}
                </span>
                {b.status === "submitted" ? (
                  <button
                    onClick={() => setSelected(b)}
                    className="text-sm text-violet-600 hover:text-violet-800 font-medium transition"
                  >
                    Ver respostas →
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      const url = `${window.location.origin}/briefing/${b.id}`;
                      navigator.clipboard.writeText(url);
                      alert("Link copiado!");
                    }}
                    className="text-sm text-slate-500 hover:text-slate-700 font-medium transition"
                  >
                    Copiar link
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
