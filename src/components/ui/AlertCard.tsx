"use client";

import { Alert } from "@/types";
import { clsx } from "clsx";
import { AlertTriangle, AlertCircle, Info, ChevronRight } from "lucide-react";
import { useState } from "react";

interface AlertCardProps {
  alert: Alert;
}

const platformLabel: Record<string, string> = {
  meta: "Meta Ads",
  google: "Google Ads",
};

const platformBadge: Record<string, string> = {
  meta: "bg-blue-100 text-blue-700",
  google: "bg-orange-100 text-orange-700",
};

const severityConfig = {
  critical: {
    bg: "bg-red-50 border-red-300",
    icon: AlertCircle,
    iconColor: "text-red-600",
    badge: "bg-red-100 text-red-700",
    label: "Crítico",
  },
  warning: {
    bg: "bg-yellow-50 border-yellow-300",
    icon: AlertTriangle,
    iconColor: "text-yellow-600",
    badge: "bg-yellow-100 text-yellow-700",
    label: "Atenção",
  },
  info: {
    bg: "bg-sky-50 border-sky-200",
    icon: Info,
    iconColor: "text-sky-600",
    badge: "bg-sky-100 text-sky-700",
    label: "Info",
  },
};

export function AlertCard({ alert }: AlertCardProps) {
  const [expanded, setExpanded] = useState(false);
  const config = severityConfig[alert.severity];
  const Icon = config.icon;

  return (
    <div
      className={clsx(
        "rounded-lg border p-4 transition-all",
        config.bg
      )}
    >
      <div className="flex items-start gap-3">
        <Icon className={clsx("mt-0.5 h-5 w-5 shrink-0", config.iconColor)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={clsx("rounded-full px-2 py-0.5 text-xs font-semibold", config.badge)}>
              {config.label}
            </span>
            <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", platformBadge[alert.platform])}>
              {platformLabel[alert.platform]}
            </span>
          </div>
          <p className="mt-1 text-sm font-semibold text-slate-800 truncate">{alert.campaignName}</p>
          <p className="text-sm text-slate-600">{alert.message}</p>

          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-2 flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800"
          >
            {expanded ? "Ocultar recomendação" : "Ver recomendação"}
            <ChevronRight className={clsx("h-3 w-3 transition-transform", expanded && "rotate-90")} />
          </button>

          {expanded && (
            <div className="mt-2 rounded-md bg-white/70 p-3 text-sm text-slate-700">
              💡 {alert.recommendation}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
