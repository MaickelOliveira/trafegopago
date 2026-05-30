import { NextRequest, NextResponse } from "next/server";
import { updateFunnel, getFunnelById } from "@/lib/funnels";
import type { FunnelConnection } from "@/lib/funnels";

const GRAPH = "https://graph.facebook.com/v21.0";

export async function POST(req: NextRequest) {
  try {
    const { code, wabaId, phoneNumberId, funnelId } = await req.json();

    const appId     = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;

    if (!appId || !appSecret)
      return NextResponse.json({ error: "META_APP_ID ou META_APP_SECRET não configurados no servidor" }, { status: 500 });

    if (!code || !wabaId || !phoneNumberId || !funnelId)
      return NextResponse.json({ error: "Parâmetros obrigatórios: code, wabaId, phoneNumberId, funnelId" }, { status: 400 });

    // ── 1. Troca o code por um business access token ─────────────────────
    const tokenRes = await fetch(
      `https://graph.facebook.com/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${encodeURIComponent(code)}`
    );
    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      console.error("[EmbeddedSignup] Token exchange falhou:", tokenData);
      return NextResponse.json({ error: "Falha ao trocar token", detail: tokenData?.error?.message ?? "unknown" }, { status: 400 });
    }

    const token = tokenData.access_token as string;

    // ── 2. Inscreve a WABA no webhook do nosso app ────────────────────────
    const subRes = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const subData = await subRes.json();
    console.log("[EmbeddedSignup] Webhook subscription:", subData);

    // ── 3. Busca o número de telefone real da WABA ────────────────────────
    const phoneRes = await fetch(
      `${GRAPH}/${phoneNumberId}?fields=display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const phoneData = await phoneRes.json();
    const displayPhone = phoneData.display_phone_number ?? phoneNumberId;
    const verifiedName = phoneData.verified_name ?? "";

    // ── 4. Salva a conexão no funil ───────────────────────────────────────
    const funnel = getFunnelById(funnelId);
    if (!funnel)
      return NextResponse.json({ error: "Funil não encontrado" }, { status: 404 });

    const connId = `meta_${funnelId}_${Date.now()}`;
    const newConn: FunnelConnection = {
      id: connId,
      phone: displayPhone,
      type: "meta",
      metaPhoneNumberId: phoneNumberId,
      metaToken: token,
      metaVerifyToken: "trafegopago-meta-webhook",
    };

    // Remove conexão Meta anterior para esse phoneNumberId (evita duplicata)
    const existingConns = (funnel.connections ?? []).filter(
      c => !(c.type === "meta" && c.metaPhoneNumberId === phoneNumberId)
    );

    updateFunnel(funnelId, { connections: [...existingConns, newConn] });

    console.log(`[EmbeddedSignup] Conexão Meta salva: ${displayPhone} (${verifiedName}) → funil ${funnel.name}`);

    return NextResponse.json({
      ok: true,
      connId,
      phone: displayPhone,
      verifiedName,
      webhookSubscribed: subData.success === true,
    });

  } catch (err) {
    console.error("[EmbeddedSignup] Erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
