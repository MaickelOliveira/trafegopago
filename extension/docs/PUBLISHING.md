# Publicar na Chrome Web Store

⚠️ Ninguém deve rodar isso sem autorização explícita — publicar cria uma listagem pública e começa o processo de revisão do Google. Este documento só descreve os passos, não os executa.

## Pendências antes de submeter

1. ~~Ícones~~ — ✅ já incluídos (`extension/assets/icon{16,48,128}.png`, gerados a partir de `public/nexo-logo.png`, declarados em `manifest.json`).
2. **Screenshots** — a loja pede pelo menos 1 screenshot (1280×800 ou 640×400) mostrando o popup em uso.
3. **Confirmar `PLATFORM_BASE_URL`** em `src/config.ts` e `host_permissions` em `manifest.json` apontando pro domínio de produção definitivo (hoje: `https://trafegopago-trafegopago.ztcjzs.easypanel.host` — confirmar se é esse mesmo o domínio final antes de publicar, já que apareceu com aviso de certificado/conteúdo misto numa checagem anterior).
4. **Formulário de uso de dados da Chrome Web Store** vai pedir declaração explícita de "dados pessoais coletados" — marcar que a extensão coleta dados de comunicação (nome de contato + prévia de mensagem) pra funcionalidade central (criação de lead no CRM), com link pra política de privacidade completa.

## Passos

1. `cd extension && npm run dist` — gera `conector-whatsapp.zip`.
2. Acesse o [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) (precisa de conta de desenvolvedor, taxa única de registro cobrada pelo Google).
3. **Novo item** → upload do `conector-whatsapp.zip`.
4. Preencher a ficha:
   - Descrição curta e longa.
   - Categoria: Produtividade.
   - Ícone da loja (128×128) e screenshots.
   - **Política de privacidade**: link para `{PLATFORM_BASE_URL}/privacidade/extensao-whatsapp`.
   - **Justificativa de permissões**: usar o conteúdo de `docs/PERMISSIONS.md`.
   - Declaração de uso de dados (Data usage / "Single purpose description"): descrever que a extensão tem propósito único (reportar status de conexão do WhatsApp Web à plataforma), sem coleta de conteúdo de mensagens.
5. Enviar para revisão. O Google costuma revisar extensões com `host_permissions` em domínios de terceiros (como `web.whatsapp.com`) com mais cuidado — esperar possíveis pedidos de esclarecimento sobre o uso dessa permissão (a resposta pronta está em `docs/PERMISSIONS.md`).
6. Após aprovação, atualizações futuras exigem novo upload + nova revisão (mais rápida que a primeira, geralmente).

## Publicação privada/restrita (alternativa)

Se a extensão for só para os clientes da agência (não pública), a Chrome Web Store permite listagem **não listada** ("Unlisted") ou distribuição só para um Google Workspace específico — evita a extensão aparecer em buscas públicas, mas ainda passa por revisão do Google. Recomendado dado que essa extensão não faz sentido pra público geral.
