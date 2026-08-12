# Justificativa de permissões — Chrome Web Store

Formulário de revisão da Chrome Web Store pede justificativa por permissão declarada em `manifest.json`. Copiar/colar conforme necessário.

## `storage`

**Uso**: guardar localmente (`chrome.storage.local`, nunca `storage.sync`) a credencial do dispositivo emitida pela plataforma após o pareamento, o identificador do próprio dispositivo, e o último estado reportado do WhatsApp Web.

**Por que é o mínimo necessário**: sem isso a extensão perderia a vinculação a cada reinício do navegador, obrigando o usuário a gerar um código novo toda hora. `storage.local` (em vez de `storage.sync`) é usado deliberadamente pra a credencial NÃO se propagar pra outros computadores logados na mesma conta Google — cada instalação da extensão é um dispositivo distinto.

## `alarms`

**Uso**: agendar o heartbeat periódico (1x/min) que informa à plataforma se a conexão continua ativa.

**Por que é o mínimo necessário**: um service worker Manifest V3 é encerrado pelo Chrome quando ocioso; `setInterval` comum não sobrevive a isso. `chrome.alarms` é o mecanismo oficial recomendado pelo Google pra tarefas periódicas em background que precisam sobreviver ao ciclo de vida do service worker.

## `host_permissions` — `https://web.whatsapp.com/*`

**Uso**: injetar o content script que (1) observa, via seletores DOM, se a tela de conversas está visível/há QR Code/está carregando, e (2) lê nome de contato + prévia da última mensagem de conversas novas na lista, pra criar/atualizar leads no CRM do usuário (mesma finalidade de uma integração de WhatsApp normal, ver `docs/PRIVACY.md`).

**Por que é o mínimo necessário**: restrito exatamente ao domínio do WhatsApp Web — não há `<all_urls>` nem wildcard amplo. O content script nunca lê cookies, `localStorage`, `IndexedDB`, nunca abre uma conversa pra ler o histórico completo, e nunca lê mídia (ver `src/whatsapp-dom-adapter.ts` — só a lista de conversas já visível na tela).

## `host_permissions` — domínio da plataforma

**Uso**: `fetch()` do service worker e do popup para os endpoints `/api/integrations/whatsapp-extension/*` (claim do código, heartbeat, envio de mensagens novas pra criação de lead).

**Por que é o mínimo necessário**: restrito ao domínio exato de produção da plataforma — não é um wildcard, e a extensão nunca faz requisições a nenhum outro host.

## Sem permissões declaradas para

- `tabs` — não foi necessário; abrir abas usa `chrome.tabs.create`, que **não exige** a permissão `tabs` (só precisaria dela pra LER dados sensíveis de outras abas, o que a extensão nunca faz).
- `cookies` — nunca acessado, propositalmente, mesmo sendo tecnicamente possível pedir.
- `scripting` — não é necessário; o content script é declarado estaticamente em `manifest.json`, não injetado dinamicamente.
