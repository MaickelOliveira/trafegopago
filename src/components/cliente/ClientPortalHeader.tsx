"use client";

import { useRouter, usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { clsx } from "clsx";
import type { EmployeePermissions } from "@/lib/employees";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  show: boolean;
  activeColor: string;
  badge?: number;
};

function NavLink({ item, pathname, exact }: { item: NavItem; pathname: string; exact?: boolean }) {
  const active = exact ? pathname === item.href : pathname.startsWith(item.href);
  return (
    <Link
      href={item.href}
      className={clsx(
        "rounded-lg px-3 py-1.5 text-sm transition flex items-center gap-1.5 whitespace-nowrap",
        active ? `${item.activeColor} font-medium` : "text-slate-500 hover:bg-slate-50"
      )}
    >
      <span>{item.icon} {item.label}</span>
      {!!item.badge && (
        <span className="rounded-full bg-yellow-400 text-slate-900 px-1.5 py-0.5 text-xs font-bold">
          {item.badge}
        </span>
      )}
    </Link>
  );
}

export function ClientPortalHeader({
  clientName,
  clientColor,
  isEmployee = false,
  permissions,
  clientLogoUrl,
  employeeName,
  enabledSystems,
}: {
  clientName: string;
  clientColor: string;
  isEmployee?: boolean;
  permissions?: EmployeePermissions;
  clientLogoUrl?: string | null;
  employeeName?: string;
  enabledSystems?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [maisOpen, setMaisOpen] = useState(false);
  const maisRef = useRef<HTMLDivElement>(null);

  const canViewCreatives = !isEmployee || (permissions?.canViewCreatives ?? false);
  const canViewAutomations = !isEmployee || (permissions?.canViewAutomations ?? false);
  const canViewAgentIa = !isEmployee || (permissions?.canViewAgentIa ?? false);
  const canViewWaba = !isEmployee || (permissions?.canViewWaba ?? false);

  useEffect(() => {
    if (!canViewCreatives) return;
    fetch("/api/creatives")
      .then((r) => r.json())
      .then((items) => {
        const count = Array.isArray(items)
          ? items.filter((x: { status: string; sentBy: string }) => x.status === "pending" && x.sentBy === "manager").length
          : 0;
        setPendingCount(count);
      })
      .catch(() => {});
  }, [canViewCreatives]);

  useEffect(() => {
    if (!maisOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (maisRef.current && !maisRef.current.contains(e.target as Node)) setMaisOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [maisOpen]);

  useEffect(() => { setMaisOpen(false); }, [pathname]);

  async function logout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  // Itens do dia a dia — sempre visíveis na barra
  const principais: NavItem[] = [
    { href: "/cliente", label: "Dashboard", icon: "📊", show: !isEmployee, activeColor: "bg-slate-800 text-white" },
    { href: "/cliente/crm", label: "CRM", icon: "📋", show: true, activeColor: "bg-blue-50 text-blue-700" },
    { href: "/cliente/inbox", label: "Mensagens", icon: "💬", show: true, activeColor: "bg-blue-50 text-blue-700" },
    { href: "/cliente/pousada", label: "Pousada", icon: "🏡", show: !!enabledSystems?.includes("pousada"), activeColor: "bg-amber-50 text-amber-700" },
  ].filter((i) => i.show);

  // Itens usados com menos frequência — agrupados no menu "Mais"
  const secundarios: NavItem[] = [
    { href: "/cliente/checklist", label: "Checklist", icon: "✅", show: true, activeColor: "bg-blue-50 text-blue-700" },
    { href: "/cliente/criativos", label: "Criativos", icon: "🎨", show: canViewCreatives, activeColor: "bg-purple-50 text-purple-700", badge: pendingCount },
    { href: "/cliente/automacoes", label: "Automações", icon: "⚡", show: canViewAutomations, activeColor: "bg-emerald-50 text-emerald-700" },
    { href: "/cliente/agente-ia", label: "Agente de IA", icon: "🤖", show: canViewAgentIa, activeColor: "bg-violet-50 text-violet-700" },
    { href: "/cliente/disparos-wa", label: "Disparos WA", icon: "📨", show: canViewWaba, activeColor: "bg-green-50 text-green-700" },
    { href: "/cliente/funcionarios", label: "Colaboradores", icon: "👥", show: !isEmployee, activeColor: "bg-slate-800 text-white" },
    { href: "/cliente/configuracoes", label: "Configurações", icon: "⚙️", show: !isEmployee, activeColor: "bg-slate-800 text-white" },
  ].filter((i) => i.show);

  const secundarioAtivo = secundarios.some((i) => pathname.startsWith(i.href));

  return (
    <header className="border-b border-slate-200 bg-white px-6 py-3.5 flex items-center justify-between gap-4">
      <div className="flex items-center gap-4 min-w-0">
        <div className="flex items-center gap-3 shrink-0">
          <div
            className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white overflow-hidden"
            style={!isEmployee && clientLogoUrl ? undefined : { backgroundColor: clientColor }}
          >
            {!isEmployee && clientLogoUrl ? (
              <Image src={clientLogoUrl} alt="Logo" fill className="object-cover" />
            ) : (
              clientName.charAt(0)
            )}
          </div>
          <span className="font-semibold text-slate-900 whitespace-nowrap">
            {isEmployee && employeeName ? employeeName : clientName}
          </span>
          {isEmployee && (
            <span className="rounded-full bg-violet-100 text-violet-700 text-xs font-medium px-2 py-0.5 whitespace-nowrap">
              Funcionário
            </span>
          )}
        </div>

        <nav className="flex items-center gap-1 overflow-x-auto">
          {principais.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} exact={item.href === "/cliente"} />
          ))}

          {secundarios.length > 0 && (
            <div className="relative" ref={maisRef}>
              <button
                onClick={() => setMaisOpen((v) => !v)}
                className={clsx(
                  "rounded-lg px-3 py-1.5 text-sm transition flex items-center gap-1 whitespace-nowrap",
                  secundarioAtivo ? "bg-blue-50 text-blue-700 font-medium" : "text-slate-500 hover:bg-slate-50"
                )}
              >
                ⋯ Mais
              </button>
              {maisOpen && (
                <div className="absolute left-0 top-full mt-1 w-56 rounded-xl border border-slate-200 bg-white shadow-lg py-1.5 z-20">
                  {secundarios.map((item) => {
                    const active = pathname.startsWith(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={clsx(
                          "flex items-center justify-between gap-2 px-3.5 py-2 text-sm transition",
                          active ? "bg-slate-50 text-slate-900 font-medium" : "text-slate-600 hover:bg-slate-50"
                        )}
                      >
                        <span>{item.icon} {item.label}</span>
                        {!!item.badge && (
                          <span className="rounded-full bg-yellow-400 text-slate-900 px-1.5 py-0.5 text-xs font-bold">
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </nav>
      </div>

      <button
        onClick={logout}
        disabled={loggingOut}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition shrink-0"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
        Sair
      </button>
    </header>
  );
}
