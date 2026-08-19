import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";

export type ServicoFormStatus = "pending" | "submitted";

export type ServicoFormPessoa = {
  nome: string;
  telefone: string;
  idade: number;
};

// Ficha de participantes preenchida pelo próprio cliente por um link público —
// mesma ideia de guest-forms.ts (hospedagem), mas simplificada pra Day Use,
// Almoço e qualquer outro tipo de serviço (categoria "evento") cadastrado
// dinamicamente em client.pousadaTipos: só nome, telefone e idade de cada
// participante, sem CPF/RG/endereço. Depois de enviado, o texto vira uma
// mensagem sintética na MESMA conversa do WhatsApp (ver
// /api/servico-forms/[token] POST), e a IA processa normalmente como se o
// cliente tivesse digitado os dados.
export type ServicoFormConnType = "uazapi" | "evolution" | "wppconnect";

export type ServicoForm = {
  id: string; // token — usado na URL pública
  clientId: string;
  clientName?: string;
  phone: string; // telefone do contato no WhatsApp (dígitos)
  connId?: string | null;
  connType?: ServicoFormConnType | null;
  // Serviço (slug de client.pousadaTipos) escolhido ao gerar o link — sem
  // isso, a extração da reserva ficava dependendo da IA conversacional
  // adivinhar o tipo certo pelo contexto, e podia simplesmente não escrever
  // reserva nenhuma. Com o tipo fixado aqui, a extração fica determinística.
  tipoSlug?: string;
  tipoLabel?: string;
  status: ServicoFormStatus;
  pessoas?: ServicoFormPessoa[];
  createdAt: string;
  submittedAt?: string;
};

const FILE = path.join(process.cwd(), "data", "servico-forms.json");

function load(): ServicoForm[] {
  try {
    if (!existsSync(FILE)) return [];
    return JSON.parse(readFileSync(FILE, "utf-8")) as ServicoForm[];
  } catch {
    return [];
  }
}

function save(forms: ServicoForm[]) {
  const dir = path.dirname(FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(FILE, JSON.stringify(forms, null, 2));
}

export function createServicoForm(data: Omit<ServicoForm, "id" | "status" | "createdAt">): ServicoForm {
  const forms = load();
  const form: ServicoForm = {
    ...data,
    id: randomUUID(),
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  forms.unshift(form);
  save(forms);
  return form;
}

export function getServicoFormByToken(token: string): ServicoForm | undefined {
  return load().find((f) => f.id === token);
}

export function submitServicoForm(token: string, pessoas: ServicoFormPessoa[]): ServicoForm | null {
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
