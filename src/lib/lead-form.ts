import { normalizeAgentPhone } from "./agent-phone-policy";

const labels: Record<string, string> = {
  servicos: "Serviços", servico: "Serviço", orcamento: "Orçamento",
  observacoes: "Observações", endereco: "Endereço", descricao: "Descrição",
  email: "E-mail", utm_source: "Origem UTM", utm_medium: "Mídia UTM", utm_campaign: "Campanha UTM",
  utm_content: "Conteúdo UTM", utm_term: "Termo UTM", campaign_name: "Campanha", campaign_id: "ID da campanha",
  ad_name: "Anúncio", ad_id: "ID do anúncio", ad_set_name: "Conjunto de anúncios", ad_set_id: "ID do conjunto",
  form_id: "ID do formulário", page_id: "ID da página", fbclid: "Identificador de clique Meta",
  gclid: "Identificador de clique Google", fbp: "Identificador do navegador Meta",
};

function fieldKey(key: string) {
  return key.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
}

function label(key: string): string {
  const words = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
  return labels[fieldKey(key)] ?? (words.charAt(0).toLocaleUpperCase("pt-BR") + words.slice(1));
}

function answer(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(answer).filter(Boolean).join(", ");
  if (typeof value === "object") {
    return Object.entries(value).map(([key, entry]) => {
      const text = answer(entry);
      return text && `${label(key)}: ${text}`;
    }).filter(Boolean).join("\n");
  }
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  return String(value).trim();
}

export function formFields(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Formulário inválido");
  return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, answer(v)]));
}

export function leadChatNumber(raw: string): string {
  const digits = normalizeAgentPhone(raw);
  const international = /^\s*(?:\+|00)/.test(raw);
  // Formulários brasileiros normalmente pedem DDD + número, sem DDI.
  if (!/^\+?[\d .()-]+$/.test(raw.trim())) return "";
  if (!international && digits.length < 10) return "";
  const national = !international && /^0[1-9]\d{9,10}$/.test(digits) ? digits.slice(1) : digits;
  const phone = !international && /^\d{10,11}$/.test(national) ? "55" + national : national;
  return /^[1-9]\d{7,14}$/.test(phone) ? phone : "";
}

export type LeadForm = {
  source: string;
  name: string;
  phone: string;
  email?: string | null;
  fields: Record<string, string>;
  mappedKeys?: string[];
};

export function leadFormMessage(form: LeadForm, createdInCrm = false): string {
  const phone = leadChatNumber(form.phone);
  const contactKeys = new Set([
    "phone", "whatsapp", "telefone", "celular", "phone_number", "your-phone",
    "name", "nome", "nome completo", "e-mail", "full_name", "your-name", "email", "your-email", ...(form.mappedKeys ?? []),
  ]);
  const displayed = new Set([form.name, form.phone, form.email]);
  const answers: string[] = [];
  const attribution: string[] = [];
  for (const [key, value] of Object.entries(form.fields)) {
    if (/^(submission_id|form_position|consent|consentimento_medicao|enviado_em|pagina_origem|formulario|fbclid|gclid|fbp|fbc|gbraid|wbraid|client_ip|user_agent)$/i.test(fieldKey(key))) continue;
    if (!value || key === "funnelId" || (contactKeys.has(fieldKey(key)) && (displayed.has(value) || (phone && leadChatNumber(value) === phone)))) continue;
    const section = /^(utm_|fbclid$|fbp$|gclid$|campanha$|campaign_|ad_|form_id$|page_id$)/.test(fieldKey(key)) ? attribution : answers;
    section.push(`• ${label(key)}: ${value}`);
  }
  return [
    createdInCrm ? "📋 *Novo lead no CRM*" : "📋 *Novo lead de formulário*",
    [`*Nome:* ${form.name}`, form.phone && `*Telefone:* ${form.phone}`, form.email && `*E-mail:* ${form.email}`].filter(Boolean).join("\n"),
    phone && `*Conversar no WhatsApp*\nhttps://wa.me/${phone}`,
    answers.length && `*Respostas do formulário*\n${answers.join("\n")}`,
    [`*Origem:* ${form.source}`, ...attribution].join("\n"),
  ].filter(Boolean).join("\n\n");
}

export function splitLeadMessage(text: string, limit: number): string[] {
  const parts: string[] = [];
  while (text.length > limit) {
    const lastLine = text.lastIndexOf("\n", limit - 1);
    let cut = lastLine > 0 ? lastLine + 1 : limit;
    if (cut === limit && /[\uD800-\uDBFF]/.test(text.charAt(cut - 1))) cut--;
    parts.push(text.slice(0, cut).trimEnd());
    text = text.slice(cut);
  }
  if (text) parts.push(text);
  return parts;
}
