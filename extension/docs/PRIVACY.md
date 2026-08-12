# Privacidade — Conector WhatsApp

A política de privacidade completa (a mesma referenciada no formulário da Chrome Web Store e linkada no popup da extensão) vive na plataforma, pra ter uma única fonte de verdade:

**`{PLATFORM_BASE_URL}/privacidade/extensao-whatsapp`**

(código-fonte dessa página: `src/app/privacidade/extensao-whatsapp/page.tsx` no projeto principal, não neste diretório)

## Resumo (não substitui a política completa)

- A extensão só reporta **estado da conexão** (conectado/aguardando QR/desconectado) — nunca conteúdo de mensagens, contatos ou mídia.
- Nunca acessa cookies, `localStorage`, `IndexedDB` ou qualquer credencial de autenticação do WhatsApp.
- O identificador de dispositivo é aleatório, não pessoal — não identifica o usuário sozinho.
- Consentimento é obrigatório antes do primeiro pareamento (tela na própria plataforma) e fica registrado com versão e data (`consentVersion`/`consentAt` em `src/lib/extension-devices.ts` do app principal).
- Desconectar (revogar) é imediato, pelo botão na plataforma ou no popup da extensão.
