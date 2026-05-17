import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConfig, saveConfig, getClients, saveClients } from "@/lib/clients";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { appBaseUrl, clientId } = await req.json();
  if (!appBaseUrl) return NextResponse.json({ error: "appBaseUrl obrigatório" }, { status: 400 });

  const config = getConfig();
  if (!config.uazapiServer || !config.uazapiToken) {
    return NextResponse.json({ error: "UazAPI não configurado" }, { status: 400 });
  }

  const webhookUrl = `${appBaseUrl.replace(/\/$/, "")}/api/whatsapp/webhook`;

  // Busca webhook atual para salvar como forward
  const currentRes = await fetch(`${config.uazapiServer}/webhook`, {
    headers: { token: config.uazapiToken },
  });
  const current = currentRes.ok ? await currentRes.json() : [];
  const currentUrl = Array.isArray(current) && current[0]?.url ? current[0].url : null;

  // Busca webhooks atuais para encontrar o slot vazio (slot 2) sem sobrescrever n8n
  const existingRes = await fetch(`${config.uazapiServer}/webhook`, {
    headers: { token: config.uazapiToken },
  });
  const existingWebhooks: { id: string; url: string; enabled: boolean }[] =
    existingRes.ok ? await existingRes.json() : [];

  // Verifica se a plataforma já está em algum slot
  const alreadyConfigured = existingWebhooks.find((w) => w.url === webhookUrl);
  // Slot vazio disponível (sem URL ou com a URL antiga da plataforma)
  const emptySlot = existingWebhooks.find(
    (w) => !w.url || w.url === webhookUrl || (!w.enabled && !w.url)
  );

  // Se já está configurado, não faz nada; senão usa o slot vazio ou POST normal
  if (!alreadyConfigured) {
    // POST sempre cria/atualiza o primeiro slot disponível sem URL
    // Para preservar o n8n, atualizamos apenas o slot vazio (id do slot 2)
    const targetId = emptySlot && emptySlot.url !== webhookUrl ? emptySlot.id : null;
    const endpoint = targetId
      ? `${config.uazapiServer}/webhook/${targetId}`
      : `${config.uazapiServer}/webhook`;

    const setRes = await fetch(endpoint, {
      method: "POST",
      headers: { token: config.uazapiToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        events: ["messages"],
        excludeMessages: ["wasSentByApi", "isGroupYes"],
        enabled: true,
      }),
    });

    if (!setRes.ok) {
      return NextResponse.json({ error: "Erro ao configurar webhook no UazAPI" }, { status: 502 });
    }
  }

  // Busca o número conectado na instância para salvar no cliente
  let connectedPhone: string | null = null;
  try {
    const statusRes = await fetch(`${config.uazapiServer}/instance/status`, {
      headers: { token: config.uazapiToken },
    });
    if (statusRes.ok) {
      const st = await statusRes.json();
      const raw = st.phone ?? st.number ?? st.jid ?? null;
      if (raw) connectedPhone = String(raw).replace(/\D/g, "");
    }
  } catch { /* ignora */ }

  // Salva whatsappPhone no cliente informado
  if (clientId && connectedPhone) {
    const clients = getClients();
    const updated = clients.map((c) =>
      c.id === clientId ? { ...c, whatsappPhone: connectedPhone! } : c
    );
    saveClients(updated);
  }

  // Salva configuração
  const updatedConfig = {
    ...config,
    appBaseUrl,
    uazapiWebhookForward: currentUrl && currentUrl !== webhookUrl ? currentUrl : config.uazapiWebhookForward,
  };
  saveConfig(updatedConfig);

  return NextResponse.json({
    ok: true,
    webhookUrl,
    connectedPhone,
    forwarding: updatedConfig.uazapiWebhookForward ?? null,
  });
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const config = getConfig();
  return NextResponse.json({
    appBaseUrl: config.appBaseUrl ?? null,
    webhookForward: config.uazapiWebhookForward ?? null,
    webhookUrl: config.appBaseUrl ? `${config.appBaseUrl}/api/whatsapp/webhook` : null,
  });
}
