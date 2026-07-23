"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";

// Navegação fixa entre as 3 telas do sistema de Pousada — sempre visível, em
// qualquer uma das páginas, pra nunca deixar o gestor/cliente sem saber como
// voltar pro dashboard a partir de Ocupação ou Relatórios.
export function PousadaSubNav({ clientId, role }: { clientId: string; role: "manager" | "client" }) {
  const pathname = usePathname();
  const base = role === "manager" ? `/gestor/${clientId}/pousada` : "/cliente/pousada";

  const items = [
    { href: base, label: "Dashboard", icon: "🏠", exact: true },
    { href: `${base}/ocupacao`, label: "Ocupação", icon: "🛏️", exact: false },
    { href: `${base}/relatorios`, label: "Relatórios", icon: "📊", exact: false },
  ];

  return (
    <div className="border-b border-slate-200 bg-white">
      <div className="max-w-5xl mx-auto px-6 md:px-10 flex items-center gap-1">
        {items.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
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
              <span>{item.icon}</span> {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
