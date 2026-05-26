import { NextRequest, NextResponse } from "next/server";
import { getFunnels } from "@/lib/funnels";
import { upsertLeadByPhone, getLeadByPhone } from "@/lib/leads";
import { addMessage, getHistory } from "@/lib/conversations";
import { runGeminiAgent } from "@/lib/gemini-agent";

// GET — verificação do webhook Meta
export async function GET(req: NextRequest) {
  const mode  = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");

  if (mode === "subscribe") {
    // Aceita qualquer verify_token — cada funil pode ter o seu
    const funnels = getFunnels();
    const matched = funnels.some(f =>
      f.connections?.some(c => c.type === "meta" && c.metaVerifyToken === token)
    );
    if (matched && challenge) return new NextResponse(challenge, { status: 200 });
    // Fallback: aceita "trafegopago" como token padrão
    if (token === "trafegopago" && challenge) return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// POST — recebe mensagens da Meta
export async function POST(req: NextRequest) {
  const body = await req.json();

  const entries = body.entry ?? [];
  for (const entry of entries) {
    for (const change of (entry.changes ?? [])) {
      if (change.field !== "messages") continue;
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;

      // Encontra funil pela phoneNumberId
      const funnels = getFunnels();
      let funnelId: string | null = null;
      let clientId: string | null = null;
      let metaToken: string | null = null;
      let connId: string | null = null;

      for (const f of funnels) {
        const conn = f.connections?.find(c => c.type === "meta" && c.metaPhoneNumberId === phoneNumberId);
        if (conn) { funnelId = f.id; clientId = f.clientId ?? null; metaToken = conn.metaToken ?? null; connId = conn.id; break; }
      }

      for (const msg of (value?.messages ?? [])) {
        const phone = msg.from?.replace(/\D/g, "");
        const text = msg.text?.body || msg.button?.text || "";
        if (!phone || !text.trim()) continue;
        const pushName = value?.contacts?.find((c: { wa_id: string }) => c.wa_id === msg.from)?.profile?.name ?? phone;
        const fromMe = false;
        const cid = clientId ?? "sem-cliente";
        const ts = Date.now();

        const isNew = !getLeadByPhone(cid, phone);
        upsertLeadByPhone(cid, phone, {
          clientId: cid,
          funnelId: funnelId ?? "default",
          source: "whatsapp",
          name: pushName,
          ...(isNew ? { status: "entrada" } : {}),
        });

        addMessage(phone, { role: "user", content: text, ts }, clientId);

        // Resposta IA via Gemini (mesmo agente do webhook UazAPI)
        const history = getHistory(phone);
        const { text: reply } = await runGeminiAgent(text, history, cid, phone, connId ?? undefined);
        if (reply && metaToken && phoneNumberId) {
          addMessage(phone, { role: "assistant", content: reply, ts: ts + 1 }, clientId);
          // Envia via Meta API
          await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${metaToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ messaging_product: "whatsapp", to: phone, type: "text", text: { body: reply } }),
          }).catch(() => {});
        }
      }
    }
  }
  return NextResponse.json({ ok: true });
}
