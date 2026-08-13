# Justificativa de permissões — Chrome Web Store

Formulário de revisão da Chrome Web Store pede justificativa por permissão declarada em `manifest.json`. Copiar/colar conforme necessário.

## `storage`

**Uso**: guardar localmente (`chrome.storage.local`, nunca `storage.sync`) a credencial do dispositivo emitida pela plataforma após o pareamento, o identificador do próprio dispositivo, e o último estado reportado do WhatsApp Web.

**Por que é o mínimo necessário**: sem isso a extensão perderia a vinculação a cada reinício do navegador, obrigando o usuário a gerar um código novo toda hora. `storage.local` (em vez de `storage.sync`) é usado deliberadamente pra a credencial NÃO se propagar pra outros computadores logados na mesma conta Google — cada instalação da extensão é um dispositivo distinto.

## `alarms`

**Uso**: agendar o heartbeat periódico (1x/min) que informa à plataforma se a conexão continua ativa.

**Por que é o mínimo necessário**: um service worker Manifest V3 é encerrado pelo Chrome quando ocioso; `setInterval` comum não sobrevive a isso. `chrome.alarms` é o mecanismo oficial recomendado pelo Google pra tarefas periódicas em background que precisam sobreviver ao ciclo de vida do service worker.

## `host_permissions` — `https://web.whatsapp.com/*`

**Uso**: injetar dois content scripts. (1) `content-script.ts`, mundo ISOLADO padrão, observa via seletores DOM se a tela de conversas está visível/há QR Code/está carregando, e faz o relay das mensagens que (2) `main-world.ts` reporta — esse roda no mundo PRINCIPAL da página (`"world": "MAIN"` em `manifest.json`), compartilhando o contexto JS da própria aplicação do WhatsApp Web, e usa a lib `@wppconnect/wa-js` pra ler nome de contato, telefone, texto de mensagens novas e contexto de anúncio de origem — dado que não é exposto de forma confiável no DOM visível. Tudo isso pra criar/atualizar leads no CRM do usuário (mesma finalidade de uma integração de WhatsApp normal, ver `docs/PRIVACY.md`).

**⚠️ Nota de risco**: rodar no mundo principal e ler o estado interno da aplicação via `@wppconnect/wa-js` é uma técnica não-oficial, fora dos termos de uso do WhatsApp — mesma categoria de risco de Evolution API/WPPConnect, mas recaindo sobre o número pessoal do cliente. `main-world.ts` só chama a função de LEITURA de evento do pacote (`WPP.on(...)`) — nunca envio/automação. Ver disclosure completo em `docs/PRIVACY.md`.

**Por que é o mínimo necessário**: restrito exatamente ao domínio do WhatsApp Web — não há `<all_urls>` nem wildcard amplo. Nenhum dos dois scripts lê cookies, `localStorage`, `IndexedDB`, nenhum abre uma conversa pra ler o histórico completo, e nenhum lê mídia ou conversa em grupo (ver `src/main-world.ts` e `src/whatsapp-dom-adapter.ts`).

## `host_permissions` — domínio da plataforma

**Uso**: `fetch()` do service worker e do popup para os endpoints `/api/integrations/whatsapp-extension/*` (claim do código, heartbeat, envio de mensagens novas pra criação de lead).

**Por que é o mínimo necessário**: restrito ao domínio exato de produção da plataforma — não é um wildcard, e a extensão nunca faz requisições a nenhum outro host.

## Sem permissões declaradas para

- `tabs` — não foi necessário; abrir abas usa `chrome.tabs.create`, que **não exige** a permissão `tabs` (só precisaria dela pra LER dados sensíveis de outras abas, o que a extensão nunca faz).
- `cookies` — nunca acessado, propositalmente, mesmo sendo tecnicamente possível pedir.
- `scripting` — não é necessário; o content script é declarado estaticamente em `manifest.json`, não injetado dinamicamente.
