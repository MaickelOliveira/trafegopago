# Privacidade — Conector WhatsApp

A política de privacidade completa (a mesma referenciada no formulário da Chrome Web Store e linkada no popup da extensão) vive na plataforma, pra ter uma única fonte de verdade:

**`{PLATFORM_BASE_URL}/privacidade/extensao-whatsapp`**

(código-fonte dessa página: `src/app/privacidade/extensao-whatsapp/page.tsx` no projeto principal, não neste diretório)

## Resumo (não substitui a política completa)

- A extensão reporta **estado da conexão** (conectado/aguardando QR/desconectado) e, a partir da v2.0.0 do consentimento, também **nome de contato + prévia da última mensagem** de conversas novas — pra criar/atualizar leads no CRM (mesma finalidade da Evolution API/WPPConnect). Nunca lê o histórico completo de uma conversa, mídia, ou conversas que já existiam antes da conexão.
- Nunca acessa cookies, `localStorage`, `IndexedDB` ou qualquer credencial de autenticação do WhatsApp — em nenhuma versão.
- Não captura dado de clique de anúncio/campanha (`ctwa_clid` e afins) — esse dado só existe no protocolo interno do WhatsApp, nunca aparece na interface visual, então nenhum método baseado em extensão de navegador consegue captar isso (só Evolution API/API Oficial Meta, que leem o protocolo diretamente).
- O identificador de dispositivo é aleatório, não pessoal — não identifica o usuário sozinho.
- Consentimento é obrigatório antes do primeiro pareamento (tela na própria plataforma) e fica registrado com versão e data (`consentVersion`/`consentAt` em `src/lib/extension-devices.ts` do app principal). Mudança de versão do consentimento exige reconectar.
- Desconectar (revogar) é imediato, pelo botão na plataforma ou no popup da extensão.
