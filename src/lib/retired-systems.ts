/** Old records remain in the migration/backup; retired modules have no active APIs. */
export function isRetiredApiPath(pathname: string): boolean {
  if (/^\/api\/(?:conectar(?:\/|$)|integrations\/whatsapp-(?:server|extension)(?:\/|$)|crm\/whatsapp(?:\/|$)|whatsapp\/(?:manager|wppconnect-manager)(?:\/|$))/.test(pathname)) return true;
  if (pathname.startsWith("/api/whatsapp/webhook") && !/^\/api\/whatsapp\/webhook\/evolution\/[^/]+$/.test(pathname)) return true;
  return /^\/api\/(?:pousada(?:\/|$)|guest-forms(?:\/|$)|servico-forms(?:\/|$)|whatsapp\/inbox\/(?:guest-form-link|servico-form-link)(?:\/|$))/.test(pathname);
}
export function stripRetiredReservationMarkers(text: string): string {
  return text.replace(/\[FORMULARIO_(?:HOSPEDAGEM|SERVICO)\]/gi, "").replace(/https?:\/\/[^\s]+\/formulario-(?:hospede|servico)\/[^\s]+/gi, "").trim();
}
