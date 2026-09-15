"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { BarChart3, BedDouble, CalendarDays, LayoutDashboard } from "lucide-react";

// Navegação fixa entre as telas do sistema de Pousada — sempre visível, em
// qualquer uma das páginas, pra nunca deixar o gestor/cliente sem saber como
// voltar pro dashboard a partir de Ocupação ou Relatórios.
export function PousadaSubNav({ clientId, role }: { clientId: string; role: "manager" | "client" }) {
  const pathname = usePathname();
  const base = role === "manager" ? `/gestor/${clientId}/pousada` : "/cliente/pousada";

  const items = [
    { href: base, label: "Dashboard", icon: LayoutDashboard, exact: true },
    { href: `${base}/agenda`, label: "Agenda", icon: CalendarDays, exact: false },
    { href: `${base}/ocupacao`, label: "Ocupação", icon: BedDouble, exact: false },
    { href: `${base}/relatorios`, label: "Relatórios", icon: BarChart3, exact: false },
  ];

  return (
    <div className="overflow-x-auto border-b border-slate-200 bg-white">
      <div className="mx-auto flex min-w-max max-w-7xl items-center gap-1 px-4 sm:px-6 md:px-8">
        {items.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "px-4 py-3 text-sm font-medium border-b-2 transition -mb-px flex items-center gap-1.5",
                active
                  ? "border-amber-600 text-amber-700"
                  : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
              )}
            >
              <Icon size={16} /> {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
