"use client";

import { useState, useRef } from "react";
import Image from "next/image";

type Props = {
  employeeName: string;
  currentLogoUrl?: string | null;
};

export function ConfiguracoesView({ employeeName, currentLogoUrl }: Props) {
  // ── Logo ──────────────────────────────────────────────────────────────────
  const [logoUrl, setLogoUrl] = useState<string | null>(currentLogoUrl ?? null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoMsg, setLogoMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowed.includes(file.type)) {
      setLogoMsg({ type: "err", text: "Apenas JPG, PNG, WebP ou GIF." });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setLogoMsg({ type: "err", text: "Imagem muito grande (máx 5 MB)." });
      return;
    }

    setLogoUploading(true);
    setLogoMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const upRes = await fetch("/api/upload", { method: "POST", body: form });
      if (!upRes.ok) throw new Error("Falha no upload");
      const { url } = await upRes.json();

      const saveRes = await fetch("/api/cliente/my-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logoUrl: url }),
      });
      if (!saveRes.ok) throw new Error("Falha ao salvar");

      setLogoUrl(url);
      setLogoMsg({ type: "ok", text: "Logo atualizada com sucesso!" });
    } catch {
      setLogoMsg({ type: "err", text: "Erro ao enviar imagem. Tente novamente." });
    } finally {
      setLogoUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleRemoveLogo() {
    setLogoUploading(true);
    setLogoMsg(null);
    try {
      const res = await fetch("/api/cliente/my-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logoUrl: "" }),
      });
      if (!res.ok) throw new Error();
      setLogoUrl(null);
      setLogoMsg({ type: "ok", text: "Logo removida." });
    } catch {
      setLogoMsg({ type: "err", text: "Erro ao remover logo." });
    } finally {
      setLogoUploading(false);
    }
  }

  // ── Senha ─────────────────────────────────────────────────────────────────
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    if (newPw !== confirmPw) {
      setPwMsg({ type: "err", text: "As senhas não coincidem." });
      return;
    }
    if (newPw.length < 6) {
      setPwMsg({ type: "err", text: "A nova senha deve ter ao menos 6 caracteres." });
      return;
    }
    setPwLoading(true);
    setPwMsg(null);
    try {
      const res = await fetch("/api/cliente/my-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro");
      setPwMsg({ type: "ok", text: "Senha alterada com sucesso!" });
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao alterar senha.";
      setPwMsg({ type: "err", text: msg });
    } finally {
      setPwLoading(false);
    }
  }

  const initials = employeeName.charAt(0).toUpperCase();

  return (
    <div className="max-w-lg mx-auto py-8 px-4 space-y-8">
      <h1 className="text-2xl font-bold text-slate-900">Configurações</h1>

      {/* ── Logo / Foto ── */}
      <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
        <h2 className="text-base font-semibold text-slate-800">Foto / Logo</h2>

        <div className="flex items-center gap-5">
          <div className="relative h-20 w-20 shrink-0">
            {logoUrl ? (
              <Image
                src={logoUrl}
                alt="Logo"
                fill
                className="rounded-xl object-cover border border-slate-200"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-violet-600 text-white text-3xl font-bold">
                {initials}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={logoUploading}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 transition"
            >
              {logoUploading ? "Enviando…" : logoUrl ? "Trocar imagem" : "Enviar imagem"}
            </button>
            {logoUrl && (
              <button
                onClick={handleRemoveLogo}
                disabled={logoUploading}
                className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition"
              >
                Remover
              </button>
            )}
            <p className="text-xs text-slate-400">JPG, PNG ou WebP — máx 5 MB</p>
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={handleLogoUpload}
        />

        {logoMsg && (
          <p className={`text-sm font-medium ${logoMsg.type === "ok" ? "text-emerald-600" : "text-red-600"}`}>
            {logoMsg.text}
          </p>
        )}
      </section>

      {/* ── Alterar Senha ── */}
      <section className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-base font-semibold text-slate-800 mb-4">Alterar Senha</h2>

        <form onSubmit={handlePasswordChange} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Senha atual</label>
            <input
              type="password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              placeholder="••••••••"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Nova senha</label>
            <input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              required
              minLength={6}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              placeholder="Mínimo 6 caracteres"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Confirmar nova senha</label>
            <input
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              placeholder="Repita a nova senha"
            />
          </div>

          {pwMsg && (
            <p className={`text-sm font-medium ${pwMsg.type === "ok" ? "text-emerald-600" : "text-red-600"}`}>
              {pwMsg.text}
            </p>
          )}

          <button
            type="submit"
            disabled={pwLoading}
            className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50 transition"
          >
            {pwLoading ? "Salvando…" : "Alterar senha"}
          </button>
        </form>
      </section>
    </div>
  );
}
