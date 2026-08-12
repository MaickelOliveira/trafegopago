# Conector WhatsApp — Tráfego Pago Plataforma

Extensão Chrome (Manifest V3) que vincula o WhatsApp Web já conectado no navegador do cliente à conta dele na plataforma, via código temporário de uso único. Não é uma integração oficial do WhatsApp/Meta — não acessa cookies, tokens ou o conteúdo de conversas.

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

- **Depende do computador e do Chrome permanecerem ligados**, com a aba do WhatsApp Web aberta — não é uma conexão em nuvem 24h como as integrações oficiais da plataforma (Evolution API, WPPConnect, Meta Cloud API).
- **Não detecta o fechamento da aba em tempo real.** Um service worker Manifest V3 não tem como saber de forma confiável quando uma aba específica fecha. O status "Desconectado" é inferido pela ausência de heartbeat por `STALE_AFTER_MS` (150s, ver `src/lib/extension-devices.ts` no app principal) — ou seja, pode levar até ~2,5 min pra platform refletir que a aba fechou.
- **Sem ícones próprios ainda** (`manifest.json` não referencia `icons` — Chrome usa um ícone genérico). Funciona normalmente em "Carregar sem compactação", mas a Chrome Web Store **exige** ícones (mínimo 128×128) antes de aceitar publicação — ver `docs/PUBLISHING.md`.
- **Heartbeat a cada 1 minuto**, não menos — é o período mínimo que `chrome.alarms` garante de forma confiável para extensões publicadas (empacotadas). Não dá pra reduzir isso sem trocar a estratégia de manter o service worker acordado (fora de escopo aqui, e geralmente contra as boas práticas do Chrome Web Store).
