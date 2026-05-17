#!/usr/bin/env node
/**
 * Gera o Refresh Token do Google Ads via OAuth2.
 * Execute: node scripts/google-auth.mjs
 */

import { createServer } from "http";
import { exec } from "child_process";

const CLIENT_ID     = process.env.GOOGLE_ADS_CLIENT_ID     || "SEU_CLIENT_ID_AQUI";
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET || "SEU_CLIENT_SECRET_AQUI";
const REDIRECT_URI  = "http://localhost:9999/callback";
const SCOPE         = "https://www.googleapis.com/auth/adwords";

const authUrl =
  `https://accounts.google.com/o/oauth2/v2/auth` +
  `?client_id=${CLIENT_ID}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent(SCOPE)}` +
  `&access_type=offline` +
  `&prompt=consent`;

console.log("\n🔑 Abrindo navegador para autenticação Google Ads...\n");

// Abre o navegador automaticamente
const open = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
exec(`${open} "${authUrl}"`);

console.log("Se o navegador não abrir, acesse manualmente:");
console.log(authUrl, "\n");

// Servidor local temporário para capturar o código de retorno
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:9999");
  const code = url.searchParams.get("code");

  if (!code) {
    res.end("Código não encontrado. Tente novamente.");
    return;
  }

  res.end("<h2>✅ Autenticado! Pode fechar esta aba.</h2>");

  // Troca o código pelo Refresh Token
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  const tokens = await tokenRes.json();

  if (tokens.refresh_token) {
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("✅ REFRESH TOKEN GERADO COM SUCESSO:");
    console.log("");
    console.log(tokens.refresh_token);
    console.log("");
    console.log("Copie este token e adicione ao .env.local:");
    console.log("GOOGLE_ADS_REFRESH_TOKEN=" + tokens.refresh_token);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  } else {
    console.error("❌ Erro ao obter refresh token:", tokens);
  }

  server.close();
});

server.listen(9999, () => {
  console.log("Aguardando autenticação na porta 9999...");
});
