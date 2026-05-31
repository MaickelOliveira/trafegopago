import { NextResponse } from "next/server";
import { getLeads } from "@/lib/leads";

// GET /api/admin/debug-leads?name=Victor
// Mostra dados crus de leads filtrando por nome (parcial, case-insensitive)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get("name")?.toLowerCase();
  const phone = searchParams.get("phone");

  const all = getLeads();
  let filtered = all;

  if (name) {
    filtered = filtered.filter((l) => l.name.toLowerCase().includes(name));
  }
  if (phone) {
    const digits = phone.replace(/\D/g, "");
    filtered = filtered.filter((l) => l.phone.replace(/\D/g, "").includes(digits));
  }

  // Retorna campos relevantes para diagnóstico
  return NextResponse.json(
    filtered.map((l) => ({
      id: l.id,
      clientId: l.clientId,
      funnelId: l.funnelId,
      name: l.name,
      phone: l.phone,
      status: l.status,
      createdAt: l.createdAt,
    }))
  );
}
