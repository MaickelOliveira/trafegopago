import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConfig } from "@/lib/clients";

const VALID_EVENT_TYPES = [
  "LEAD", "COMPLETE_REGISTRATION", "PURCHASE", "INITIATE_CHECKOUT",
  "ADD_TO_CART", "VIEW_CONTENT", "CONTACT", "SCHEDULE", "SUBSCRIBE",
  "ADD_TO_WISHLIST", "ADD_PAYMENT_INFO", "SEARCH", "OTHER",
];

// GET — lista custom conversions de uma conta
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adAccountId = req.nextUrl.searchParams.get("adAccountId");
  if (!adAccountId) return NextResponse.json({ error: "adAccountId required" }, { status: 400 });

  const { metaToken } = getConfig();
  if (!metaToken) return NextResponse.json({ error: "Meta token não configurado" }, { status: 400 });

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${adAccountId}/customconversions?fields=id,name,custom_event_type,pixel&access_token=${metaToken}`
  );
  const data = await res.json();
  if (!res.ok) return NextResponse.json({ error: data.error?.message ?? "Erro Meta API" }, { status: 502 });

  return NextResponse.json(data.data ?? []);
}

// POST — cria uma custom conversion na conta do Meta
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { adAccountId, name, customEventType, pixelId } = body as {
    adAccountId?: string;
    name?: string;
    customEventType?: string;
    pixelId?: string;
  };

  if (!adAccountId || !name || !customEventType || !pixelId) {
    return NextResponse.json({ error: "adAccountId, name, customEventType e pixelId são obrigatórios" }, { status: 400 });
  }
  if (!VALID_EVENT_TYPES.includes(customEventType)) {
    return NextResponse.json({ error: `customEventType inválido. Use: ${VALID_EVENT_TYPES.join(", ")}` }, { status: 400 });
  }

  const { metaToken } = getConfig();
  if (!metaToken) return NextResponse.json({ error: "Meta token não configurado" }, { status: 400 });

  const formData = new URLSearchParams({
    name,
    custom_event_type: customEventType,
    pixel_id: pixelId,
    access_token: metaToken,
  });

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${adAccountId}/customconversions`,
    { method: "POST", body: formData }
  );
  const data = await res.json();
  if (!res.ok) return NextResponse.json({ error: data.error?.message ?? "Erro Meta API" }, { status: 502 });

  return NextResponse.json({ id: data.id, name });
}
