"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import {
  BedDouble,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  Clock3,
  List,
  LoaderCircle,
  Plus,
  Sparkles,
  UserRound,
} from "lucide-react";
import type { EventoAgendaPousada, PousadaTipo, Reserva } from "@/lib/pousada-types";
import { formatDataComDiaSemana, todayBR } from "@/lib/format-date";
import {
  calendarDays,
  COR_EVENTO_GERAL,
  CORES_AGENDA,
  dateFromISO,
  intervalOverlapsMonth,
  monthBounds,
  type CorAgenda,
} from "@/lib/pousada-calendar";
import { AgendaEventoModal } from "./AgendaEventoModal";
import { PousadaSubNav } from "./PousadaSubNav";
import { ReservaModal } from "./ReservaModal";

const WEEKDAYS = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];

type CalendarEntry = {
  key: string;
  kind: "programacao" | "reserva";
  tipo: string;
  tipoLabel: string;
  title: string;
  detail?: string;
  time?: string;
  color: CorAgenda;
  evento?: EventoAgendaPousada;
  reserva?: Reserva;
};

function formatMonth(month: Date): string {
  const value = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(month);
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatRange(reserva: Reserva): string {
  if (!reserva.dataCheckout || reserva.dataCheckout === reserva.data) {
    return formatDataComDiaSemana(reserva.data);
  }
  const start = dateFromISO(reserva.data).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const end = dateFromISO(reserva.dataCheckout).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${start} até ${end}`;
}

function addMonths(month: Date, amount: number): Date {
  return new Date(month.getFullYear(), month.getMonth() + amount, 1, 12);
}

export function PousadaAgendaView({ clientId, role }: { clientId: string; role: "manager" | "client" }) {
  const today = todayBR();
  const [month, setMonth] = useState(() => {
    const date = dateFromISO(today);
    return new Date(date.getFullYear(), date.getMonth(), 1, 12);
  });
  const [mode, setMode] = useState<"month" | "list">("month");
  const [selectedDay, setSelectedDay] = useState(today);
  const [tipos, setTipos] = useState<PousadaTipo[]>([]);
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [eventos, setEventos] = useState<EventoAgendaPousada[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventoModal, setEventoModal] = useState<{ evento?: EventoAgendaPousada; date: string } | null>(null);
  const [reservaModal, setReservaModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tiposPayload, reservasPayload, eventosPayload] = await Promise.all([
        fetch(`/api/pousada/tipos?clientId=${encodeURIComponent(clientId)}`).then((response) => response.json()),
        fetch(`/api/pousada/reservas?clientId=${encodeURIComponent(clientId)}`).then((response) => response.json()),
        fetch(`/api/pousada/agenda?clientId=${encodeURIComponent(clientId)}`).then((response) => response.json()),
      ]);
      setTipos(Array.isArray(tiposPayload) ? tiposPayload : []);
      setReservas(Array.isArray(reservasPayload.reservas) ? reservasPayload.reservas : []);
      setEventos(Array.isArray(eventosPayload.eventos) ? eventosPayload.eventos : []);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const typeMap = useMemo(() => new Map(tipos.map((tipo) => [tipo.slug, tipo])), [tipos]);
  const colorMap = useMemo(
    () => new Map(tipos.map((tipo, index) => [tipo.slug, CORES_AGENDA[index % CORES_AGENDA.length]])),
    [tipos],
  );
  const gridDays = useMemo(() => calendarDays(month), [month]);
  const bounds = useMemo(() => monthBounds(month), [month]);
  const base = role === "manager" ? `/gestor/${clientId}/pousada` : "/cliente/pousada";

  const getColor = useCallback(
    (tipo: string) => colorMap.get(tipo) ?? COR_EVENTO_GERAL,
    [colorMap],
  );

  const entriesForDay = useCallback((iso: string): CalendarEntry[] => {
    const programacao: CalendarEntry[] = eventos
      .filter((evento) => evento.data === iso)
      .map((evento) => ({
        key: `evento-${evento.id}`,
        kind: "programacao" as const,
        tipo: evento.tipo,
        tipoLabel: typeMap.get(evento.tipo)?.label ?? "Evento geral",
        title: evento.titulo,
        detail: evento.observacoes,
        time: evento.hora,
        color: getColor(evento.tipo),
        evento,
      }));

    const reservasDoDia: CalendarEntry[] = reservas
      .filter((reserva) => reserva.status !== "cancelada")
      .filter((reserva) => {
        const hospedagem = typeMap.get(reserva.tipo)?.categoria === "hospedagem"
          || Boolean(reserva.dataCheckout || reserva.quarto);
        return hospedagem
          ? reserva.data <= iso && (reserva.dataCheckout ?? reserva.data) >= iso
          : reserva.data === iso;
      })
      .map((reserva) => {
        const tipoInfo = typeMap.get(reserva.tipo);
        const hospedagem = tipoInfo?.categoria === "hospedagem"
          || Boolean(reserva.dataCheckout || reserva.quarto);
        let prefix = tipoInfo?.label ?? reserva.tipo;
        if (hospedagem && iso === reserva.data) prefix = "Entrada";
        else if (hospedagem && iso === reserva.dataCheckout) prefix = "Saída";
        else if (hospedagem && reserva.quarto) prefix = `Quarto ${reserva.quarto}`;

        return {
          key: `reserva-${reserva.id}`,
          kind: "reserva" as const,
          tipo: reserva.tipo,
          tipoLabel: tipoInfo?.label ?? reserva.tipo,
          title: `${prefix} · ${reserva.responsavel.nome}`,
          detail: hospedagem ? formatRange(reserva) : `${reserva.pessoas.length} pessoa(s)`,
          time: reserva.hora,
          color: getColor(reserva.tipo),
          reserva,
        };
      });

    return [...programacao, ...reservasDoDia].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "programacao" ? -1 : 1;
      return (a.time ?? "99:99").localeCompare(b.time ?? "99:99");
    });
  }, [eventos, getColor, reservas, typeMap]);

  const selectedEntries = useMemo(() => entriesForDay(selectedDay), [entriesForDay, selectedDay]);
  const monthReservations = useMemo(
    () => reservas.filter((reserva) => (
      reserva.status !== "cancelada" && intervalOverlapsMonth(reserva.data, reserva.dataCheckout, month)
    )),
    [month, reservas],
  );
  const monthEvents = useMemo(
    () => eventos.filter((evento) => evento.data >= bounds.start && evento.data <= bounds.end),
    [bounds, eventos],
  );

  const listRows = useMemo(() => {
    const rows: Array<CalendarEntry & { date: string }> = [
      ...monthEvents.map((evento): CalendarEntry & { date: string } => ({
        key: `evento-${evento.id}`,
        date: evento.data,
        kind: "programacao",
        tipo: evento.tipo,
        tipoLabel: typeMap.get(evento.tipo)?.label ?? "Evento geral",
        title: evento.titulo,
        detail: evento.observacoes,
        time: evento.hora,
        color: getColor(evento.tipo),
        evento,
      })),
      ...monthReservations.map((reserva): CalendarEntry & { date: string } => ({
        key: `reserva-${reserva.id}`,
        date: reserva.data < bounds.start ? bounds.start : reserva.data,
        kind: "reserva",
        tipo: reserva.tipo,
        tipoLabel: typeMap.get(reserva.tipo)?.label ?? reserva.tipo,
        title: reserva.responsavel.nome,
        detail: typeMap.get(reserva.tipo)?.categoria === "hospedagem" || reserva.dataCheckout
          ? `${formatRange(reserva)}${reserva.quarto ? ` · Quarto ${reserva.quarto}` : ""}`
          : `${reserva.pessoas.length} pessoa(s)`,
        time: reserva.hora,
        color: getColor(reserva.tipo),
        reserva,
      })),
    ];
    return rows.sort((a, b) => `${a.date} ${a.time ?? ""}`.localeCompare(`${b.date} ${b.time ?? ""}`));
  }, [bounds.start, getColor, monthEvents, monthReservations, typeMap]);

  function goToday() {
    const date = dateFromISO(today);
    setMonth(new Date(date.getFullYear(), date.getMonth(), 1, 12));
    setSelectedDay(today);
  }

  function openNewEvent(date = selectedDay) {
    setSelectedDay(date);
    setEventoModal({ date });
  }

  return (
    <div className="min-h-full bg-slate-50">
      <PousadaSubNav clientId={clientId} role={role} />
      <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 md:p-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <CalendarDays size={22} className="text-amber-600" />
              <h1 className="text-xl font-semibold text-slate-900">Agenda da pousada</h1>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {monthEvents.length + monthReservations.length} compromissos em {formatMonth(month).toLowerCase()}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-slate-200 bg-white p-1">
              <button
                type="button"
                onClick={() => setMode("month")}
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium",
                  mode === "month" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100",
                )}
              >
                <CalendarDays size={15} /> Mês
              </button>
              <button
                type="button"
                onClick={() => setMode("list")}
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium",
                  mode === "list" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100",
                )}
              >
                <List size={15} /> Lista
              </button>
            </div>
            <button
              type="button"
              onClick={() => setReservaModal(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              <UserRound size={16} /> Nova reserva
            </button>
            <button
              type="button"
              onClick={() => openNewEvent()}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700"
            >
              <Plus size={17} /> Novo evento
            </button>
          </div>
        </header>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 sm:px-5">
            <button
              type="button"
              onClick={() => setMonth((current) => addMonths(current, -1))}
              aria-label="Mês anterior"
              title="Mês anterior"
              className="grid h-9 w-9 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            >
              <ChevronLeft size={19} />
            </button>
            <h2 className="min-w-44 text-base font-semibold text-slate-900">{formatMonth(month)}</h2>
            <button
              type="button"
              onClick={() => setMonth((current) => addMonths(current, 1))}
              aria-label="Próximo mês"
              title="Próximo mês"
              className="grid h-9 w-9 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            >
              <ChevronRight size={19} />
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={goToday}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Hoje
            </button>
          </div>

          {loading ? (
            <div className="grid min-h-96 place-items-center text-slate-400">
              <span className="inline-flex items-center gap-2 text-sm"><LoaderCircle size={18} className="animate-spin" /> Carregando agenda...</span>
            </div>
          ) : mode === "month" ? (
            <>
              <div className="overflow-x-auto">
                <div className="min-w-[880px]">
                  <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
                    {WEEKDAYS.map((day) => (
                      <div key={day} className="px-3 py-2 text-center text-[11px] font-semibold text-slate-500">{day}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7">
                    {gridDays.map((iso) => {
                      const entries = entriesForDay(iso);
                      const date = dateFromISO(iso);
                      const outside = date.getMonth() !== month.getMonth();
                      const selected = iso === selectedDay;
                      const isToday = iso === today;
                      return (
                        <div
                          key={iso}
                          className={clsx(
                            "group min-h-32 border-b border-r border-slate-200 p-2 last:border-r-0",
                            outside ? "bg-slate-50/70" : "bg-white",
                            selected && "bg-amber-50/50",
                          )}
                        >
                          <div className="mb-1.5 flex items-center justify-between">
                            <button
                              type="button"
                              onClick={() => setSelectedDay(iso)}
                              aria-label={`Selecionar ${formatDataComDiaSemana(iso)}`}
                              className={clsx(
                                "grid h-7 min-w-7 place-items-center rounded-full px-1 text-xs font-semibold",
                                isToday
                                  ? "bg-amber-600 text-white"
                                  : outside
                                    ? "text-slate-400 hover:bg-slate-200"
                                    : "text-slate-700 hover:bg-slate-100",
                              )}
                            >
                              {date.getDate()}
                            </button>
                            {!outside && (
                              <button
                                type="button"
                                onClick={() => openNewEvent(iso)}
                                aria-label={`Adicionar evento em ${formatDataComDiaSemana(iso)}`}
                                title="Adicionar evento"
                                className="grid h-7 w-7 place-items-center rounded-md text-slate-300 opacity-0 transition hover:bg-slate-100 hover:text-amber-600 group-hover:opacity-100 focus:opacity-100"
                              >
                                <CirclePlus size={15} />
                              </button>
                            )}
                          </div>
                          <div className="space-y-1">
                            {entries.slice(0, 3).map((entry) => {
                              const content = (
                                <>
                                  <span className="shrink-0 font-semibold">{entry.time ? `${entry.time} ` : ""}</span>
                                  <span className="truncate">{entry.title}</span>
                                </>
                              );
                              const className = "flex h-6 w-full items-center overflow-hidden rounded px-1.5 text-left text-[11px] leading-none hover:brightness-95";
                              const style = {
                                color: entry.color.principal,
                                backgroundColor: entry.kind === "programacao" ? entry.color.fundoForte : entry.color.fundo,
                                borderLeft: `3px solid ${entry.color.principal}`,
                              };
                              return entry.reserva ? (
                                <Link
                                  key={entry.key}
                                  href={`${base}/reservas/${entry.reserva.id}`}
                                  title={`${entry.tipoLabel}: ${entry.title}`}
                                  className={className}
                                  style={style}
                                >
                                  {content}
                                </Link>
                              ) : (
                                <button
                                  key={entry.key}
                                  type="button"
                                  onClick={() => entry.evento && setEventoModal({ evento: entry.evento, date: entry.evento.data })}
                                  title={`${entry.tipoLabel}: ${entry.title}`}
                                  className={className}
                                  style={style}
                                >
                                  {content}
                                </button>
                              );
                            })}
                            {entries.length > 3 && (
                              <button
                                type="button"
                                onClick={() => setSelectedDay(iso)}
                                className="w-full px-1 text-left text-[11px] font-medium text-slate-500 hover:text-slate-800"
                              >
                                + {entries.length - 3} compromissos
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-200 px-4 py-4 sm:px-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{formatDataComDiaSemana(selectedDay)}</p>
                    <p className="text-xs text-slate-500">{selectedEntries.length} compromisso(s)</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openNewEvent(selectedDay)}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-700 hover:text-amber-800"
                  >
                    <Plus size={15} /> Adicionar evento
                  </button>
                </div>
                {selectedEntries.length === 0 ? (
                  <p className="py-3 text-sm text-slate-400">Nenhum compromisso nesta data.</p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {selectedEntries.map((entry) => (
                      <AgendaRow key={entry.key} entry={entry} base={base} onEditEvent={(evento) => setEventoModal({ evento, date: evento.data })} />
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="px-4 py-2 sm:px-5">
              {listRows.length === 0 ? (
                <p className="py-12 text-center text-sm text-slate-400">Nenhum compromisso neste mês.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {listRows.map((entry) => (
                    <div key={entry.key} className="grid grid-cols-[112px_1fr] gap-3 py-3 sm:grid-cols-[150px_1fr]">
                      <div className="text-xs font-medium text-slate-500">{formatDataComDiaSemana(entry.date)}</div>
                      <AgendaRow entry={entry} base={base} onEditEvent={(evento) => setEventoModal({ evento, date: evento.data })} compact />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-xs text-slate-600">
          {tipos.map((tipo, index) => (
            <span key={tipo.slug} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: CORES_AGENDA[index % CORES_AGENDA.length].principal }} />
              {tipo.label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <Sparkles size={13} className="text-slate-500" /> Programação
          </span>
          <span className="inline-flex items-center gap-1.5">
            <UserRound size={13} className="text-slate-500" /> Reserva
          </span>
        </div>
      </main>

      {eventoModal && (
        <AgendaEventoModal
          key={eventoModal.evento?.id ?? `new-${eventoModal.date}`}
          clientId={clientId}
          tipos={tipos}
          evento={eventoModal.evento}
          initialDate={eventoModal.date}
          onClose={() => setEventoModal(null)}
          onSaved={() => {
            setEventoModal(null);
            load();
          }}
        />
      )}

      {reservaModal && (
        <ReservaModal
          clientId={clientId}
          tipos={tipos}
          initial={null}
          defaultData={selectedDay}
          onClose={() => setReservaModal(false)}
          onSave={() => {
            setReservaModal(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function AgendaRow({
  entry,
  base,
  onEditEvent,
  compact = false,
}: {
  entry: CalendarEntry;
  base: string;
  onEditEvent: (evento: EventoAgendaPousada) => void;
  compact?: boolean;
}) {
  const body = (
    <div className={clsx("flex min-w-0 flex-1 items-start gap-3", !compact && "py-2.5")}>
      <span
        className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md"
        style={{ color: entry.color.principal, backgroundColor: entry.color.fundo }}
      >
        {entry.kind === "programacao" ? <Sparkles size={16} /> : entry.reserva?.dataCheckout ? <BedDouble size={16} /> : <UserRound size={16} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <p className="truncate text-sm font-semibold text-slate-800">{entry.title}</p>
          {entry.time && <span className="inline-flex items-center gap-1 text-xs text-slate-500"><Clock3 size={12} /> {entry.time}</span>}
        </div>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          <span style={{ color: entry.color.principal }}>{entry.tipoLabel}</span>
          {entry.detail ? ` · ${entry.detail}` : ""}
        </p>
      </div>
    </div>
  );

  if (entry.reserva) {
    return <Link href={`${base}/reservas/${entry.reserva.id}`} className="block rounded-md hover:bg-slate-50">{body}</Link>;
  }
  return (
    <button
      type="button"
      onClick={() => entry.evento && onEditEvent(entry.evento)}
      className="block w-full rounded-md text-left hover:bg-slate-50"
    >
      {body}
    </button>
  );
}
