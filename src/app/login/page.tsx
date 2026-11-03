"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erro ao entrar");
        return;
      }
      router.push(data.redirect);
    } catch {
      setError("Erro de conexão");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="nexo-login">
      <aside className="nexo-login-art" aria-label="Nexo — tráfego de performance">
        <div className="nexo-wordmark"><img src="/brand/nexo-lockup-dark.png" alt="Nexo" width="172" height="35" /></div>
        <div className="nexo-login-art-copy"><span className="nexo-eyebrow">TRÁFEGO DE PERFORMANCE</span><h2>Conexões que<br />movem negócios.</h2><p>Campanhas, relacionamento e inteligência em um só lugar.</p></div>
      </aside>
      <div className="nexo-login-form-area">
        <div className="nexo-login-form">
          <img src="/brand/nexo-lockup-dark.png" alt="Nexo" width="172" height="35" className="nexo-login-mobile-logo" />
          <span className="nexo-eyebrow">BEM-VINDO À NEXO</span>
          <h1>Acesse sua operação.</h1>
          <p>Entre para acompanhar seus clientes e resultados.</p>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label htmlFor="login-email">E-mail</label>
              <input
                id="login-email"
                autoComplete="username"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                placeholder="seu@email.com"
              />
            </div>
            <div>
              <label htmlFor="login-password">Senha</label>
              <input
                id="login-password"
                autoComplete="current-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p role="alert" className="nexo-feedback error">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="nexo-primary"
            >
              {loading ? "Entrando..." : "Entrar na plataforma"} {!loading && <ArrowUpRight size={17} />}
            </button>
          </div>
        </form>
        <span className="nexo-login-note">NEXO · TRÁFEGO & RELACIONAMENTO</span>
        </div>
      </div>
    </div>
  );
}
