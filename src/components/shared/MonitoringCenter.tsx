"use client";

import { useState, useEffect, useCallback } from "react";
import { clsx } from "clsx";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { ConnectionDashboard } from "@/components/shared/ConnectionDashboard";

type DailyPoint = { date: string; count: number };
type ActivityEvent = {
  id: string;
  ts: number;
  type: "message" | "needs_attention" | "new_lead";
  title: string;
  detail?: string;
};
type LeadHeat = { id: string; name: string; phone: string; tone: "red" | "amber" | "green"; reason: string };

type MonitoringData = {
  dailySeries: DailyPoint[];
  hourDayHeatmap: number[][];
  leadHeatmap: LeadHeat[];
  feed: ActivityEvent[];
};

const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function fmtDateLabel(iso: string) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function timeAgo(ts: number) {
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

const DashTip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-white/20 bg-slate-900/95 backdrop-blur px-3 py-2 shadow-2xl text-xs">
      <p className="text-slate-400 mb-1">{label}</p>
      <p className="font-bold text-white">{payload[0].value} mensagens</p>
    </div>
  );
};

function HourDayHeatmap({ data }: { data: number[][] }) {
  const max = Math.max(1, ...data.flat());

  function cellColor(v: number) {
    if (v === 0) return "bg-slate-100";
    const ratio = v / max;
    if (ratio > 0.75) return "bg-indigo-700";
    if (ratio > 0.5) return "bg-indigo-500";
    if (ratio > 0.25) return "bg-indigo-300";
    return "bg-indigo-200";
  }

  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full">
        <div className="flex gap-[3px] pl-8">
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="w-3.5 text-center text-[9px] text-slate-400">
              {h % 3 === 0 ? h : ""}
            </div>
          ))}
        </div>
        {DIAS_SEMANA.map((dia, dIdx) => (
          <div key={dia} className="flex items-center gap-[3px] mt-[3px]">
            <span className="w-7 text-[10px] text-slate-400 shrink-0">{dia}</span>
            {data[dIdx].map((v, h) => (
              <div
                key={h}
                title={`${dia} ${h}h — ${v} mensagens`}
                className={clsx("h-3.5 w-3.5 rounded-sm", cellColor(v))}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function LeadHeatmapGrid({ leads }: { leads: LeadHeat[] }) {
  if (leads.length === 0) {
    return <p className="text-sm text-slate-400 italic">Nenhum lead ativo no momento.</p>;
  }
  const tone = { red: "bg-red-500", amber: "bg-amber-400", green: "bg-emerald-400" };
  return (
    <div className="flex flex-wrap gap-2">
      {leads.map((l) => (
        <a
          key={l.id}
          href={`https://wa.me/${l.phone.replace(/\D/g, "")}`}
          target="_blank"
          rel="noreferrer"
          title={`${l.name} — ${l.reason}`}
          className={clsx("h-8 w-8 rounded-md transition hover:scale-110", tone[l.tone])}
        />
      ))}
    </div>
  );
}

const FEED_ICON: Record<ActivityEvent["type"], string> = {
  message: "💬",
  needs_attention: "⚠️",
  new_lead: "🆕",
};

function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-slate-400 italic">Nenhuma atividade recente.</p>;
  }
  return (
    <div className="space-y-2 max-h-[420px] overflow-y-auto">
      {events.map((e) => (
        <div key={e.id} className="flex items-start gap-2.5 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
          <span className="text-base shrink-0">{FEED_ICON[e.type]}</span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-slate-700 truncate">{e.title}</p>
            {e.detail && <p className="text-[11px] text-slate-400 truncate">{e.detail}</p>}
          </div>
          <span className="text-[10px] text-slate-400 shrink-0">{timeAgo(e.ts)}</span>
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-bold text-slate-800 mb-4">{title}</p>
      {children}
    </div>
  );
}

export function MonitoringCenter({ fetchUrl, connectionsFetchUrl }: { fetchUrl: string; connectionsFetchUrl: string }) {
  const [data, setData] = useState<MonitoringData | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(fetchUrl);
      if (!res.ok) return;
      setData(await res.json());
    } catch { /* mantém último estado conhecido em caso de falha de rede */ }
  }, [fetchUrl]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">📡 Central de Monitoramento da IA</h1>
        <p className="text-sm text-slate-500 mt-0.5">Acompanhe em tempo real o atendimento da sua IA e saja quando precisar.</p>
      </div>

      <ConnectionDashboard fetchUrl={connectionsFetchUrl} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <Section title="📈 Mensagens por dia (últimos 30 dias)">
            {data ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={data.dailySeries.map((d) => ({ ...d, label: fmtDateLabel(d.date) }))}>
                  <defs>
                    <linearGradient id="msgGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={2} />
                  <YAxis tick={{ fontSize: 11 }} width={28} allowDecimals={false} />
                  <Tooltip content={<DashTip />} />
                  <Area type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} fill="url(#msgGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] animate-pulse bg-slate-50 rounded-lg" />
            )}
          </Section>

          <Section title="🗓️ Padrão de atendimento (hora × dia da semana)">
            {data ? <HourDayHeatmap data={data.hourDayHeatmap} /> : <div className="h-32 animate-pulse bg-slate-50 rounded-lg" />}
          </Section>

          <Section title="🔥 Mapa de urgência dos leads">
            {data ? <LeadHeatmapGrid leads={data.leadHeatmap} /> : <div className="h-16 animate-pulse bg-slate-50 rounded-lg" />}
            <div className="flex items-center gap-4 mt-4 text-[11px] text-slate-500">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-red-500" /> IA pediu ajuda</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-400" /> Atenção/alta intenção</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-400" /> IA conduzindo bem</span>
            </div>
          </Section>
        </div>

        <Section title="🕒 Atividade recente">
          {data ? <ActivityFeed events={data.feed} /> : <div className="h-64 animate-pulse bg-slate-50 rounded-lg" />}
        </Section>
      </div>
    </div>
  );
}
