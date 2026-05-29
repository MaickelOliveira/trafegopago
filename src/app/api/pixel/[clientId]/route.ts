import { NextRequest, NextResponse } from "next/server";
import { getClientById, getConfig } from "@/lib/clients";

export const dynamic = "force-dynamic";

// GET /api/pixel/{clientId} — serve o script de rastreamento para o site do cliente
// URL sempre limpa: <script src="/api/pixel/sbcie"></script>
// Google Ads ID, label e Pixel Meta vêm do config do cliente (Configurações).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId: rawId } = await params;
  const clientId = rawId.replace(/\.js$/, ""); // suporta nexo.js ou nexo

  const client = getClientById(clientId);
  if (!client) {
    return new NextResponse(`console.error('[Pixel] Cliente "${clientId}" não encontrado.');`, {
      status: 404,
      headers: { "Content-Type": "application/javascript" },
    });
  }

  // Usa appBaseUrl do config (URL pública) se disponível — evita hostname interno do Docker
  const appConfig = getConfig();
  const baseUrl   = appConfig.appBaseUrl?.replace(/\/$/, "") || req.nextUrl.origin;
  const pixelId   = client.pixelId        ?? "";
  const gadsId    = client.googleAdsId    ?? "";
  const gadsLabel = client.googleConvLabel ?? "";

  const script = buildScript({ clientId, baseUrl, pixelId, gadsId, gadsLabel });

  return new NextResponse(script, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

interface ScriptConfig {
  clientId:  string;
  baseUrl:   string;
  pixelId:   string;
  gadsId:    string;
  gadsLabel: string;
}

function buildScript(cfg: ScriptConfig): string {
  const { clientId, baseUrl, pixelId, gadsId, gadsLabel } = cfg;
  return `
(function(w, d) {
  if (w._tp) return;

  var _cfg = {
    clientId:         ${JSON.stringify(clientId)},
    pixelId:          ${JSON.stringify(pixelId)},
    gadsId:           ${JSON.stringify(gadsId)},
    gadsLabel:        ${JSON.stringify(gadsLabel)},
    eventEndpoint:    ${JSON.stringify(baseUrl + "/api/pixel/event")},
    redirectEndpoint: ${JSON.stringify(baseUrl + "/api/wa-redirect")},
  };

  // ── Utilitários ──────────────────────────────────────────────────────────────

  function getUTMs() {
    var p = new URLSearchParams(w.location.search);
    return {
      utmSource:   p.get("utm_source"),
      utmMedium:   p.get("utm_medium"),
      utmCampaign: p.get("utm_campaign"),
      utmContent:  p.get("utm_content"),
      utmTerm:     p.get("utm_term"),
      fbclid:      p.get("fbclid"),
      gclid:       p.get("gclid"),
    };
  }

  function saveUTMs() {
    try {
      var u = getUTMs();
      var hasAny = Object.values(u).some(function(v) { return v != null; });
      if (hasAny) sessionStorage.setItem("_tp_utms_" + _cfg.clientId, JSON.stringify(u));
    } catch(e) {}
  }

  function loadUTMs() {
    try { return JSON.parse(sessionStorage.getItem("_tp_utms_" + _cfg.clientId) || "{}"); }
    catch(e) { return {}; }
  }

  function sendEvent(data) {
    var payload = Object.assign({ clientId: _cfg.clientId, url: w.location.href }, loadUTMs(), data);
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(_cfg.eventEndpoint, JSON.stringify(payload));
      } else {
        fetch(_cfg.eventEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), keepalive: true }).catch(function(){});
      }
    } catch(e) {}
  }

  // ── Disparo de pixels ─────────────────────────────────────────────────────────
  // NOTA: Meta Pixel "Lead" NÃO é disparado aqui — ele só dispara via CAPI no servidor
  // quando o lead entra de fato no CRM (1ª mensagem recebida no WhatsApp).
  // Isso evita contabilizar quem clicou mas desistiu antes de enviar mensagem.

  function firePixels(utms) {
    // Google Ads — dispara no clique (padrão do mercado para conversão de clique em WA)
    if (w.gtag && _cfg.gadsId && _cfg.gadsLabel) {
      gtag("event", "conversion", { send_to: _cfg.gadsId + "/" + _cfg.gadsLabel });
    }
    void utms; // utms disponível para uso futuro (ex: enhanced conversions)
  }

  // ── Rastreamento automático de links wa.me ────────────────────────────────────

  function extractPhone(href) {
    var m = href.match(/wa\\.me\\/(\\d+)/) || href.match(/phone=(\\d+)/);
    return m ? m[1] : null;
  }

  function trackWhatsAppLinks() {
    d.querySelectorAll('a[href*="wa.me"], a[href*="whatsapp.com/send"], a[href*="api.whatsapp.com"]').forEach(function(el) {
      if (el.hasAttribute("data-wa-track")) return; // tratado pelo handler de data-wa-track
      el.addEventListener("click", function() {
        var utms = loadUTMs();
        firePixels(utms);
        sendEvent({ event: "WhatsAppClick", source: "whatsapp_click" });
      });
    });
  }

  // ── Botões com data-wa-track → redirect limpo (UTMs no servidor) ──────────────
  // O telefone e a mensagem ficam nos atributos do botão, não na URL do pixel:
  //   <a href="#" data-wa-track data-wa-phone="5544..." data-wa-msg="Olá!">Falar</a>

  function onWaTrackClick(e) {
    if (e && e.preventDefault) e.preventDefault();

    var el    = e.currentTarget || e.target;
    var phone = (el.getAttribute("data-wa-phone") || "").replace(/\\D/g, "");
    var msg   = el.getAttribute("data-wa-msg") || "";

    if (!phone) {
      console.warn("[Pixel] data-wa-phone não encontrado no botão.");
      return;
    }

    var utms = loadUTMs();
    firePixels(utms);

    var url = _cfg.redirectEndpoint
      + "?clientId=" + encodeURIComponent(_cfg.clientId)
      + "&phone="    + encodeURIComponent(phone)
      + "&msg="      + encodeURIComponent(msg);

    if (utms.utmSource)   url += "&src=" + encodeURIComponent(utms.utmSource);
    if (utms.utmCampaign) url += "&cmp=" + encodeURIComponent(utms.utmCampaign);
    if (utms.utmMedium)   url += "&med=" + encodeURIComponent(utms.utmMedium);
    if (utms.utmContent)  url += "&cnt=" + encodeURIComponent(utms.utmContent);
    if (utms.utmTerm)     url += "&trm=" + encodeURIComponent(utms.utmTerm);
    if (utms.fbclid)      url += "&fbc=" + encodeURIComponent(utms.fbclid);
    if (utms.gclid)       url += "&gcd=" + encodeURIComponent(utms.gclid);

    setTimeout(function() { w.open(url, "_blank"); }, 300);
  }

  function bindWaTrackButtons() {
    d.querySelectorAll("[data-wa-track]").forEach(function(el) {
      el.addEventListener("click", onWaTrackClick);
    });
  }

  // ── Formulários com telefone ──────────────────────────────────────────────────

  function getFieldValue(form, names) {
    for (var i = 0; i < names.length; i++) {
      var el = form.querySelector('[name*="' + names[i] + '"], [id*="' + names[i] + '"]');
      if (el && el.value) return el.value;
    }
    return null;
  }

  function trackForms() {
    d.querySelectorAll("form").forEach(function(form) {
      var hasPhone = form.querySelector('input[type="tel"], [name*="phone"], [name*="tel"], [name*="whatsapp"], [name*="fone"], [name*="celular"]');
      if (!hasPhone) return;
      form.addEventListener("submit", function() {
        var phone = getFieldValue(form, ["phone","tel","whatsapp","fone","celular","telefone"]);
        var name  = getFieldValue(form, ["name","nome","first_name","firstname"]);
        var email = getFieldValue(form, ["email","e-mail"]);
        if (phone) sendEvent({ event: "FormSubmit", phone: phone, name: name, email: email, source: "form" });
      });
    });
  }

  // ── API pública ───────────────────────────────────────────────────────────────

  w._tp = {
    identify: function(phone, data) {
      sendEvent(Object.assign({ event: "Lead", phone: phone, source: "manual" }, data || {}));
    },
    track: function(eventName, data) {
      sendEvent(Object.assign({ event: eventName }, data || {}));
    },
    // Dispara o fluxo WhatsApp via data-wa-track manualmente
    openWa: onWaTrackClick,
  };

  // ── Inicialização ─────────────────────────────────────────────────────────────

  saveUTMs();
  sendEvent({ event: "PageView" });

  if (d.readyState === "loading") {
    d.addEventListener("DOMContentLoaded", function() {
      trackWhatsAppLinks();
      bindWaTrackButtons();
      trackForms();
    });
  } else {
    trackWhatsAppLinks();
    bindWaTrackButtons();
    trackForms();
  }

})(window, document);
`.trim();
}
