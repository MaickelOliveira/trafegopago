import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById, upsertClient } from "@/lib/clients";
import { createHash } from "crypto";

function hash(pw: string) {
  return createHash("sha256").update(pw).digest("hex");
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "client" || !session.clientId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const client = getClientById(session.clientId);
  if (!client) {
    return NextResponse.json({ error: "Cliente não encontrado" }, { status: 403 });
  }

  const body = await req.json();
  const patch: { passwordHash?: string; logoUrl?: string } = {};

  // Alterar senha
  if (body.currentPassword !== undefined || body.newPassword !== undefined) {
    const { currentPassword, newPassword } = body;
    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: "Informe a senha atual e a nova senha" }, { status: 400 });
    }
    if (hash(currentPassword) !== client.passwordHash) {
      return NextResponse.json({ error: "Senha atual incorreta" }, { status: 400 });
    }
    if (newPassword.length < 6) {
      return NextResponse.json({ error: "A nova senha deve ter ao menos 6 caracteres" }, { status: 400 });
    }
    patch.passwordHash = hash(newPassword);
  }

  // Atualizar logo
  if (body.logoUrl !== undefined) {
    patch.logoUrl = body.logoUrl || undefined;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
  }

  upsertClient({ ...client, ...patch });
  return NextResponse.json({ ok: true, logoUrl: patch.logoUrl ?? client.logoUrl ?? null });
}
