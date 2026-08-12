# Conector WhatsApp — Tráfego Pago Plataforma

Extensão Chrome (Manifest V3) que vincula o WhatsApp Web já conectado no navegador do cliente à conta dele na plataforma, via código temporário de uso único. Reporta status de conexão e cria/atualiza leads no CRM a partir de conversas novas (nome + prévia de mensagem) — mesma finalidade da Evolution API/WPPConnect, escolhendo o funil de destino na hora de gerar o código. Não é uma integração oficial do WhatsApp/Meta — não acessa cookies, tokens, histórico completo de conversa, mídia, nem dado de clique de anúncio (ver `docs/PRIVACY.md`).

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
    types.ts              Tipos compartilhados entre os 3 contextos (mensagens, estados)
    service-worker.ts      Background: storage do token, heartbeat (chrome.alarms), chamadas à API
    content-script.ts      Roda só em web.whatsapp.com — detecta estado da página
    whatsapp-dom-adapter.ts  Seletores DOM do WhatsApp Web isolados (ver docs/PERMISSIONS.md)
    popup.ts                Máquina de estados da UI do popup
  build.mjs / zip.mjs      Scripts de build (esbuild) e empacotamento
```

## Limitações técnicas conhecidas (intencionais, não escondidas)

- **Depende do computador e do Chrome permanecerem ligados**, com a aba do WhatsApp Web aberta — não é uma conexão em nuvem 24h como as integrações oficiais da plataforma (Evolution API, WPPConnect, Meta Cloud API). **Fisicamente impossível de contornar** com esse método (não é falta de código) — quem precisa de uptime 24h independente do PC do cliente deve usar Evolution API/WPPConnect.
- **Não detecta o fechamento da aba em tempo real.** Um service worker Manifest V3 não tem como saber de forma confiável quando uma aba específica fecha. O status "Desconectado" é inferido pela ausência de heartbeat por `STALE_AFTER_MS` (150s, ver `src/lib/extension-devices.ts` no app principal) — ou seja, pode levar até ~2,5 min pra plataforma refletir que a aba fechou.
- **Não captura dado de clique de anúncio/campanha (`ctwa_clid`, ad id, etc.).** Confirmado por engenharia reversa do próprio fluxo da Evolution API do projeto: esse dado vem só do protocolo interno do WhatsApp (`contextInfo.externalAdReply`), nunca é renderizado na interface visual — um content script só enxerga o DOM, não tem como captar isso. Não é uma limitação de esforço, é ausência física do dado no que o navegador consegue ver.
- **Extração de telefone/nome/prévia de mensagem depende de seletores DOM do WhatsApp Web** (`src/whatsapp-dom-adapter.ts`), que podem mudar em atualizações do WhatsApp sem aviso. Todo o código de extração é defensivo (nunca lança exceção, degrada pra "sem esse dado" em vez de quebrar), mas pode parar de capturar telefone/prévia corretamente até alguém atualizar os seletores — teste manual após atualizações grandes do WhatsApp Web é recomendado.
- **Telefone nem sempre é identificável** — o WhatsApp Web às vezes só expõe o nome do contato salvo, não o número, em certos pontos do DOM. Quando isso acontece, o item é descartado em vez de criar um lead com identidade arriscada/errada (ver comentário em `messages/route.ts` do app principal).
- **Só mensagens NOVAS a partir da conexão** — a extensão não importa retroativamente o histórico de conversas que já existiam antes de conectar (escolha deliberada de privacidade/performance).
- **Ícones**: já incluídos (`extension/assets/`, gerados a partir de `public/nexo-logo.png`), mas a Chrome Web Store também exige screenshots antes de aceitar publicação — ver `docs/PUBLISHING.md`.
- **Heartbeat a cada 1 minuto**, não menos — é o período mínimo que `chrome.alarms` garante de forma confiável para extensões publicadas (empacotadas). Não dá pra reduzir isso sem trocar a estratégia de manter o service worker acordado (fora de escopo aqui, e geralmente contra as boas práticas do Chrome Web Store).
