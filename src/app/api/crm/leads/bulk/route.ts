import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteLead, updateLead } from "@/lib/leads";

/**
 * POST /api/crm/leads/bulk
 * Body: { action: "delete" | "move" | "ai", ids: string[], colId?: string, aiPaused?: boolean }
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (session.role !== "manager" && session.role !== "client" && session.role !== "employee")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { action, ids, colId, aiPaused } = body as {
    action: string;
    ids: string[];
    colId?: string;
    aiPaused?: boolean;
  };

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids obrigatório" }, { status: 400 });
  }

  if (action === "delete") {
    for (const id of ids) {
      try { deleteLead(id); } catch { /* ignora */ }
    }
    return NextResponse.json({ ok: true, deleted: ids.length });
  }

  if (action === "move") {
    if (!colId) return NextResponse.json({ error: "colId obrigatório para mover" }, { status: 400 });
    for (const id of ids) {
      try { updateLead(id, { status: colId }); } catch { /* ignora */ }
    }
    return NextResponse.json({ ok: true, moved: ids.length });
  }

  if (action === "ai") {
    for (const id of ids) {
      try { updateLead(id, { aiPaused: !!aiPaused }); } catch { /* ignora */ }
    }
    return NextResponse.json({ ok: true, updated: ids.length });
  }

  return NextResponse.json({ error: "action inválida" }, { status: 400 });
}
