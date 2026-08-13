# Conector WhatsApp — Tráfego Pago Plataforma

Extensão Chrome (Manifest V3) que vincula o WhatsApp Web já conectado no navegador do cliente à conta dele na plataforma, via código temporário de uso único. Reporta status de conexão e cria/atualiza leads no CRM a partir de conversas novas (nome, telefone, texto da mensagem e contexto de anúncio de origem quando houver) — mesma finalidade da Evolution API/WPPConnect. O funil de destino e o Agente IA são vinculados pelo gestor depois da conexão existir (aba "Extensão Chrome" em `/gestor/whatsapp`), não pelo cliente; com o Agente IA ativo, a extensão também **envia** a resposta automaticamente. Não é uma integração oficial do WhatsApp/Meta — não acessa cookies, tokens, histórico completo de conversa nem mídia; usa uma técnica não-oficial pra ler mensagem/anúncio e (se a IA estiver ativa) enviar resposta (ver aviso de risco em `docs/PRIVACY.md`).

## Instalar localmente ("Carregar sem compactação")

```bash
cd extension
npm install
npm run build
```

Isso gera a pasta `dist/`. No Chrome:

1. Acesse `chrome://extensions`.
2. Ative o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e selecione a pasta `extension/dist`.

Qualquer alteração no código exige rodar `npm run build` de novo e clicar em "Atualizar" na extensão em `chrome://extensions`.

## Gerar o pacote de distribuição (.zip)

```bash
npm run dist
```

Gera `extension/conector-whatsapp.zip`, pronto pra upload na Chrome Web Store (ver `docs/PUBLISHING.md`).

## Scripts

| Comando | O que faz |
|---|---|
| `npm run typecheck` | `tsc --noEmit` — checagem de tipos estrita |
| `npm run build` | typecheck + bundle (esbuild) pra `dist/` |
| `npm run dist` | build + empacota `dist/` num `.zip` |

## Variáveis de configuração (sem segredos)

Não há segredos de build — tudo que a extensão precisa é o domínio público da plataforma, definido em `src/config.ts`:

```ts
export const PLATFORM_BASE_URL = "https://trafegopago-trafegopago.ztcjzs.easypanel.host";
```

Se o domínio de produção mudar, atualize **os dois lugares**: `src/config.ts` e `host_permissions` em `manifest.json` (precisam bater).

## Estrutura

```
extension/
  manifest.json          Manifest V3
  popup.html / popup.css
  src/
    config.ts             Domínio da plataforma + versão de consentimento
    types.ts              Tipos compartilhados entre os contextos (mensagens, estados)
    service-worker.ts      Background: storage do token, heartbeat (chrome.alarms), chamadas à API
    content-script.ts      Mundo ISOLADO, roda em web.whatsapp.com — detecta estado da página (DOM), relay de mensagens vindas de main-world.ts, e faz polling de respostas pendentes da IA (GET /pending-replies) pra mandar enviar
    main-world.ts           Mundo PRINCIPAL (compartilha JS com a própria página) — lê mensagem/telefone/nome/contexto de anúncio via @wppconnect/wa-js, e ENVIA a resposta da IA quando pedido (chat.sendTextMessage — única escrita de toda a extensão, ver aviso de risco em docs/PRIVACY.md)
    whatsapp-dom-adapter.ts  Seletores DOM do WhatsApp Web isolados, só detecção de estado de conexão (ver docs/PERMISSIONS.md)
    popup.ts                Máquina de estados da UI do popup
  build.mjs / zip.mjs      Scripts de build (esbuild) e empacotamento
```

## Limitações técnicas conhecidas (intencionais, não escondidas)

- **⚠️ Técnica não-oficial de leitura E escrita, com risco real de banimento — mais sério que antes da v4.0.0.** `main-world.ts` injeta `@wppconnect/wa-js` no contexto da própria página do WhatsApp Web pra ler telefone/nome/texto/contexto de anúncio do estado interno já decodificado da aplicação — mesma técnica usada por bibliotecas de automação de WhatsApp não-oficiais (whatsapp-web.js, OpenWA). A partir da v4.0.0, quando o Agente IA está ativo numa conexão, `main-world.ts` também chama `chat.sendTextMessage(chatId, text)` pra enviar a resposta automaticamente — **a única função de escrita/automação chamada em toda a extensão**, apesar do pacote (monolítico) trazer bem mais capacidade do que isso. Isso viola os termos de uso do WhatsApp e pode, em tese, contribuir pra uma restrição/banimento da conta conectada — envio automatizado é justamente o padrão que sistemas de detecção de bot mais observam, por isso é um risco mais sério que só leitura. Recai sobre o número PESSOAL do cliente (diferente de Evolution/WPPConnect, que usam número dedicado da agência). Disclosure completo: `docs/PRIVACY.md` e tela de consentimento v4.0.0.
- **Resposta da IA chega por polling, não em tempo real.** O servidor não tem como "empurrar" nada pra um Chrome — `content-script.ts` busca `GET /pending-replies` a cada ~5s enquanto a aba estiver aberta (não usa `chrome.alarms`/service worker pra isso, que teria piso de 1 min — fica no content script mesmo, que não sofre a suspensão de MV3 e vive exatamente enquanto enviar é possível). Latência típica de resposta: alguns segundos, não instantânea.
- **Depende do computador e do Chrome permanecerem ligados**, com a aba do WhatsApp Web aberta — não é uma conexão em nuvem 24h como as integrações oficiais da plataforma (Evolution API, WPPConnect, Meta Cloud API). **Fisicamente impossível de contornar** com esse método (não é falta de código) — quem precisa de uptime 24h independente do PC do cliente deve usar Evolution API/WPPConnect.
- **Não detecta o fechamento da aba em tempo real.** Um service worker Manifest V3 não tem como saber de forma confiável quando uma aba específica fecha. O status "Desconectado" é inferido pela ausência de heartbeat por `STALE_AFTER_MS` (150s, ver `src/lib/extension-devices.ts` no app principal) — ou seja, pode levar até ~2,5 min pra plataforma refletir que a aba fechou.
- **Extração de telefone/nome/mensagem depende da API interna do wa-js** (`src/main-world.ts`), que pode mudar em atualizações do WhatsApp Web sem aviso (é uma biblioteca reversa, não oficial). Todo o código de extração é defensivo (nunca lança exceção, degrada pra "sem esse dado" em vez de quebrar), mas pode parar de capturar corretamente até a lib `@wppconnect/wa-js` publicar uma atualização compatível — teste manual após atualizações grandes do WhatsApp Web é recomendado. A detecção de estado de conexão (`src/whatsapp-dom-adapter.ts`) é só DOM, independente disso.
- **Só mensagens de TEXTO, individuais (sem grupo), NOVAS a partir da conexão** — nunca lê mídia (imagem/áudio/vídeo/figurinha), nunca conversas em grupo, e não importa retroativamente o histórico de conversas que já existiam antes de conectar (escolha deliberada de escopo mínimo).
- **Funil do CRM é vinculado pelo gestor**, não pelo cliente — uma conexão nova fica sem funil até alguém vincular na aba "Extensão Chrome" de `/gestor/whatsapp`; até lá, mensagens recebidas são ignoradas (mesmo comportamento do webhook Evolution pra sessão sem funil).
- **Ícones**: já incluídos (`extension/assets/`, gerados a partir de `public/nexo-logo.png`), mas a Chrome Web Store também exige screenshots antes de aceitar publicação — ver `docs/PUBLISHING.md`.
- **Heartbeat a cada 1 minuto**, não menos — é o período mínimo que `chrome.alarms` garante de forma confiável para extensões publicadas (empacotadas). Não dá pra reduzir isso sem trocar a estratégia de manter o service worker acordado (fora de escopo aqui, e geralmente contra as boas práticas do Chrome Web Store).
