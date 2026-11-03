import { describe, expect, it } from "vitest";
import { isRetiredApiPath, stripRetiredReservationMarkers } from "../retired-systems";
describe("retired booking module", () => {
 it.each(["/api/whatsapp/manager", "/api/whatsapp/wppconnect-manager/id/status", "/api/whatsapp/webhook/wppconnect/channel", "/api/crm/whatsapp/setup", "/api/conectar/old", "/api/integrations/whatsapp-server", "/api/integrations/whatsapp-extension/messages", "/api/pousada/reservas", "/api/pousada/config", "/api/guest-forms/legacy", "/api/servico-forms/legacy", "/api/whatsapp/inbox/guest-form-link", "/api/whatsapp/inbox/servico-form-link"])("disables the old surface %s", path => expect(isRetiredApiPath(path)).toBe(true));
 it.each(["/api/agent", "/api/agent/google-auth", "/api/crm/leads", "/api/crm/automations", "/api/whatsapp/webhook/evolution/channel"])("keeps general service and AI paths %s available", path => expect(isRetiredApiPath(path)).toBe(false));
 it("removes retired form markers and links without dropping ordinary answers", () => {
  expect(stripRetiredReservationMarkers("Olá! [FORMULARIO_HOSPEDAGEM] [FORMULARIO_SERVICO]")).toBe("Olá!");
  expect(stripRetiredReservationMarkers("Olá https://example.invalid/formulario-hospede/old-token")).toBe("Olá");
  expect(stripRetiredReservationMarkers("Seu agendamento pode ser feito com nossa equipe.")).toBe("Seu agendamento pode ser feito com nossa equipe.");
 });
});
