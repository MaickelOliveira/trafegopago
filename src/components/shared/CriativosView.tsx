"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { CreativeCard } from "./CreativeCard";
import { UploadCreativeModal } from "./UploadCreativeModal";
import type { Creative } from "@/lib/creatives";

interface Props {
  clientId: string;
  clientName: string;
  clientColor: string;
  adAccountId: string;
  role: "manager" | "client";
  backPath?: string;
}

export function CriativosView({ clientId, clientName, clientColor, adAccountId, role, backPath }: Props) {
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const url = role === "manager"
      ? `/api/creatives?clientId=${clientId}`
      : `/api/creatives`;
    fetch(url)
      .then((r) => r.json())
      .then((d) => setCreatives(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, [clientId, role]);

  useEffect(() => { load(); }, [load]);

  // Separa: enviados pelo outro lado (aguardando minha ação) vs enviados por mim
  const pendingForMe = creatives.filter(
    (c) => c.status === "pending" && c.sentBy !== role
  );
  const myItems = creatives.filter((c) => c.sentBy === role);
  const approvedByOther = creatives.filter(
    (c) => c.status === "approved" && c.sentBy !== role
  );

  const sectionTitle =
    role === "manager"
      ? { incoming: "Enviados pelo cliente", mine: "Enviados por você" }
      : { incoming: "Aguardando sua aprovação", mine: "Enviados por você" };

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
        <div>
          {backPath && (
            <Link href={backPath} className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
              </svg>
              Voltar
            </Link>
          )}
          <div className="flex items-center gap-3">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-xl text-base font-bold text-white"
              style={{ backgroundColor: clientColor }}
            >
              {clientName.charAt(0)}
            </span>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Criativos para aprovação</h1>
              {role === "manager" && <p className="text-sm text-slate-500">{clientName}</p>}
            </div>
          </div>
        </div>
        <button
          onClick={() => setUploadOpen(true)}
          className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition flex items-center gap-2"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
          </svg>
          Enviar criativo
        </button>
      </div>

      {loading ? (
        <div className="py-20 text-center text-sm text-slate-400">Carregando...</div>
      ) : (
        <div className="space-y-8">
          {/* Pendentes para mim agir */}
          {(pendingForMe.length > 0 || approvedByOther.length > 0) && (
            <section>
              <h2 className="mb-4 text-sm font-semibold text-slate-700 flex items-center gap-2">
                {sectionTitle.incoming}
                {pendingForMe.length > 0 && (
                  <span className="rounded-full bg-yellow-100 text-yellow-700 px-2 py-0.5 text-xs font-bold">
                    {pendingForMe.length} pendente{pendingForMe.length > 1 ? "s" : ""}
                  </span>
                )}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[...pendingForMe, ...approvedByOther].map((c) => (
                  <CreativeCard
                    key={c.id} creative={c} role={role}
                    sessionClientId={clientId} onUpdated={load}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Meus criativos */}
          <section>
            <h2 className="mb-4 text-sm font-semibold text-slate-700">{sectionTitle.mine}</h2>
            {myItems.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed border-slate-200 py-14 text-center">
                <p className="text-sm text-slate-400">Você ainda não enviou nenhum criativo.</p>
                <button
                  onClick={() => setUploadOpen(true)}
                  className="mt-3 text-sm text-blue-600 hover:underline"
                >
                  Enviar o primeiro criativo →
                </button>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {myItems.map((c) => (
                  <CreativeCard
                    key={c.id} creative={c} role={role}
                    sessionClientId={clientId} onUpdated={load}
                  />
                ))}
              </div>
            )}
          </section>

          {creatives.length === 0 && (
            <div className="py-20 text-center">
              <p className="text-slate-400 mb-2">Nenhum criativo ainda.</p>
              <p className="text-sm text-slate-400">Clique em "Enviar criativo" para começar.</p>
            </div>
          )}
        </div>
      )}

      {uploadOpen && (
        <UploadCreativeModal
          clientId={role === "manager" ? clientId : undefined}
          adAccountId={adAccountId}
          onClose={() => setUploadOpen(false)}
          onUploaded={() => { setUploadOpen(false); load(); }}
        />
      )}
    </div>
  );
}
