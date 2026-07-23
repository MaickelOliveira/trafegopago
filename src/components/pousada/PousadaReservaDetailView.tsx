"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import type { Reserva, PousadaTipo } from "@/lib/pousada-types";
import { PousadaSubNav } from "./PousadaSubNav";
import { ReservaModal } from "./ReservaModal";

function fmt(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtData(iso?: string) {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR");
}

const STATUS_BADGE: Record<string, string> = {
  pendente: "bg-yellow-100 text-yellow-700",
  parcial: "bg-blue-100 text-blue-700",
  pago: "bg-green-100 text-green-700",
  cancelada: "bg-red-100 text-red-600",
};
const STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente", parcial: "Parcial", pago: "Pago", cancelada: "Cancelada",
};

function Campo({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div>
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-sm text-slate-800">{value}</p>
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
  const [tipos, setTipos] = useState<PousadaTipo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editando, setEditando] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [reservaRes, tiposRes] = await Promise.all([
      fetch(`/api/pousada/reservas/${reservaId}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/pousada/tipos?clientId=${clientId}`).then((r) => r.json()),
    ]);
    setReserva(reservaRes);
    setTipos(Array.isArray(tiposRes) ? tiposRes : []);
    setLoading(false);
  }, [clientId, reservaId]);

  useEffect(() => { load(); }, [load]);

  const dashboardHref = role === "manager" ? `/gestor/${clientId}/pousada` : "/cliente/pousada";

  async function excluir() {
    if (!reserva || !confirm("Excluir esta reserva?")) return;
    await fetch(`/api/pousada/reservas/${reserva.id}`, { method: "DELETE" });
    router.push(dashboardHref);
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

  return (
    <div>
      <PousadaSubNav clientId={clientId} role={role} />
      <div className="p-6 md:p-10 space-y-8 max-w-3xl mx-auto">
        <Link href={dashboardHref} className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1">
          ← Voltar ao dashboard
        </Link>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400 flex items-center gap-1.5">
              {isHospedagem ? "🛏️" : "🎉"} {tipoInfo?.label ?? reserva.tipo}
            </p>
            <h1 className="text-2xl font-semibold text-slate-900 mt-1">{reserva.responsavel.nome}</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className={clsx("rounded-full px-3 py-1 text-sm font-medium", STATUS_BADGE[reserva.status])}>
              {STATUS_LABEL[reserva.status]}
            </span>
            <button onClick={() => setEditando(true)} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-amber-700 hover:bg-amber-50">
              Editar
            </button>
            {role === "manager" && (
              <button onClick={excluir} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-400 hover:text-red-500 hover:bg-red-50">
                Excluir
              </button>
            )}
          </div>
        </div>

        {/* Dados da reserva */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-sm font-semibold text-slate-700 mb-4">Dados da reserva</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {isHospedagem ? (
              <>
                <Campo label="Check-in" value={fmtData(reserva.data)} />
                <Campo label="Check-out" value={fmtData(reserva.dataCheckout)} />
                <Campo label="Quarto/Chalé" value={reserva.quarto} />
              </>
            ) : (
              <>
                <Campo label="Data" value={fmtData(reserva.data)} />
                <Campo label="Hora" value={reserva.hora} />
                <Campo label="Cidade" value={reserva.cidade} />
              </>
            )}
            <Campo label="Telefone" value={reserva.telefone} />
            {isHospedagem && <Campo label="CPF do responsável" value={reserva.responsavel.cpf} />}
            <Campo label="Quantidade de pessoas" value={reserva.pessoas.length} />
            <Campo label="Valor total" value={fmt(reserva.valorTotal)} />
            <Campo label="Valor pago" value={fmt(reserva.valorPago)} />
            <Campo label="Falta pagar" value={fmt(reserva.faltaPagar)} />
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
          <p className="text-sm font-semibold text-slate-700 px-5 pt-5 pb-3">
            {isHospedagem ? "Hóspedes" : "Participantes"} ({reserva.pessoas.length})
          </p>
          <div className="divide-y divide-slate-50">
            {reserva.pessoas.map((p, i) => (
              <div key={i} className="px-5 py-4">
                <p className="text-sm font-medium text-slate-800">
                  {p.nome} {p.gratuito && <span className="text-xs font-normal text-green-600">(gratuito)</span>}
                </p>
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
                  <Campo label="Valor" value={fmt(p.valor)} />
                </div>
              </div>
            ))}
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
