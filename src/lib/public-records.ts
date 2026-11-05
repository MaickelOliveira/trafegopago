import type { Funnel } from "./funnels";
import type { WabaTemplate } from "./waba-templates";
export function publicFunnel(funnel: Funnel): Funnel {
  return { ...funnel, connections: funnel.connections?.map(connection => ({ id: connection.id, phone: connection.phone, type: connection.type, metaPhoneNumberId: connection.metaPhoneNumberId })) };
}
export function publicTemplate<T extends WabaTemplate | null>(template: T): T {
  return template ? { ...template, metaToken: undefined } : template;
}
