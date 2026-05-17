"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useState } from "react";

type DailyRow = {
  date: string;
  spend: number;
  impressions?: number;
  clicks?: number;
  conversions?: number;
  ctr?: number;
  cpc?: number;
  roas?: number;
};

interface MetricsChartProps {
  data: DailyRow[];
}

type ChartMode = "spend" | "conversions" | "roas" | "ctr";

const chartConfig: Record<ChartMode, { label: string; color: string; type: "area" | "bar" | "line" }[]> = {
  spend: [
    { label: "Investimento (R$)", color: "#3b82f6", type: "area" },
  ],
  conversions: [
    { label: "Conversões", color: "#10b981", type: "bar" },
  ],
  roas: [
    { label: "ROAS", color: "#8b5cf6", type: "line" },
  ],
  ctr: [
    { label: "CTR (%)", color: "#f59e0b", type: "line" },
  ],
};

type TooltipPayload = {
  value: number;
  name: string;
  color: string;
};

type CustomTooltipProps = {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
};

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length || !label) return null;
  const date = parseISO(label);
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-lg text-sm">
      <p className="mb-2 font-semibold text-slate-700">
        {format(date, "d 'de' MMM", { locale: ptBR })}
      </p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: <strong>{typeof p.value === "number" ? p.value.toLocaleString("pt-BR") : p.value}</strong>
        </p>
      ))}
    </div>
  );
}

export function MetricsChart({ data }: MetricsChartProps) {
  const [mode, setMode] = useState<ChartMode>("spend");

  const modes: { key: ChartMode; label: string }[] = [
    { key: "spend", label: "Investimento" },
    { key: "conversions", label: "Conversões" },
    { key: "roas", label: "ROAS" },
    { key: "ctr", label: "CTR" },
  ];

  const dataKey: Record<ChartMode, string> = {
    spend: "spend",
    conversions: "conversions",
    roas: "roas",
    ctr: "ctr",
  };

  const key = dataKey[mode];
  const config = chartConfig[mode][0];
  const color = config.color;
  const type = config.type;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-slate-800">Desempenho nos últimos 30 dias</h2>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {modes.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === m.key
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis
            dataKey="date"
            tickFormatter={(v) => format(parseISO(v), "d/M")}
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) =>
              mode === "spend"
                ? `R$${(v / 1000).toFixed(1)}k`
                : mode === "roas" || mode === "ctr"
                ? v.toFixed(2)
                : v.toLocaleString("pt-BR")
            }
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {type === "area" && (
            <Area
              type="monotone"
              dataKey={key}
              name={config.label}
              fill={`${color}20`}
              stroke={color}
              strokeWidth={2}
              dot={false}
            />
          )}
          {type === "bar" && (
            <Bar dataKey={key} name={config.label} fill={color} radius={[3, 3, 0, 0]} />
          )}
          {type === "line" && (
            <Line
              type="monotone"
              dataKey={key}
              name={config.label}
              stroke={color}
              strokeWidth={2}
              dot={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
