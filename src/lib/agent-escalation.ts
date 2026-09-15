const INTERNAL_ESCALATION_NARRATION = new RegExp(
  String.raw`\b(?:` +
    String.raw`(?:j[áa]\s+)?(?:encaminhei|encaminhamos|repass(?:ei|amos)|passei|passamos|acionei|acionamos|avisei|avisamos|notifiquei|notificamos|escalei|escalamos|enviei|enviamos|chamei|chamamos|contatei|contatamos)` +
    String.raw`|(?:vou|irei|vamos|iremos)\s+(?:encaminhar|repassar|passar|acionar|avisar|notificar|escalar|enviar|chamar|contatar)` +
    String.raw`|ser[áa]\s+(?:encaminhad[ao]|repassad[ao]|enviad[ao])` +
  String.raw`)\b[\s\S]{0,240}\b(?:financeiro|jur[ií]dico|gestor(?:a)?|gerente|respons[aá]vel|equipe|time|setor|atendente|especialista|supervisor(?:a)?)\b`,
  "i",
);

const INTERNAL_STORAGE_NARRATION =
  /j[áa]\s+(?:registrei|salvei|anotei|gravei)\s+(?:a\s+|o\s+|os\s+|as\s+)?(?:dados|informaç(?:ão|ões)|sistema)/i;

export function isInternalEscalationNarration(text: string): boolean {
  return INTERNAL_ESCALATION_NARRATION.test(text);
}

export function isInternalActionNarration(text: string): boolean {
  return isInternalEscalationNarration(text) || INTERNAL_STORAGE_NARRATION.test(text);
}

export function buildInternalEscalationReason(userMessage: string): string {
  const context = userMessage.replace(/\s+/g, " ").trim();
  const shortened = context.length > 240 ? `${context.slice(0, 237)}...` : context;
  return shortened
    ? `ATENDIMENTO HUMANO: ${shortened}`
    : "ATENDIMENTO HUMANO: a IA indicou que a conversa precisa ser encaminhada à equipe";
}

export function inferInternalEscalationReason(input: {
  responseText: string;
  userMessage: string;
  hasRecipients: boolean;
  alreadyRequested: boolean;
}): string | null {
  if (!input.hasRecipients || input.alreadyRequested) return null;
  if (!isInternalEscalationNarration(input.responseText)) return null;
  return buildInternalEscalationReason(input.userMessage);
}
