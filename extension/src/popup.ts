import { PLATFORM_BASE_URL } from "./config";
import type { PopupState, PopupToBackgroundMessage, BackgroundToPopupMessage } from "./types";

const dot = document.getElementById("status-dot")!;
const label = document.getElementById("status-label")!;
const content = document.getElementById("content")!;
const privacyLink = document.getElementById("privacy-link") as HTMLAnchorElement;

privacyLink.href = `${PLATFORM_BASE_URL}/privacidade/extensao-whatsapp`;
privacyLink.target = "_blank";

function send(message: PopupToBackgroundMessage): Promise<BackgroundToPopupMessage> {
  return chrome.runtime.sendMessage(message);
}

function openWhatsApp() {
  chrome.tabs.create({ url: "https://web.whatsapp.com/" });
}

function openPlatform() {
  chrome.tabs.create({ url: `${PLATFORM_BASE_URL}/cliente/whatsapp-extensao` });
}

function button(label: string, variant: "primary" | "secondary" | "danger", onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = `popup__btn popup__btn--${variant}`;
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

function text(msg: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = "popup__text";
  p.textContent = msg;
  return p;
}

function errorBox(msg: string): HTMLDivElement {
  const div = document.createElement("div");
  div.className = "popup__error";
  div.textContent = msg;
  return div;
}

function spinner(): HTMLDivElement {
  const div = document.createElement("div");
  div.className = "popup__spinner";
  div.setAttribute("aria-label", "Carregando");
  return div;
}

async function submitCode(code: string) {
  render("validating");
  const result = await send({ type: "submit-code", code });
  render(result.popupState, result.errorMessage);
}

function renderCodeForm(errorMessage?: string) {
  content.innerHTML = "";
  content.appendChild(text("Gere um código na plataforma (página \"Extensão WA\") e cole abaixo."));
  if (errorMessage) content.appendChild(errorBox(errorMessage));

  const input = document.createElement("input");
  input.className = "popup__code-input";
  input.placeholder = "XXXX-XXXX-XXXX";
  input.maxLength = 14;
  input.setAttribute("aria-label", "Código de conexão");
  content.appendChild(input);

  content.appendChild(
    button("Conectar", "primary", () => {
      if (input.value.trim()) submitCode(input.value.trim());
    })
  );
  content.appendChild(button("Abrir plataforma", "secondary", openPlatform));
}

let currentState: PopupState | null = null;
// Estados em que o usuário pode estar digitando algo — não interrompe com
// um refresh automático nesses (perderia o que já foi digitado).
const INPUT_ACTIVE_STATES: PopupState[] = ["not_linked", "enter_code", "invalid_code", "expired_code", "device_revoked"];

function render(state: PopupState, errorMessage?: string) {
  currentState = state;
  content.innerHTML = "";

  const statusMap: Record<PopupState, { dotClass: string; labelText: string }> = {
    not_linked: { dotClass: "", labelText: "Não vinculado" },
    enter_code: { dotClass: "", labelText: "Informe o código" },
    validating: { dotClass: "warn", labelText: "Validando código..." },
    open_whatsapp: { dotClass: "warn", labelText: "Abra o WhatsApp Web" },
    waiting_connection: { dotClass: "warn", labelText: "Aguardando conexão" },
    whatsapp_connected: { dotClass: "ok", labelText: "WhatsApp conectado" },
    platform_connected: { dotClass: "ok", labelText: "Plataforma conectada" },
    whatsapp_closed: { dotClass: "err", labelText: "WhatsApp Web fechado" },
    invalid_code: { dotClass: "err", labelText: "Código inválido" },
    expired_code: { dotClass: "err", labelText: "Código expirado" },
    device_revoked: { dotClass: "err", labelText: "Dispositivo revogado" },
    comm_error: { dotClass: "err", labelText: "Erro de comunicação" },
  };

  const s = statusMap[state];
  dot.className = `status-dot ${s.dotClass}`;
  label.textContent = s.labelText;

  switch (state) {
    case "not_linked":
    case "invalid_code":
    case "expired_code":
    case "device_revoked":
      renderCodeForm(errorMessage ?? (
        state === "invalid_code" ? "Código inválido ou já utilizado. Gere um novo na plataforma."
        : state === "expired_code" ? "Esse código expirou (validade de 10 min). Gere um novo."
        : state === "device_revoked" ? "Esse dispositivo foi desconectado pela plataforma. Cole um novo código para reconectar."
        : undefined
      ));
      break;

    case "validating":
      content.appendChild(spinner());
      break;

    case "open_whatsapp":
      content.appendChild(text("Código validado! Abra o WhatsApp Web e conecte normalmente (QR Code do próprio WhatsApp)."));
      content.appendChild(button("Abrir WhatsApp Web", "primary", openWhatsApp));
      break;

    case "waiting_connection":
      content.appendChild(text("Aguardando você conectar o WhatsApp Web nessa aba..."));
      content.appendChild(button("Abrir WhatsApp Web", "secondary", openWhatsApp));
      break;

    case "whatsapp_connected":
    case "platform_connected":
      content.appendChild(text("Tudo certo! O status está sendo sincronizado com a plataforma."));
      content.appendChild(button("Abrir plataforma", "secondary", openPlatform));
      content.appendChild(button("Desconectar", "danger", async () => {
        await send({ type: "disconnect" });
        render("not_linked");
      }));
      break;

    case "whatsapp_closed":
      content.appendChild(text("A aba do WhatsApp Web não está mais respondendo. Abra novamente para o status voltar a \"conectado\"."));
      content.appendChild(button("Abrir WhatsApp Web", "primary", openWhatsApp));
      content.appendChild(button("Desconectar", "danger", async () => {
        await send({ type: "disconnect" });
        render("not_linked");
      }));
      break;

    case "comm_error":
      content.appendChild(errorBox(errorMessage ?? "Não foi possível falar com a plataforma."));
      content.appendChild(button("Tentar novamente", "secondary", () => init()));
      break;

    case "enter_code":
      renderCodeForm(errorMessage);
      break;
  }
}

async function init() {
  label.textContent = "Carregando...";
  try {
    const result = await send({ type: "get-status" });
    render(result.popupState, result.errorMessage);
  } catch {
    render("comm_error", "Não foi possível verificar o status.");
  }
}

init();
// Enquanto o popup estiver aberto, revalida o status periodicamente — só nos
// estados de "aguardando"/conectado, nunca durante digitação de código (ver
// INPUT_ACTIVE_STATES). Popup fecha sozinho ao clicar fora, sem precisar de cleanup.
setInterval(() => {
  if (currentState && !INPUT_ACTIVE_STATES.includes(currentState)) init();
}, 5000);
