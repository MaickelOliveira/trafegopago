import { NextRequest, NextResponse } from "next/server";
import { getFunnels } from "@/lib/funnels";

export const dynamic = "force-dynamic";

export type WabaConnection = {
  phoneNumberId: string;
  phone: string;
  funnelName: string;
};

/** GET /api/waba/connections?clientId=xxx — lista contas Meta (WABA) do cliente */
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json([], { status: 200 });

  const funnels = getFunnels().filter((f) => f.clientId === clientId);
  const connections: WabaConnection[] = funnels.flatMap((f) =>
    (f.connections ?? [])
      .filter((c) => c.type === "meta" && c.metaPhoneNumberId)
      .map((c) => ({
        phoneNumberId: c.metaPhoneNumberId!,
        phone: c.phone ?? c.metaPhoneNumberId!,
        funnelName: f.name,
      })),
  );

  // Deduplicate by phoneNumberId (keep first occurrence)
  const seen = new Set<string>();
  const unique = connections.filter((c) => {
    if (seen.has(c.phoneNumberId)) return false;
    seen.add(c.phoneNumberId);
    return true;
  });

  return NextResponse.json(unique);
}
