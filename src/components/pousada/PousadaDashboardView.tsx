"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import type { Reserva, PousadaTipo, CategoriaTipo } from "@/lib/pousada-types";
import { ReservaModal } from "./ReservaModal";
import { PousadaSubNav } from "./PousadaSubNav";
import { formatDataComDiaSemana } from "@/lib/format-date";

function fmt(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

type PeriodoFiltro = "hoje" | "ontem" | "7d" | "15d" | "mes_atual" | "mes_passado" | "ano_atual" | "todo" | "personalizado";

const PERIODOS: { value: PeriodoFiltro; label: string }[] = [
  { value: "hoje", label: "Hoje" },
  { value: "ontem", label: "Ontem" },
  { value: "7d", label: "7 dias" },
  { value: "15d", label: "15 dias" },
  { value: "mes_atual", label: "Este mês" },
  { value: "mes_passado", label: "Mês passado" },
  { value: "ano_atual", label: "Este ano" },
  { value: "todo", label: "Todo o período" },
  { value: "personalizado", label: "Personalizado" },
];

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Calcula [de, até] (ISO, inclusive nas duas pontas) pro período selecionado.
// null = sem filtro de data ("todo o período"). "7 dias"/"15 dias" olham pra
// TRÁS (últimos N dias incluindo hoje), mesma convenção dos presets de data já
// usados no resto da plataforma (last_7d/last_14d no dashboard de Meta Ads).
function calcularRange(periodo: PeriodoFiltro, customFrom: string, customTo: string): { de: string; ate: string } | null {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  switch (periodo) {
    case "hoje": {
      const s = toISO(hoje);
      return { de: s, ate: s };
    }
    case "ontem": {
      const ontem = new Date(hoje); ontem.setDate(hoje.getDate() - 1);
      const s = toISO(ontem);
      return { de: s, ate: s };
    }
    case "7d": {
      const inicio = new Date(hoje); inicio.setDate(hoje.getDate() - 6);
      return { de: toISO(inicio), ate: toISO(hoje) };
    }
    case "15d": {
      const inicio = new Date(hoje); inicio.setDate(hoje.getDate() - 14);
      return { de: toISO(inicio), ate: toISO(hoje) };
    }
    case "mes_atual": {
      const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      const fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
      return { de: toISO(inicio), ate: toISO(fim) };
    }
    case "mes_passado": {
      const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
      const fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
      return { de: toISO(inicio), ate: toISO(fim) };
    }
    case "ano_atual": {
      const inicio = new Date(hoje.getFullYear(), 0, 1);
      const fim = new Date(hoje.getFullYear(), 11, 31);
      return { de: toISO(inicio), ate: toISO(fim) };
    }
    case "personalizado":
      if (!customFrom && !customTo) return null;
      return { de: customFrom || "0000-01-01", ate: customTo || "9999-12-31" };
    case "todo":
    default:
      return null;
  }
}

export function PousadaDashboardView({ clientId, role }: { clientId: string; role: "manager" | "client" }) {
  const [tipos, setTipos] = useState<PousadaTipo[]>([]);
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"new" | Reserva | null>(null);
  const [editingTipos, setEditingTipos] = useState(false);
  const [guestFormPicker, setGuestFormPicker] = useState(false);
  const [guestFormPhone, setGuestFormPhone] = useState("");
  const [guestFormGenerating, setGuestFormGenerating] = useState(false);
  const [guestFormUrl, setGuestFormUrl] = useState<string | null>(null);
  const [guestFormError, setGuestFormError] = useState<string | null>(null);
  const [guestFormCopied, setGuestFormCopied] = useState(false);
  const [servicoFormPicker, setServicoFormPicker] = useState(false);
  const [servicoFormPhone, setServicoFormPhone] = useState("");
  const [servicoFormTipo, setServicoFormTipo] = useState("");
  const [servicoFormGenerating, setServicoFormGenerating] = useState(false);
  const [servicoFormUrl, setServicoFormUrl] = useState<string | null>(null);
  const [servicoFormError, setServicoFormError] = useState<string | null>(null);
  const [servicoFormCopied, setServicoFormCopied] = useState(false);
  const [tiposDraft, setTiposDraft] = useState<PousadaTipo[]>([]);
  const [novoTipoLabel, setNovoTipoLabel] = useState("");
  const [novoTipoCategoria, setNovoTipoCategoria] = useState<CategoriaTipo>("evento");
  // Padrão: mês vigente — dá visão do mês corrente assim que abre a tela.
  const [periodo, setPeriodo] = useState<PeriodoFiltro>("mes_atual");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [busca, setBusca] = useState("");
  const [pixChave, setPixChave] = useState("");
  const [pixFavorecido, setPixFavorecido] = useState("");
  const [editingPix, setEditingPix] = useState(false);
  const [pixDraft, setPixDraft] = useState({ chave: "", favorecido: "" });

  const load = useCallback(async () => {
    setLoading(true);
    const [tiposRes, reservasRes, configRes] = await Promise.all([
      fetch(`/api/pousada/tipos?clientId=${clientId}`).then((r) => r.json()),
      fetch(`/api/pousada/reservas?clientId=${clientId}`).then((r) => r.json()),
      fetch(`/api/pousada/config?clientId=${clientId}`).then((r) => r.json()),
    ]);
    setTipos(Array.isArray(tiposRes) ? tiposRes : []);
    setReservas(reservasRes.reservas ?? []);
    setPixChave(configRes.pixChave ?? "");
    setPixFavorecido(configRes.pixFavorecido ?? "");
    setLoading(false);
  }, [clientId]);

  async function salvarPix() {
    const res = await fetch("/api/pousada/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, pixChave: pixDraft.chave, pixFavorecido: pixDraft.favorecido }),
    });
    if (res.ok) {
      setPixChave(pixDraft.chave);
      setPixFavorecido(pixDraft.favorecido);
      setEditingPix(false);
    }
  }

  useEffect(() => { load(); }, [load]);

  const range = calcularRange(periodo, customFrom, customTo);
  const upcoming = reservas
    .filter((r) => r.status !== "cancelada")
    .filter((r) => !range || (r.data >= range.de && r.data <= range.ate))
    .sort((a, b) => a.data.localeCompare(b.data));

  const aReceber = upcoming.reduce((s, r) => s + r.faltaPagar, 0);

  function reservasDoTipo(slug: string) {
    return upcoming.filter((r) => r.tipo === slug);
  }

  const base = role === "manager" ? `/gestor/${clientId}/pousada` : "/cliente/pousada";
  const buscaAtiva = busca.trim().toLowerCase();
  const encontrados = buscaAtiva
    ? upcoming.filter(
        (r) =>
          r.responsavel.nome.toLowerCase().includes(buscaAtiva) ||
          r.pessoas.some((p) => p.nome.toLowerCase().includes(buscaAtiva))
      )
    : [];

  async function saveTipos() {
    const res = await fetch("/api/pousada/tipos", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, tipos: tiposDraft }),
    });
    if (res.ok) {
      setTipos(tiposDraft);
      setEditingTipos(false);
    }
  }

  function addTipoDraft() {
    const label = novoTipoLabel.trim();
    if (!label) return;
    const slug = slugify(label);
    if (!slug || tiposDraft.some((t) => t.slug === slug)) return;
    setTiposDraft((prev) => [...prev, { slug, label, categoria: novoTipoCategoria }]);
    setNovoTipoLabel("");
  }

  // Gera o link do formulário de hóspedes na mão — usado quando a IA está
  // pausada e o atendente está conduzindo a reserva de hospedagem manualmente
  // (a IA só gera esse link sozinha via marcador no prompt). Não depende de
  // uma conversa selecionada — o servidor detecta a conexão automaticamente.
  async function gerarGuestFormLink() {
    const digits = guestFormPhone.replace(/\D/g, "");
    if (!digits) return;
    setGuestFormGenerating(true);
    setGuestFormError(null);
    setGuestFormUrl(null);
    try {
      const res = await fetch("/api/whatsapp/inbox/guest-form-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: digits, clientId }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || !data.ok) {
        setGuestFormError(data?.error ?? "Erro ao gerar link — tente novamente.");
        return;
      }
      setGuestFormUrl(data.url);
    } catch {
      setGuestFormError("Erro ao gerar link. Verifique sua conexão.");
    } finally {
      setGuestFormGenerating(false);
    }
  }

  function fecharGuestFormPicker() {
    setGuestFormPicker(false);
    setGuestFormPhone("");
    setGuestFormUrl(null);
    setGuestFormError(null);
    setGuestFormCopied(false);
  }

  // Mesma ideia de gerarGuestFormLink, mas pro formulário de participantes
  // (nome, telefone, idade) de Day Use/Almoço/outros serviços cadastrados.
  async function gerarServicoFormLink() {
    const digits = servicoFormPhone.replace(/\D/g, "");
    if (!digits || !servicoFormTipo) return;
    setServicoFormGenerating(true);
    setServicoFormError(null);
    setServicoFormUrl(null);
    try {
      const res = await fetch("/api/whatsapp/inbox/servico-form-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: digits, clientId, tipoSlug: servicoFormTipo }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || !data.ok) {
        setServicoFormError(data?.error ?? "Erro ao gerar link — tente novamente.");
        return;
      }
      setServicoFormUrl(data.url);
    } catch {
      setServicoFormError("Erro ao gerar link. Verifique sua conexão.");
    } finally {
      setServicoFormGenerating(false);
    }
  }

  function fecharServicoFormPicker() {
    setServicoFormPicker(false);
    setServicoFormPhone("");
    setServicoFormTipo("");
    setServicoFormUrl(null);
    setServicoFormError(null);
    setServicoFormCopied(false);
  }

  if (loading) {
    return (
      <div>
        <PousadaSubNav clientId={clientId} role={role} />
        <div className="p-8 text-sm text-slate-400">Carregando...</div>
      </div>
    );
  }

  return (
    <div>
      <PousadaSubNav clientId={clientId} role={role} />
      <div className="p-6 md:p-10 space-y-10 max-w-5xl mx-auto">
      {/* Cabeçalho */}
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">🏡 Pousada</h1>
        <p className="text-sm text-slate-500">Reservas de hospedagem, day use, almoço e eventos em um só lugar.</p>
      </div>

      {/* Ações */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setModal("new")}
          className="rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-700"
        >
          + Nova reserva
        </button>
        <button
          onClick={() => setGuestFormPicker(true)}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          🔗 Link do formulário de hóspedes
        </button>
        <button
          onClick={() => setServicoFormPicker(true)}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          🔗 Link do formulário de serviços
        </button>
        {role === "manager" && (
          <button
            onClick={() => { setPixDraft({ chave: pixChave, favorecido: pixFavorecido }); setEditingPix(true); }}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50 ml-auto"
          >
            💳 Pix
          </button>
        )}
        <button
          onClick={() => { setTiposDraft(tipos.length ? [...tipos] : []); setEditingTipos(true); }}
          className={`rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50 ${role === "manager" ? "" : "ml-auto"}`}
        >
          ⚙️ Tipos de reserva
        </button>
      </div>

      {/* Filtro de período */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-1.5">
            {PERIODOS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPeriodo(p.value)}
                className={
                  periodo === p.value
                    ? "rounded-lg px-3 py-2 text-xs font-medium border transition bg-amber-600 border-amber-600 text-white"
                    : "rounded-lg px-3 py-2 text-xs font-medium border transition border-slate-200 text-slate-600 hover:bg-slate-50"
                }
              >
                {p.label}
              </button>
            ))}
          </div>
          {periodo === "personalizado" && (
            <div className="flex items-end gap-2">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">De</label>
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Até</label>
                <input type="date" value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400" />
              </div>
            </div>
          )}
        </div>
        <div className="pt-3 border-t border-slate-100">
          <label className="text-xs font-medium text-slate-600 block mb-1">Buscar por nome</label>
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Responsável ou participante..."
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400 w-full sm:w-72"
          />
        </div>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs uppercase tracking-wide text-slate-400">Reservas no período</p>
          <p className="text-3xl font-semibold text-slate-900 mt-1">{upcoming.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs uppercase tracking-wide text-slate-400">A receber</p>
          <p className="text-3xl font-semibold text-amber-600 mt-1">{fmt(aReceber)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs uppercase tracking-wide text-slate-400">Tipos de reserva ativos</p>
          <p className="text-3xl font-semibold text-slate-900 mt-1">{tipos.length}</p>
        </div>
      </div>

      {/* Editor de tipos */}
      {editingTipos && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 space-y-4">
          <div>
            <p className="text-sm font-semibold text-amber-900">Tipos de reserva</p>
            <p className="text-xs text-amber-800/70 mt-0.5">
              &quot;Hospedagem&quot; pede quarto/chalé, check-in/check-out e CPF de cada hóspede. &quot;Evento&quot; (Day Use, Almoço, etc.) pede nome, idade e cidade de cada participante.
            </p>
          </div>
          <div className="space-y-2">
            {tiposDraft.map((t, i) => (
              <div key={t.slug} className="flex items-center gap-2">
                <input
                  value={t.label}
                  onChange={(e) => setTiposDraft((prev) => prev.map((x, idx) => (idx === i ? { ...x, label: e.target.value } : x)))}
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400"
                />
                <select
                  value={t.categoria ?? "evento"}
                  onChange={(e) => setTiposDraft((prev) => prev.map((x, idx) => (idx === i ? { ...x, categoria: e.target.value as CategoriaTipo } : x)))}
                  className="rounded-lg border border-slate-200 px-2 py-2 text-xs outline-none focus:border-amber-400 bg-white"
                >
                  <option value="evento">Evento (day use, almoço...)</option>
                  <option value="hospedagem">Hospedagem (quarto/checkin)</option>
                </select>
                <button onClick={() => setTiposDraft((prev) => prev.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-red-500 text-xl leading-none px-2">×</button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              value={novoTipoLabel}
              onChange={(e) => setNovoTipoLabel(e.target.value)}
              placeholder="Novo tipo, ex: Dia das Mães"
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400"
            />
            <select
              value={novoTipoCategoria}
              onChange={(e) => setNovoTipoCategoria(e.target.value as CategoriaTipo)}
              className="rounded-lg border border-slate-200 px-2 py-2 text-xs outline-none focus:border-amber-400 bg-white"
            >
              <option value="evento">Evento</option>
              <option value="hospedagem">Hospedagem</option>
            </select>
            <button onClick={addTipoDraft} className="rounded-lg border border-amber-300 px-3 py-2 text-sm text-amber-800 hover:bg-amber-100 whitespace-nowrap">
              + Adicionar
            </button>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={saveTipos} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700">Salvar</button>
            <button onClick={() => setEditingTipos(false)} className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2">Cancelar</button>
          </div>
        </div>
      )}

      {/* Editor de Pix — usado na cobrança automática enviada logo após o cliente preencher o formulário de hóspedes */}
      {editingPix && role === "manager" && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 space-y-4">
          <div>
            <p className="text-sm font-semibold text-amber-900">Dados do Pix</p>
            <p className="text-xs text-amber-800/70 mt-0.5">
              Usados na mensagem de cobrança enviada automaticamente assim que o cliente preenche o formulário de hóspedes da hospedagem.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Chave Pix</label>
              <input
                value={pixDraft.chave}
                onChange={(e) => setPixDraft((p) => ({ ...p, chave: e.target.value }))}
                placeholder="Ex: CNPJ 63.529.514/0001-59"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Favorecido</label>
              <input
                value={pixDraft.favorecido}
                onChange={(e) => setPixDraft((p) => ({ ...p, favorecido: e.target.value }))}
                placeholder="Ex: Vitalli"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400"
              />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={salvarPix} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700">Salvar</button>
            <button onClick={() => setEditingPix(false)} className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2">Cancelar</button>
          </div>
        </div>
      )}

      {/* Resultado da busca por nome — substitui o grid por tipo enquanto ativa,
          pra achar uma reserva sem precisar saber em qual tipo/evento ela está. */}
      {buscaAtiva && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">
            Resultado da busca ({encontrados.length})
          </h2>
          {encontrados.length === 0 ? (
            <p className="text-sm text-slate-400">Nenhuma reserva encontrada com esse nome no período selecionado.</p>
          ) : (
            <div className="space-y-2">
              {encontrados.map((r) => {
                const tipoInfo = tipos.find((t) => t.slug === r.tipo);
                return (
                  <Link
                    key={r.id}
                    href={`${base}/servico/${r.tipo}`}
                    className="rounded-xl border border-slate-200 bg-white p-4 flex items-center justify-between gap-3 hover:border-amber-300 hover:bg-amber-50/40 transition"
                  >
                    <div>
                      <p className="font-medium text-slate-800">{r.responsavel.nome}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {tipoInfo?.label ?? r.tipo} · {formatDataComDiaSemana(r.data)}
                        {r.telefone ? ` · ${r.telefone}` : ""}
                      </p>
                    </div>
                    <span className="text-slate-300">→</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Uma seção por tipo de reserva — clique abre a página do serviço com tudo + filtro de datas */}
      {!buscaAtiva && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Por tipo de reserva</h2>
          {tipos.length === 0 && (
            <p className="text-sm text-slate-400">Nenhum tipo de reserva configurado ainda — clique em &quot;Tipos de reserva&quot; acima pra adicionar.</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {tipos.map((t) => {
              const lista = reservasDoTipo(t.slug);
              return (
                <Link
                  key={t.slug}
                  href={`${base}/servico/${t.slug}`}
                  className="rounded-2xl border border-slate-200 bg-white p-5 flex items-center justify-between hover:border-amber-300 hover:bg-amber-50/40 transition"
                >
                  <span className="font-medium text-slate-800 flex items-center gap-2">
                    {t.label}
                  </span>
                  <span className="flex items-center gap-2 text-sm text-slate-400">
                    {lista.length} no período
                    <span className="text-slate-300">→</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {modal && (
        <ReservaModal
          clientId={clientId}
          tipos={tipos}
          initial={modal === "new" ? null : modal}
          onSave={() => load()}
          onClose={() => setModal(null)}
        />
      )}

      {guestFormPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={fecharGuestFormPicker}>
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold text-slate-900">🔗 Link do formulário de hóspedes</h2>
              <button onClick={fecharGuestFormPicker} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Gera um link novo para o cliente preencher os dados de hospedagem — útil quando a IA está pausada e a reserva está sendo conduzida manualmente.
            </p>

            {!guestFormUrl ? (
              <>
                <label className="text-xs font-medium text-slate-600 block mb-1">Telefone do cliente (WhatsApp)</label>
                <input
                  value={guestFormPhone}
                  onChange={(e) => setGuestFormPhone(e.target.value)}
                  placeholder="Ex: 44998168355"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400 mb-3"
                />
                {guestFormError && <p className="text-xs text-red-600 mb-3">{guestFormError}</p>}
                <button
                  onClick={gerarGuestFormLink}
                  disabled={guestFormGenerating || !guestFormPhone.replace(/\D/g, "")}
                  className="w-full rounded-lg bg-amber-600 py-2.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {guestFormGenerating ? "Gerando..." : "Gerar link"}
                </button>
              </>
            ) : (
              <>
                <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-700 break-all mb-3">
                  {guestFormUrl}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(guestFormUrl);
                      setGuestFormCopied(true);
                      setTimeout(() => setGuestFormCopied(false), 2000);
                    }}
                    className="flex-1 rounded-lg bg-amber-600 py-2.5 text-sm font-semibold text-white hover:bg-amber-700"
                  >
                    {guestFormCopied ? "Copiado! ✓" : "Copiar link"}
                  </button>
                  <button onClick={fecharGuestFormPicker} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50">
                    Fechar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {servicoFormPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={fecharServicoFormPicker}>
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold text-slate-900">🔗 Link do formulário de serviços</h2>
              <button onClick={fecharServicoFormPicker} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Gera um link novo para o cliente preencher nome, telefone e idade de cada participante (Day Use, Almoço e demais serviços) — útil quando a IA está pausada e a reserva está sendo conduzida manualmente.
            </p>

            {!servicoFormUrl ? (
              <>
                <label className="text-xs font-medium text-slate-600 block mb-1">Serviço</label>
                <select
                  value={servicoFormTipo}
                  onChange={(e) => setServicoFormTipo(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400 bg-white mb-3"
                >
                  <option value="">Selecione o serviço...</option>
                  {tipos.filter((t) => (t.categoria ?? "evento") !== "hospedagem").map((t) => (
                    <option key={t.slug} value={t.slug}>{t.label}</option>
                  ))}
                </select>
                <label className="text-xs font-medium text-slate-600 block mb-1">Telefone do cliente (WhatsApp)</label>
                <input
                  value={servicoFormPhone}
                  onChange={(e) => setServicoFormPhone(e.target.value)}
                  placeholder="Ex: 44998168355"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400 mb-3"
                />
                {servicoFormError && <p className="text-xs text-red-600 mb-3">{servicoFormError}</p>}
                <button
                  onClick={gerarServicoFormLink}
                  disabled={servicoFormGenerating || !servicoFormPhone.replace(/\D/g, "") || !servicoFormTipo}
                  className="w-full rounded-lg bg-amber-600 py-2.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {servicoFormGenerating ? "Gerando..." : "Gerar link"}
                </button>
              </>
            ) : (
              <>
                <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-700 break-all mb-3">
                  {servicoFormUrl}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(servicoFormUrl);
                      setServicoFormCopied(true);
                      setTimeout(() => setServicoFormCopied(false), 2000);
                    }}
                    className="flex-1 rounded-lg bg-amber-600 py-2.5 text-sm font-semibold text-white hover:bg-amber-700"
                  >
                    {servicoFormCopied ? "Copiado! ✓" : "Copiar link"}
                  </button>
                  <button onClick={fecharServicoFormPicker} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50">
                    Fechar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
