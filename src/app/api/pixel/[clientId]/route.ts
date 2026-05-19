import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/lib/clients";

// GET /api/pixel/{clientId} — serve o script de rastreamento para o site do cliente
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params;

  // Valida que o cliente existe
  const client = getClientById(clientId);
  if (!client) {
    return new NextResponse("// Cliente não encontrado", {
      status: 404,
      headers: { "Content-Type": "application/javascript" },
    });
  }

  const baseUrl = req.nextUrl.origin;

  const script = buildScript(clientId, baseUrl);

  return new NextResponse(script, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function buildScript(clientId: string, baseUrl: string): string {
  return `
(function(w, d) {
  if (w._tp) return;

  var clientId = ${JSON.stringify(clientId)};
  var endpoint = ${JSON.stringify(baseUrl + "/api/pixel/event")};

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
      if (hasAny) sessionStorage.setItem("_tp_utms", JSON.stringify(u));
    } catch(e) {}
  }

  function loadUTMs() {
    try { return JSON.parse(sessionStorage.getItem("_tp_utms") || "{}"); }
    catch(e) { return {}; }
  }

  function send(data) {
    var payload = Object.assign({ clientId: clientId, url: w.location.href }, loadUTMs(), data);
    try {
      navigator.sendBeacon
        ? navigator.sendBeacon(endpoint, JSON.stringify(payload))
        : fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), keepalive: true }).catch(function(){});
    } catch(e) {}
  }

  // ── Rastreamento automático ───────────────────────────────────────────────────

  function extractPhone(href) {
    var m = href.match(/wa\\.me\\/(\\d+)/) || href.match(/phone=(\\d+)/);
    return m ? m[1] : null;
  }

  function trackWhatsAppLinks() {
    d.querySelectorAll('a[href*="wa.me"], a[href*="whatsapp.com/send"], a[href*="api.whatsapp.com"]').forEach(function(el) {
      el.addEventListener("click", function() {
        var phone = extractPhone(el.href);
        if (phone) send({ event: "WhatsAppClick", phone: phone, source: "whatsapp_click" });
      });
    });
  }

  function getFieldValue(form, names) {
    for (var i = 0; i < names.length; i++) {
      var el = form.querySelector('[name*="' + names[i] + '"], [id*="' + names[i] + '"]');
      if (el && el.value) return el.value;
    }
    return null;
  }

  function trackForms() {
    d.querySelectorAll("form").forEach(function(form) {
      // Só rastreia formulários que têm campo de telefone
      var hasPhone = form.querySelector('input[type="tel"], [name*="phone"], [name*="tel"], [name*="whatsapp"], [name*="fone"], [name*="celular"]');
      if (!hasPhone) return;
      form.addEventListener("submit", function() {
        var phone = getFieldValue(form, ["phone","tel","whatsapp","fone","celular","telefone"]);
        var name  = getFieldValue(form, ["name","nome","first_name","firstname"]);
        var email = getFieldValue(form, ["email","e-mail"]);
        if (phone) send({ event: "FormSubmit", phone: phone, name: name, email: email, source: "form" });
      });
    });
  }

  // ── API pública ───────────────────────────────────────────────────────────────

  w._tp = {
    // Identifica manualmente um lead (ex: após preenchimento de form custom)
    identify: function(phone, data) {
      send(Object.assign({ event: "Lead", phone: phone, source: "manual" }, data || {}));
    },
    // Registra evento customizado
    track: function(eventName, data) {
      send(Object.assign({ event: eventName }, data || {}));
    },
  };

  // ── Inicialização ─────────────────────────────────────────────────────────────

  saveUTMs();
  send({ event: "PageView" });

  if (d.readyState === "loading") {
    d.addEventListener("DOMContentLoaded", function() {
      trackWhatsAppLinks();
      trackForms();
    });
  } else {
    trackWhatsAppLinks();
    trackForms();
  }

})(window, document);
`.trim();
}
