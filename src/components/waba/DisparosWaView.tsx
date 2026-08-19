"use client";

import { useState } from "react";
import { clsx } from "clsx";
import type { WabaTemplate } from "@/lib/waba-templates";
import type { Funnel } from "@/lib/funnels";
import type { EvolutionSession } from "@/lib/evolution-sessions";
import { WabaView } from "./WabaView";
import { BroadcastsView } from "@/components/broadcasts/BroadcastsView";

type MetaConnection = {
  id: string;
  phone: string;
  phoneNumberId: string;
  token: string;
  funnelName: string;
};

type Props = {
  clientId: string;
  initialTemplates: WabaTemplate[];
  metaConnections: MetaConnection[];
  evolutionConnections: EvolutionSession[];
  funnels: Funnel[];
};

type Mode = "meta" | "evolution";

// Wrapper que mantém os dois mundos (template Meta oficial x texto livre
// Evolution) na MESMA tela "Disparos WA", mas com formulários e lógica
// completamente isolados — WabaView.tsx segue intocado, BroadcastsView.tsx
// é um componente novo e separado.
export function DisparosWaView({ clientId, initialTemplates, metaConnections, evolutionConnections, funnels }: Props) {
  const [mode, setMode] = useState<Mode>("meta");

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button onClick={() => setMode("meta")}
          className={clsx("flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-sm font-semibold border transition",
            mode === "meta" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300")}>
          📄 Templates Meta (Oficial)
        </button>
        <button onClick={() => setMode("evolution")}
          className={clsx("flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-sm font-semibold border transition",
            mode === "evolution" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300")}>
          ⚡ Texto Livre (Evolution)
        </button>
      </div>

      {mode === "meta" ? (
        <WabaView clientId={clientId} initialTemplates={initialTemplates} metaConnections={metaConnections} funnels={funnels} />
      ) : (
        <BroadcastsView clientId={clientId} evolutionConnections={evolutionConnections} funnels={funnels} />
      )}
    </div>
  );
}
