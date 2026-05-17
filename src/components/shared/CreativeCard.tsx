"use client";

import { useState } from "react";
import { clsx } from "clsx";
import type { Creative } from "@/lib/creatives";
import { PublishModal } from "./PublishModal";

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending:   { label: "🟡 Pendente",   cls: "bg-yellow-100 text-yellow-700" },
  approved:  { label: "🟢 Aprovado",   cls: "bg-green-100 text-green-700" },
  rejected:  { label: "🔴 Rejeitado",  cls: "bg-red-100 text-red-700" },
  published: { label: "✅ Publicado",  cls: "bg-blue-100 text-blue-700" },
};

const FILE_ICON: Record<string, string> = {
  image: "🖼️",
  video: "🎬",
  url:   "🔗",
};

interface Props {
  creative: Creative;
  role: "manager" | "client";
  sessionClientId?: string;
  onUpdated: () => void;
}

export function CreativeCard({ creative, role, onUpdated }: Props) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectComment, setRejectComment] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const badge = STATUS_BADGE[creative.status] || STATUS_BADGE.pending;

  const isRecipient =
    (creative.sentBy === "manager" && role === "client") ||
    (creative.sentBy === "client" && role === "manager");

  const canAct = isRecipient && creative.status === "pending";
  const canPublish = role === "manager" && (creative.status === "approved" || (isRecipient && creative.status === "pending"));

  async function approve() {
    setLoading(true);
    await fetch(`/api/creatives/${creative.id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });
    setLoading(false);
    onUpdated();
  }

  async function reject() {
    if (!rejectComment.trim()) return;
    setLoading(true);
    await fetch(`/api/creatives/${creative.id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "rejected", comment: rejectComment }),
    });
    setLoading(false);
    setRejectOpen(false);
    setRejectComment("");
    onUpdated();
  }

  const thumb = creative.filePath
    ? creative.filePath
    : creative.fileUrl || null;
  const isVideo = creative.fileType === "video";

  const createdAt = new Date(creative.createdAt);
  const timeAgo = (() => {
    const diff = Date.now() - createdAt.getTime();
    const h = Math.floor(diff / 3600000);
    if (h < 1) return "agora";
    if (h < 24) return `${h}h atrás`;
    return `${Math.floor(h / 24)}d atrás`;
  })();

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Preview */}
      <div className="relative bg-slate-100 h-44 flex items-center justify-center overflow-hidden">
        {thumb && !isVideo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="w-full h-full object-cover" />
        )}
        {thumb && isVideo && (
          <video src={thumb} className="w-full h-full object-cover" />
        )}
        {!thumb && (
          <span className="text-4xl">{FILE_ICON[creative.fileType]}</span>
        )}
        <div className="absolute top-2 left-2 flex gap-1.5">
          <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", badge.cls)}>
            {badge.label}
          </span>
        </div>
        {creative.sentBy === "manager" ? (
          <span className="absolute top-2 right-2 rounded-full bg-slate-900/70 px-2 py-0.5 text-xs text-white">
            Gestor
          </span>
        ) : (
          <span className="absolute top-2 right-2 rounded-full bg-purple-600/80 px-2 py-0.5 text-xs text-white">
            Cliente
          </span>
        )}
      </div>

      {/* Info */}
      <div className="p-4 space-y-2">
        {creative.copy.headline && (
          <p className="font-semibold text-slate-800 line-clamp-1">{creative.copy.headline}</p>
        )}
        {creative.copy.body && (
          <p className="text-sm text-slate-500 line-clamp-2">{creative.copy.body}</p>
        )}
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>{FILE_ICON[creative.fileType]} {creative.fileType}</span>
          <span>·</span>
          <span>{creative.copy.cta}</span>
          <span>·</span>
          <span>{timeAgo}</span>
        </div>

        {/* Rejeição */}
        {creative.status === "rejected" && creative.rejectionComment && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            <span className="font-semibold">Motivo: </span>{creative.rejectionComment}
          </div>
        )}

        {/* Link para anúncio publicado */}
        {creative.status === "published" && creative.metaAdId && (
          <a
            href={`https://www.facebook.com/adsmanager/manage/ads/edit?act=${creative.adAccountId.replace("act_","")}&selected_ad_ids=${creative.metaAdId}`}
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
          >
            Ver anúncio no Meta →
          </a>
        )}

        {/* Ações */}
        {canAct && (
          <div className="flex gap-2 pt-1">
            {canPublish ? (
              <>
                <button
                  onClick={() => setPublishOpen(true)}
                  disabled={loading}
                  className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 transition"
                >
                  Aprovar + Publicar
                </button>
                <button
                  onClick={() => setRejectOpen(true)}
                  disabled={loading}
                  className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition"
                >
                  Rejeitar
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={approve} disabled={loading}
                  className="flex-1 rounded-lg bg-green-600 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60 transition"
                >
                  {loading ? "..." : "✓ Aprovar"}
                </button>
                <button
                  onClick={() => setRejectOpen(true)} disabled={loading}
                  className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition"
                >
                  ✗ Rejeitar
                </button>
              </>
            )}
          </div>
        )}

        {/* Botão publicar para criativos já aprovados pelo cliente */}
        {!canAct && creative.status === "approved" && role === "manager" && (
          <button
            onClick={() => setPublishOpen(true)}
            className="w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition"
          >
            Publicar no Meta →
          </button>
        )}
      </div>

      {/* Modal rejeição */}
      {rejectOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setRejectOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-slate-900 mb-1">Rejeitar criativo</h3>
            <p className="text-sm text-slate-500 mb-4">Informe o motivo para o remetente corrigir.</p>
            <textarea
              value={rejectComment} onChange={(e) => setRejectComment(e.target.value)}
              rows={3} placeholder="Ex: A imagem está fora do tamanho ideal..."
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100 resize-none"
            />
            <div className="flex gap-3 mt-4">
              <button onClick={() => setRejectOpen(false)} className="flex-1 rounded-lg border border-slate-200 py-2 text-sm text-slate-600">Cancelar</button>
              <button onClick={reject} disabled={!rejectComment.trim() || loading} className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                {loading ? "..." : "Rejeitar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal publicar */}
      {publishOpen && (
        <PublishModal
          creative={creative}
          onClose={() => setPublishOpen(false)}
          onPublished={() => { setPublishOpen(false); onUpdated(); }}
        />
      )}
    </div>
  );
}
