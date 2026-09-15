import { describe, expect, it } from "vitest";
import {
  buildInternalEscalationReason,
  inferInternalEscalationReason,
  isInternalActionNarration,
  isInternalEscalationNarration,
} from "../agent-escalation";

describe("agent escalation narration", () => {
  it("detecta a promessa de encaminhamento ao financeiro usada na conversa da JDF", () => {
    const response =
      "Compreendo a situação. Vou encaminhar este comunicado e as informações de pagamento " +
      "imediatamente para o nosso financeiro, que entrará em contato com você diretamente.";

    expect(isInternalEscalationNarration(response)).toBe(true);
  });

  it("detecta escalonamentos já realizados e na voz passiva", () => {
    expect(isInternalEscalationNarration("Já acionei o setor jurídico para verificar o caso.")).toBe(true);
    expect(isInternalEscalationNarration("Já contatei a equipe responsável.")).toBe(true);
    expect(isInternalEscalationNarration("Sua solicitação será encaminhada para a gerente responsável.")).toBe(true);
  });

  it("não confunde o envio normal de documentos ao próprio contato com escalonamento", () => {
    expect(isInternalEscalationNarration("Vou enviar o boleto para você agora.")).toBe(false);
    expect(isInternalEscalationNarration("Encaminhei o endereço e os horários disponíveis.")).toBe(false);
  });

  it("mantém o filtro antigo para narração de armazenamento interno", () => {
    expect(isInternalActionNarration("Já registrei os dados no sistema.")).toBe(true);
    expect(isInternalEscalationNarration("Já registrei os dados no sistema.")).toBe(false);
  });

  it("monta um motivo curto com o conteúdo enviado pelo contato", () => {
    const reason = buildInternalEscalationReason("  Preciso regularizar   os pagamentos pendentes.  ");

    expect(reason).toBe("ATENDIMENTO HUMANO: Preciso regularizar os pagamentos pendentes.");
    expect(buildInternalEscalationReason("x".repeat(300))).toHaveLength(260);
  });

  it("infere o aviso apenas quando há destinatário e ainda não houve disparo", () => {
    const input = {
      responseText: "Vou encaminhar os dados ao nosso financeiro.",
      userMessage: "Segue o comunicado sobre os pagamentos.",
      hasRecipients: true,
      alreadyRequested: false,
    };

    expect(inferInternalEscalationReason(input)).toBe(
      "ATENDIMENTO HUMANO: Segue o comunicado sobre os pagamentos.",
    );
    expect(inferInternalEscalationReason({ ...input, hasRecipients: false })).toBeNull();
    expect(inferInternalEscalationReason({ ...input, alreadyRequested: true })).toBeNull();
  });
});
