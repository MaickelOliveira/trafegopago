"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import type { Reserva, PousadaTipo } from "@/lib/pousada-types";
import { formatDataComDiaSemana } from "@/lib/format-date";
import { PousadaSubNav } from "./PousadaSubNav";
import { ReservaModal } from "./ReservaModal";
import { ConsumoHospedePanel } from "./ConsumoHospedePanel";
import {
  faltaPagarPessoa,
  statusPagamentoPessoa,
  valorPagoPessoa,
  type StatusPagamentoPessoa,
} from "@/lib/pousada-payments";
import { totalConsumoHospede, totalConsumoPessoas } from "@/lib/pousada-consumo";

function fmt(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtData(iso?: string) {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR");
}

function normalizarBusca(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

const STATUS_BADGE: Record<Reserva["status"], string> = {
  pendente: "bg-yellow-100 text-yellow-700",
  parcial: "bg-blue-100 text-blue-700",
  pago: "bg-green-100 text-green-700",
  cancelada: "bg-red-100 text-red-600",
  cortesia: "bg-emerald-100 text-emerald-700",
};
const STATUS_LABEL: Record<Reserva["status"], string> = {
  pendente: "Pendente", parcial: "Parcial", pago: "Pago", cancelada: "Cancelada", cortesia: "Cortesia",
};

const PAGAMENTO_PESSOA_LABEL: Record<StatusPagamentoPessoa, string> = {
  pendente: "Pendente",
  parcial: "Parcial",
  pago: "Pago",
  cortesia: "Cortesia",
};

const PAGAMENTO_PESSOA_BADGE: Record<StatusPagamentoPessoa, string> = {
  pendente: "bg-yellow-100 text-yellow-700",
  parcial: "bg-blue-100 text-blue-700",
  pago: "bg-green-100 text-green-700",
  cortesia: "bg-emerald-100 text-emerald-700",
};

function Campo({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    // min-w-0 permite a coluna do grid encolher de verdade — sem isso, um
    // valor sem espaços (e-mail, endereço sem vírgula) força a célula a
    // manter a largura do conteúdo e o texto "vaza" por cima da célula
    // vizinha em vez de quebrar linha (aconteceu na prática: e-mail cobrindo
    // o início do endereço no hóspede do Eliézer).
    <div className="min-w-0">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-sm text-slate-800 break-words">{value}</p>
    </div>
  );
}

export function PousadaReservaDetailView({
  clientId,
  reservaId,
  role,
}: {
  clientId: string;
  reservaId: string;
  role: "manager" | "client";
}) {
  const router = useRouter();
  const [reserva, setReserva] = useState<Reserva | null>(null);
  const [clientName, setClientName] = useState<string | null>(null);
  const [tipos, setTipos] = useState<PousadaTipo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editando, setEditando] = useState(false);
  const [buscaPessoa, setBuscaPessoa] = useState("");
  const [salvandoPagamentoPessoa, setSalvandoPagamentoPessoa] = useState<number | null>(null);
  const [erroPagamentoPessoa, setErroPagamentoPessoa] = useState<{ index: number; mensagem: string } | null>(null);
  const [hospedeConsumoAberto, setHospedeConsumoAberto] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [reservaRes, tiposRes] = await Promise.all([
      fetch(`/api/pousada/reservas/${reservaId}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/pousada/tipos?clientId=${clientId}`).then((r) => r.json()),
    ]);
    setReserva(reservaRes);
    setClientName(reservaRes?.clientName ?? null);
    setTipos(Array.isArray(tiposRes) ? tiposRes : []);
    setLoading(false);
  }, [clientId, reservaId]);

  // Carrega a reserva ao abrir ou navegar para outro registro.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  // Título da aba/impressão — sem isso, o navegador imprime o título fixo da
  // plataforma ("Nexo — Dashboard de Campanhas") no cabeçalho da página
  // impressa em vez do nome do cliente, o que confundia quem recebia a ficha
  // impressa (ex: aparecia "Nexo" numa ficha de hóspedes da Vítallí Garden).
  useEffect(() => {
    if (!reserva) return;
    const prevTitle = document.title;
    document.title = clientName
      ? `${clientName} — Reserva de ${reserva.responsavel.nome}`
      : `Reserva de ${reserva.responsavel.nome}`;
    return () => { document.title = prevTitle; };
  }, [reserva, clientName]);

  const dashboardHref = role === "manager" ? `/gestor/${clientId}/pousada` : "/cliente/pousada";

  async function excluir() {
    if (!reserva || !confirm("Excluir esta reserva?\n\nOs dados continuam salvos (aparecem em relatórios) — ela só some das listas ativas. Você pode restaurar depois.")) return;
    await fetch(`/api/pousada/reservas/${reserva.id}`, { method: "DELETE" });
    router.push(dashboardHref);
  }

  async function restaurar() {
    if (!reserva) return;
    const res = await fetch(`/api/pousada/reservas/${reserva.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ arquivada: false }),
    });
    if (res.ok) setReserva(await res.json());
  }

  async function toggleCompareceu(index: number, compareceu: boolean) {
    if (!reserva) return;
    const pessoas = reserva.pessoas.map((p, i) => (i === index ? { ...p, compareceu } : p));
    setReserva({ ...reserva, pessoas }); // otimista
    const res = await fetch(`/api/pousada/reservas/${reserva.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pessoas }),
    });
    if (res.ok) setReserva(await res.json());
  }

  function parseValorInformado(informado: string): number {
    const limpo = informado.replace(/[^\d,.-]/g, "");
    return Number(limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo);
  }

  async function alterarPagamentoPessoa(index: number, status: StatusPagamentoPessoa) {
    if (!reserva || salvandoPagamentoPessoa !== null) return;
    const atual = reserva.pessoas[index];
    if (!atual || status === statusPagamentoPessoa(atual)) return;

    setErroPagamentoPessoa(null);
    if (status === "cortesia") {
      const confirmar = window.confirm(
        `Marcar ${atual.nome} como cortesia? O valor desta pessoa será zerado.`,
      );
      if (!confirmar) return;
    }
    let valor = atual.gratuito ? 0 : Number(atual.valor) || 0;

    if (status !== "cortesia" && valor <= 0) {
      const informado = window.prompt(`Informe o valor cobrado de ${atual.nome}:`, "");
      if (informado === null) return;
      valor = parseValorInformado(informado);
      if (!Number.isFinite(valor) || valor <= 0) {
        setErroPagamentoPessoa({ index, mensagem: "Informe um valor válido maior que zero." });
        return;
      }
    }

    let proximaPessoa = { ...atual, valor, gratuito: false };
    if (status === "pendente") {
      proximaPessoa.valorPago = 0;
    } else if (status === "pago") {
      proximaPessoa.valorPago = valor;
    } else if (status === "parcial") {
      const informado = window.prompt(
        `Informe quanto ${atual.nome} já pagou:`,
        valorPagoPessoa(atual) > 0
          ? valorPagoPessoa(atual).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : "",
      );
      if (informado === null) return;
      const valorPago = parseValorInformado(informado);
      if (!Number.isFinite(valorPago) || valorPago <= 0 || valorPago >= valor) {
        setErroPagamentoPessoa({ index, mensagem: "O pagamento parcial deve ser maior que zero e menor que o valor da pessoa." });
        return;
      }
      proximaPessoa.valorPago = valorPago;
    } else {
      proximaPessoa = { ...atual, valor: 0, valorPago: 0, gratuito: true };
    }

    const pessoas = reserva.pessoas.map((pessoa, pessoaIndex) => pessoaIndex === index ? proximaPessoa : pessoa);
    setSalvandoPagamentoPessoa(index);
    try {
      const res = await fetch(`/api/pousada/reservas/${reserva.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pessoas,
          status: reserva.status === "cortesia" && status !== "cortesia" ? "pendente" : reserva.status,
        }),
      });
      if (!res.ok) {
        setErroPagamentoPessoa({ index, mensagem: "Não foi possível atualizar. Tente novamente." });
        return;
      }
      setReserva(await res.json());
    } catch {
      setErroPagamentoPessoa({ index, mensagem: "Não foi possível atualizar. Verifique sua conexão." });
    } finally {
      setSalvandoPagamentoPessoa(null);
    }
  }

  async function salvarConsumoHospede(index: number, pessoaAtualizada: Reserva["pessoas"][number]) {
    if (!reserva) return null;
    const pessoas = reserva.pessoas.map((pessoa, pessoaIndex) => pessoaIndex === index ? pessoaAtualizada : pessoa);
    const res = await fetch(`/api/pousada/reservas/${reserva.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pessoas }),
    });
    if (!res.ok) return null;
    const atualizada = await res.json() as Reserva;
    setReserva(atualizada);
    return atualizada.pessoas[index] ?? null;
  }

  if (loading) {
    return (
      <div>
        <PousadaSubNav clientId={clientId} role={role} />
        <div className="p-8 text-sm text-slate-400">Carregando...</div>
      </div>
    );
  }

  if (!reserva) {
    return (
      <div>
        <PousadaSubNav clientId={clientId} role={role} />
        <div className="p-8 text-sm text-slate-400">Reserva não encontrada.</div>
      </div>
    );
  }

  const tipoInfo = tipos.find((t) => t.slug === reserva.tipo);
  const isHospedagem = (tipoInfo?.categoria ?? "evento") === "hospedagem";
  const totalConsumoReserva = isHospedagem ? totalConsumoPessoas(reserva.pessoas) : 0;
  const totalConferidos = isHospedagem ? reserva.pessoas.filter((pessoa) => pessoa.consumoConferido).length : 0;
  const termoPessoa = normalizarBusca(buscaPessoa);
  const indicesVisiveis = new Set(
    reserva.pessoas
      .map((pessoa, index) => ({
        index,
        texto: normalizarBusca([
          pessoa.nome,
          pessoa.telefone,
          pessoa.cidade,
          pessoa.cpf,
          pessoa.rg,
          pessoa.email,
        ].filter(Boolean).join(" ")),
      }))
      .filter(({ texto }) => !termoPessoa || texto.includes(termoPessoa))
      .map(({ index }) => index),
  );

  return (
    <div>
      <PousadaSubNav clientId={clientId} role={role} />
      <div className="p-6 md:p-10 space-y-8 max-w-3xl mx-auto">
        <div className="flex flex-col gap-1">
          <Link href={dashboardHref} className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1">
            ← Voltar ao dashboard
          </Link>
          <Link href={`${dashboardHref}/servico/${reserva.tipo}`} className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1">
            ← Voltar para {tipoInfo?.label ?? reserva.tipo}
          </Link>
        </div>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400 flex items-center gap-1.5">
              {tipoInfo?.label ?? reserva.tipo}
            </p>
            <h1 className="text-2xl font-semibold text-slate-900 mt-1">{reserva.responsavel.nome}</h1>
          </div>
          <div className="flex items-center gap-2">
            {reserva.arquivada && (
              <span className="rounded-full px-3 py-1 text-sm font-medium bg-slate-200 text-slate-600">
                Arquivada
              </span>
            )}
            <span className={clsx("rounded-full px-3 py-1 text-sm font-medium", STATUS_BADGE[reserva.status])}>
              {STATUS_LABEL[reserva.status]}
            </span>
            <button onClick={() => window.print()} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
              🖨️ Imprimir
            </button>
            <button onClick={() => setEditando(true)} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-amber-700 hover:bg-amber-50">
              Editar
            </button>
            {reserva.arquivada ? (
              role === "manager" && (
                <button onClick={restaurar} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-green-700 hover:bg-green-50">
                  Restaurar
                </button>
              )
            ) : (
              <button onClick={excluir} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-400 hover:text-red-500 hover:bg-red-50">
                Excluir
              </button>
            )}
          </div>
        </div>

        {/* .print-area — SOMENTE este bloco aparece ao imprimir (ver globals.css) */}
        <div className="print-area space-y-8">
          <div className="hidden print:block mb-2">
            <h1 className="text-lg font-semibold text-slate-900">
              {isHospedagem ? "Ficha de Hóspedes" : "Ficha de Participantes"} — {tipoInfo?.label ?? reserva.tipo}
            </h1>
            <p className="text-sm text-slate-600">Responsável: {reserva.responsavel.nome}</p>
          </div>

          {/* Dados da reserva */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-sm font-semibold text-slate-700 mb-4">Dados da reserva</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {isHospedagem ? (
                <>
                  <Campo label="Check-in" value={formatDataComDiaSemana(reserva.data)} />
                  <Campo label="Check-out" value={formatDataComDiaSemana(reserva.dataCheckout)} />
                  <Campo label="Quarto/Chalé" value={reserva.quarto} />
                </>
              ) : (
                <>
                  <Campo label="Data" value={formatDataComDiaSemana(reserva.data)} />
                  <Campo label="Hora" value={reserva.hora} />
                  <Campo label="Cidade" value={reserva.cidade} />
                </>
              )}
              <Campo label="Telefone" value={reserva.telefone} />
              {isHospedagem && <Campo label="CPF do responsável" value={reserva.responsavel.cpf} />}
              <Campo label="Quantidade de pessoas" value={reserva.pessoas.length} />
              <Campo label={isHospedagem ? "Valor total geral" : "Valor total"} value={fmt(reserva.valorTotal)} />
              <Campo label={isHospedagem ? "Valor pago da hospedagem" : "Valor pago"} value={fmt(reserva.valorPago)} />
              <Campo label={isHospedagem ? "Falta pagar da hospedagem" : "Falta pagar"} value={fmt(reserva.faltaPagar)} />
              {isHospedagem && <Campo label="Consumo apurado" value={fmt(totalConsumoReserva)} />}
              {isHospedagem && <Campo label="Consumos conferidos" value={`${totalConferidos} de ${reserva.pessoas.length}`} />}
            </div>
            {reserva.observacoes && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <p className="text-xs text-slate-400">Observações</p>
                <p className="text-sm text-slate-700 mt-0.5">{reserva.observacoes}</p>
              </div>
            )}
          </div>

          {/* Todas as pessoas */}
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-5 pt-5 pb-3">
              <p className="text-sm font-semibold text-slate-700">
                {isHospedagem ? "Hóspedes" : "Participantes"} ({reserva.pessoas.length})
              </p>
              <div className="mt-3 print:hidden">
                <label htmlFor="busca-pessoa" className="mb-1 block text-xs font-medium text-slate-500">
                  Pesquisar pessoa na reserva
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">🔎</span>
                  <input
                    id="busca-pessoa"
                    type="search"
                    value={buscaPessoa}
                    onChange={(e) => setBuscaPessoa(e.target.value)}
                    placeholder="Nome, telefone, cidade, CPF ou e-mail..."
                    className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-amber-400"
                  />
                </div>
                {termoPessoa && (
                  <p className="mt-1.5 text-xs text-slate-400">
                    {indicesVisiveis.size} de {reserva.pessoas.length} pessoa{reserva.pessoas.length === 1 ? "" : "s"}
                  </p>
                )}
              </div>
            </div>
            {termoPessoa && indicesVisiveis.size === 0 && (
              <p className="border-t border-slate-100 px-5 py-8 text-center text-sm text-slate-400 print:hidden">
                Nenhuma pessoa encontrada nesta reserva.
              </p>
            )}
            <div className="divide-y divide-slate-50">
              {reserva.pessoas.map((p, i) => {
                const consumoAberto = isHospedagem && hospedeConsumoAberto === i;
                const quantidadeItens = p.itensConsumo?.length ?? 0;
                const totalConsumido = totalConsumoHospede(p);
                return (
                  <div key={i} className={clsx("px-5 py-4", !indicesVisiveis.has(i) && "hidden print:block")}>
                    <div className="flex items-start justify-between gap-3">
                      {isHospedagem ? (
                        <button
                          type="button"
                          onClick={() => setHospedeConsumoAberto((atual) => atual === i ? null : i)}
                          className="min-w-0 flex-1 text-left print:pointer-events-none"
                          aria-expanded={consumoAberto}
                        >
                          <span className="block text-sm font-medium text-slate-800">
                            {p.nome}
                          </span>
                          <span className="mt-1 block text-xs text-teal-700 print:hidden">
                            🧾 {quantidadeItens} item{quantidadeItens === 1 ? "" : "s"} · {fmt(totalConsumido)} consumido · {consumoAberto ? "Fechar" : "Abrir controle"} {consumoAberto ? "▲" : "▼"}
                          </span>
                        </button>
                      ) : (
                        <p className="text-sm font-medium text-slate-800">
                          {p.nome} {p.gratuito && <span className="text-xs font-normal text-green-600">(gratuito)</span>}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center justify-end gap-2 print:hidden">
                        {!isHospedagem && (
                          <>
                            <label className="sr-only" htmlFor={`pagamento-pessoa-${i}`}>Pagamento de {p.nome}</label>
                            <select
                              id={`pagamento-pessoa-${i}`}
                              value={statusPagamentoPessoa(p)}
                              disabled={salvandoPagamentoPessoa !== null || reserva.arquivada}
                              onChange={(e) => void alterarPagamentoPessoa(i, e.target.value as StatusPagamentoPessoa)}
                              className={clsx(
                                "cursor-pointer rounded-full border-0 px-2.5 py-1 text-xs font-medium outline-none ring-1 ring-inset ring-black/5 disabled:cursor-wait disabled:opacity-60",
                                PAGAMENTO_PESSOA_BADGE[statusPagamentoPessoa(p)],
                              )}
                              title={`Alterar pagamento de ${p.nome}`}
                            >
                              {(Object.keys(PAGAMENTO_PESSOA_LABEL) as StatusPagamentoPessoa[]).map((status) => (
                                <option key={status} value={status}>{PAGAMENTO_PESSOA_LABEL[status]}</option>
                              ))}
                            </select>
                          </>
                        )}
                        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-500">
                          <input
                            type="checkbox"
                            checked={!!p.compareceu}
                            onChange={(e) => toggleCompareceu(i, e.target.checked)}
                            className="rounded border-slate-300 text-amber-600 focus:ring-amber-400"
                          />
                          Compareceu
                        </label>
                      </div>
                    </div>
                    {!isHospedagem && erroPagamentoPessoa?.index === i && (
                      <p className="mt-2 text-xs text-red-600 print:hidden">{erroPagamentoPessoa.mensagem}</p>
                    )}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
                      <Campo label="Idade" value={p.idade} />
                      <Campo label="CPF" value={p.cpf} />
                      <Campo label="RG" value={p.rg} />
                      <Campo label="Nascimento" value={fmtData(p.nascimento)} />
                      <Campo label="Profissão" value={p.profissao} />
                      <Campo label="Cidade" value={p.cidade} />
                      <Campo label="Telefone" value={p.telefone} />
                      <Campo label="E-mail" value={p.email} />
                      <Campo label="Endereço" value={p.endereco} />
                      {!isHospedagem && <Campo label="Valor" value={fmt(p.valor)} />}
                      {!isHospedagem && <Campo label="Valor pago" value={fmt(valorPagoPessoa(p))} />}
                      {!isHospedagem && <Campo label="Falta pagar" value={fmt(faltaPagarPessoa(p))} />}
                    </div>
                    {consumoAberto && (
                      <ConsumoHospedePanel
                        pessoa={p}
                        disabled={!!reserva.arquivada}
                        onSave={(pessoaAtualizada) => salvarConsumoHospede(i, pessoaAtualizada)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {editando && (
        <ReservaModal
          clientId={clientId}
          tipos={tipos}
          initial={reserva}
          onSave={(r) => { setReserva(r); setEditando(false); }}
          onClose={() => setEditando(false)}
        />
      )}
    </div>
  );
}
