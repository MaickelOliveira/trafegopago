import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";

export type GuestFormStatus = "pending" | "submitted";

export type GuestFormPessoa = {
  nome: string;
  nascimento?: string;
  cpf?: string;
  rg?: string;
  endereco?: string;
  cidadeEstado?: string;
  telefone?: string;
  email?: string;
};

// Ficha de hóspedes preenchida pelo próprio cliente por um link público — evita
// que a IA precise coletar CPF/RG/endereço de cada hóspede mensagem por
// mensagem no chat. Depois de enviado, o texto vira uma mensagem sintética na
// MESMA conversa do WhatsApp (ver /api/guest-forms/[token] POST), e a IA
// processa normalmente como se o cliente tivesse digitado os dados.
// "connType" define qual URL de webhook usar pra retomar a conversa depois do
// envio (ver /api/guest-forms/[token] POST) — cada provider tem um formato de
// rota diferente (/api/whatsapp/webhook/{connId} pro uazapi/[instanceId],
// /api/whatsapp/webhook/evolution/{connId} pro Evolution, etc.).
export type GuestFormConnType = "uazapi" | "evolution" | "wppconnect";

export type GuestForm = {
  id: string; // token — usado na URL pública
  clientId: string;
  clientName?: string;
  phone: string; // telefone do contato no WhatsApp (dígitos)
  connId?: string | null; // connection.id — usado pra retomar a conversa na conexão certa
  connType?: GuestFormConnType | null;
  status: GuestFormStatus;
  pessoas?: GuestFormPessoa[];
  createdAt: string;
  submittedAt?: string;
};

const FILE = path.join(process.cwd(), "data", "guest-forms.json");

function load(): GuestForm[] {
  try {
    if (!existsSync(FILE)) return [];
    return JSON.parse(readFileSync(FILE, "utf-8")) as GuestForm[];
  } catch {
    return [];
  }
}

function save(forms: GuestForm[]) {
  const dir = path.dirname(FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(FILE, JSON.stringify(forms, null, 2));
}

export function createGuestForm(data: Omit<GuestForm, "id" | "status" | "createdAt">): GuestForm {
  const forms = load();
  const form: GuestForm = {
    ...data,
    id: randomUUID(),
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  forms.unshift(form);
  save(forms);
  return form;
}

export function getGuestFormByToken(token: string): GuestForm | undefined {
  return load().find((f) => f.id === token);
}

export function submitGuestForm(token: string, pessoas: GuestFormPessoa[]): GuestForm | null {
  const forms = load();
  const idx = forms.findIndex((f) => f.id === token);
  if (idx === -1) return null;
  forms[idx] = {
    ...forms[idx],
    status: "submitted",
    pessoas,
    submittedAt: new Date().toISOString(),
  };
  save(forms);
  return forms[idx];
}
