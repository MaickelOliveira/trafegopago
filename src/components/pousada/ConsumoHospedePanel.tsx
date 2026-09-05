"use client";

import { useState } from "react";
import type { ItemConsumoHospede, LocalItemConsumo, Pessoa } from "@/lib/pousada-types";
import {
  normalizarItensConsumo,
  quantidadesConsumo,
  totalConsumoHospede,
} from "@/lib/pousada-consumo";

const SUGESTOES: Array<{ nome: string; local: LocalItemConsumo }> = [
  { nome: "Coca lata", local: "frigobar" },
  { nome: "Coca lata zero", local: "frigobar" },
  { nome: "Água sem gás", local: "frigobar" },
  { nome: "Água com gás", local: "frigobar" },
  { nome: "Guaraná lata", local: "frigobar" },
  { nome: "Suco Prats 300 ml", local: "frigobar" },
  { nome: "Heineken", local: "frigobar" },
  { nome: "Original", local: "frigobar" },
  { nome: "Chocolate", local: "frigobar" },
  { nome: "Café", local: "quarto" },
];

function fmt(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function novoId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `consumo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function fmtConferencia(iso?: string): string | null {
  if (!iso) return null;
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return null;
  return data.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function ConsumoHospedePanel({
  pessoa,
  disabled = false,
  onSave,
}: {
  pessoa: Pessoa;
  disabled?: boolean;
  onSave: (pessoa: Pessoa) => Promise<Pessoa | null>;
}) {
  const [itens, setItens] = useState<ItemConsumoHospede[]>(() => normalizarItensConsumo(pessoa.itensConsumo));
  const [conferido, setConferido] = useState(!!pessoa.consumoConferido);
  const [conferidoEm, setConferidoEm] = useState(pessoa.consumoConferidoEm);
  const [alterado, setAlterado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function marcarAlterado(next: ItemConsumoHospede[]) {
    setItens(next);
    setAlterado(true);
    setErro(null);
  }

  function adicionarItem(nome = "", local: LocalItemConsumo = "frigobar") {
    if (nome) {
      const existente = itens.findIndex((item) => item.nome.toLowerCase() === nome.toLowerCase() && item.local === local);
      if (existente >= 0) {
        marcarAlterado(itens.map((item, index) => index === existente
          ? { ...item, quantidadeColocada: item.quantidadeColocada + 1 }
          : item));
        return;
      }
    }
    marcarAlterado([
      ...itens,
      {
        id: novoId(),
        nome,
        local,
        quantidadeColocada: 1,
        quantidadeConsumida: 0,
        valorUnitario: 0,
      },
    ]);
  }

  function atualizarItem(id: string, patch: Partial<ItemConsumoHospede>) {
    marcarAlterado(itens.map((item) => {
      if (item.id !== id) return item;
      const next = { ...item, ...patch };
      next.quantidadeColocada = Math.max(Math.floor(Number(next.quantidadeColocada) || 0), 0);
      next.quantidadeConsumida = Math.min(
        Math.max(Math.floor(Number(next.quantidadeConsumida) || 0), 0),
        next.quantidadeColocada,
      );
      next.valorUnitario = Math.max(Number(next.valorUnitario) || 0, 0);
      return next;
    }));
  }

  function removerItem(id: string) {
    marcarAlterado(itens.filter((item) => item.id !== id));
  }

  async function salvar(finalizarConferencia: boolean) {
    const itensNormalizados = normalizarItensConsumo(itens);
    if (itens.some((item) => !item.nome.trim())) {
      setErro("Preencha o nome dos itens ou remova as linhas vazias antes de salvar.");
      return;
    }

    setSalvando(true);
    setErro(null);
    const agora = finalizarConferencia ? new Date().toISOString() : undefined;
    try {
      const atualizada = await onSave({
        ...pessoa,
        itensConsumo: itensNormalizados,
        consumoConferido: finalizarConferencia,
        consumoConferidoEm: agora,
      });
      if (!atualizada) {
        setErro("Não foi possível salvar o consumo. Tente novamente.");
        return;
      }
      setItens(normalizarItensConsumo(atualizada.itensConsumo));
      setConferido(!!atualizada.consumoConferido);
      setConferidoEm(atualizada.consumoConferidoEm);
      setAlterado(false);
    } catch {
      setErro("Não foi possível salvar o consumo. Verifique sua conexão.");
    } finally {
      setSalvando(false);
    }
  }

  const pessoaComDraft = { ...pessoa, itensConsumo: itens };
  const quantidades = quantidadesConsumo(pessoaComDraft);
  const total = totalConsumoHospede(pessoaComDraft);
  const bloqueado = disabled || salvando || conferido;

  return (
    <div className="mt-4 rounded-xl border border-teal-200 bg-teal-50/50 p-4 print:hidden">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-teal-900">🧾 Consumo do quarto e frigobar</p>
          <p className="mt-0.5 text-xs text-teal-800/70">
            Registre o que foi colocado e, na saída, informe quanto foi consumido.
          </p>
        </div>
        {conferido && (
          <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700">
            ✓ Conferido{fmtConferencia(conferidoEm) ? ` em ${fmtConferencia(conferidoEm)}` : ""}
          </span>
        )}
      </div>

      {!conferido && !disabled && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {SUGESTOES.map((sugestao) => (
            <button
              key={`${sugestao.local}-${sugestao.nome}`}
              type="button"
              onClick={() => adicionarItem(sugestao.nome, sugestao.local)}
              className="rounded-full border border-teal-200 bg-white px-2.5 py-1 text-xs text-teal-700 hover:bg-teal-100"
            >
              + {sugestao.nome}
            </button>
          ))}
          <button
            type="button"
            onClick={() => adicionarItem()}
            className="rounded-full border border-dashed border-teal-300 px-2.5 py-1 text-xs font-medium text-teal-700 hover:bg-teal-100"
          >
            + Outro item
          </button>
        </div>
      )}

      {itens.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-teal-200 bg-white/70 px-4 py-6 text-center text-sm text-slate-500">
          Nenhum item registrado para este hóspede.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {itens.map((item) => (
            <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-12">
                <div className="lg:col-span-4">
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-400">Item</label>
                  <input
                    value={item.nome}
                    disabled={bloqueado}
                    onChange={(e) => atualizarItem(item.id, { nome: e.target.value })}
                    placeholder="Ex: Água mineral"
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm outline-none focus:border-teal-400 disabled:bg-slate-50"
                  />
                </div>
                <div className="lg:col-span-2">
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-400">Local</label>
                  <select
                    value={item.local}
                    disabled={bloqueado}
                    onChange={(e) => atualizarItem(item.id, { local: e.target.value as LocalItemConsumo })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm outline-none focus:border-teal-400 disabled:bg-slate-50"
                  >
                    <option value="frigobar">Frigobar</option>
                    <option value="quarto">Quarto</option>
                  </select>
                </div>
                <div className="lg:col-span-2">
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-400">Qtd. colocada</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={item.quantidadeColocada}
                    disabled={bloqueado}
                    onChange={(e) => atualizarItem(item.id, { quantidadeColocada: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm outline-none focus:border-teal-400 disabled:bg-slate-50"
                  />
                </div>
                <div className="lg:col-span-2">
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-400">Valor unitário</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.valorUnitario}
                    disabled={bloqueado}
                    onChange={(e) => atualizarItem(item.id, { valorUnitario: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm outline-none focus:border-teal-400 disabled:bg-slate-50"
                  />
                </div>
                <div className="flex items-end justify-end lg:col-span-2">
                  <button
                    type="button"
                    disabled={bloqueado}
                    onClick={() => removerItem(item.id)}
                    className="rounded-lg px-2.5 py-2 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                  >
                    Remover
                  </button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                <div>
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">Qtd. consumida</p>
                  <div className="flex items-center overflow-hidden rounded-lg border border-slate-200 bg-white">
                    <button
                      type="button"
                      disabled={bloqueado || item.quantidadeConsumida <= 0}
                      onClick={() => atualizarItem(item.id, { quantidadeConsumida: item.quantidadeConsumida - 1 })}
                      className="px-3 py-1.5 text-base text-slate-600 hover:bg-slate-50 disabled:opacity-30"
                      aria-label={`Diminuir consumo de ${item.nome}`}
                    >
                      −
                    </button>
                    <span className="min-w-10 border-x border-slate-200 px-3 py-1.5 text-center text-sm font-semibold text-slate-800">
                      {item.quantidadeConsumida}
                    </span>
                    <button
                      type="button"
                      disabled={bloqueado || item.quantidadeConsumida >= item.quantidadeColocada}
                      onClick={() => atualizarItem(item.id, { quantidadeConsumida: item.quantidadeConsumida + 1 })}
                      className="px-3 py-1.5 text-base text-slate-600 hover:bg-slate-50 disabled:opacity-30"
                      aria-label={`Aumentar consumo de ${item.nome}`}
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Total do item</p>
                  <p className="text-base font-semibold text-teal-800">{fmt(item.quantidadeConsumida * item.valorUnitario)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200">
        <div className="text-xs text-slate-500">
          <span className="font-medium text-slate-700">{quantidades.consumida}</span> de {quantidades.colocada} unidade{quantidades.colocada === 1 ? "" : "s"} consumida{quantidades.colocada === 1 ? "" : "s"}
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Total consumido</p>
          <p className="text-lg font-semibold text-teal-800">{fmt(total)}</p>
        </div>
      </div>

      {erro && <p className="mt-3 text-xs text-red-600">{erro}</p>}

      {!disabled && (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {conferido ? (
            <button
              type="button"
              disabled={salvando}
              onClick={() => void salvar(false)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {salvando ? "Salvando..." : "Reabrir conferência"}
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={salvando || !alterado}
                onClick={() => void salvar(false)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {salvando ? "Salvando..." : "Salvar lista"}
              </button>
              <button
                type="button"
                disabled={salvando || itens.length === 0}
                onClick={() => void salvar(true)}
                className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
              >
                {salvando ? "Salvando..." : "✓ Finalizar conferência"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
