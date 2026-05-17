"use client";

import { clsx } from "clsx";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface KPICardProps {
  title: string;
  value: string;
  subtitle?: string;
  trend?: number; // % de variação em relação ao período anterior
  icon?: React.ReactNode;
  variant?: "default" | "success" | "warning" | "danger";
}

export function KPICard({ title, value, subtitle, trend, icon, variant = "default" }: KPICardProps) {
  const variantStyles = {
    default: "border-slate-200 bg-white",
    success: "border-green-200 bg-green-50",
    warning: "border-yellow-200 bg-yellow-50",
    danger: "border-red-200 bg-red-50",
  };

  const trendColor =
    trend === undefined
      ? ""
      : trend > 0
      ? "text-green-600"
      : trend < 0
      ? "text-red-600"
      : "text-slate-500";

  const TrendIcon =
    trend === undefined ? null : trend > 0 ? TrendingUp : trend < 0 ? TrendingDown : Minus;

  return (
    <div
      className={clsx(
        "rounded-xl border p-5 shadow-sm transition-shadow hover:shadow-md",
        variantStyles[variant]
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
          {subtitle && <p className="mt-1 text-xs text-slate-400">{subtitle}</p>}
        </div>
        {icon && (
          <div className="rounded-lg bg-slate-100 p-2 text-slate-600">{icon}</div>
        )}
      </div>

      {trend !== undefined && TrendIcon && (
        <div className={clsx("mt-3 flex items-center gap-1 text-sm font-medium", trendColor)}>
          <TrendIcon className="h-4 w-4" />
          <span>
            {Math.abs(trend).toFixed(1)}% vs. período anterior
          </span>
        </div>
      )}
    </div>
  );
}
