import { patchClient } from "@/lib/clients";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClientById, upsertClient } from "@/lib/clients";
import bcrypt from "bcryptjs";

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "client" || !session.clientId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const client = (await getClientById(session.clientId));
  if (!client) {
    return NextResponse.json({ error: "Cliente não encontrado" }, { status: 403 });
  }

  const body = await req.json();
  const patch: { passwordHash?: string; logoUrl?: string } = {};

  // Alterar senha
  if (body.currentPassword !== undefined || body.newPassword !== undefined) {
    const { currentPassword, newPassword } = body;
    if (typeof currentPassword !== "string" || typeof newPassword !== "string" || Buffer.byteLength(currentPassword) > 72 || Buffer.byteLength(newPassword) > 72) {
      return NextResponse.json({ error: "Informe a senha atual e a nova senha" }, { status: 400 });
    }
    if (!await bcrypt.compare(currentPassword, client.passwordHash)) {
      return NextResponse.json({ error: "Senha atual incorreta" }, { status: 400 });
    }
    if (newPassword.length < 12) {
      return NextResponse.json({ error: "A nova senha deve ter ao menos 12 caracteres" }, { status: 400 });
    }
    patch.passwordHash = await bcrypt.hash(newPassword, 12);
  }

  // Atualizar logo
  if (body.logoUrl !== undefined) {
    patch.logoUrl = body.logoUrl || undefined;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
  }

  (await patchClient(client.id, { ...patch }));
  return NextResponse.json({ ok: true, logoUrl: patch.logoUrl ?? client.logoUrl ?? null });
}
