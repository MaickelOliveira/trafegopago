# Privacidade — Conector WhatsApp

A política de privacidade completa (a mesma referenciada no formulário da Chrome Web Store e linkada no popup da extensão) vive na plataforma, pra ter uma única fonte de verdade:

**`{PLATFORM_BASE_URL}/privacidade/extensao-whatsapp`**

(código-fonte dessa página: `src/app/privacidade/extensao-whatsapp/page.tsx` no projeto principal, não neste diretório)

## Resumo (não substitui a política completa)

- A extensão reporta **estado da conexão** (conectado/aguardando QR/desconectado) e, a partir da v3.0.0 do consentimento, também **nome de contato, telefone, texto de mensagens novas e contexto de anúncio de origem** (quando houver) — pra criar/atualizar leads no CRM (mesma finalidade da Evolution API/WPPConnect). Nunca lê mídia, histórico completo de uma conversa, conversas em grupo, ou conversas que já existiam antes da conexão.
- Nunca acessa cookies, `localStorage`, `IndexedDB` ou qualquer credencial de autenticação do WhatsApp — em nenhuma versão. Nunca envia mensagem nem executa nenhuma ação no WhatsApp — só lê.
- **⚠️ v3.0.0 usa uma técnica de leitura não-oficial** (`@wppconnect/wa-js` injetado no mundo principal da página, ver `src/main-world.ts`) pra conseguir ler mensagem/telefone/nome/contexto de anúncio — dado que não é exposto de forma confiável no DOM visível. Isso está fora dos termos de uso do WhatsApp e carrega risco real (não determinístico) de restrição/banimento da conta conectada — que é o número PESSOAL do cliente, não um número dedicado da agência. Disclosure completo na tela de consentimento e na política de privacidade da plataforma.
- O identificador de dispositivo é aleatório, não pessoal — não identifica o usuário sozinho.
- Consentimento é obrigatório antes do primeiro pareamento (tela na própria plataforma) e fica registrado com versão e data (`consentVersion`/`consentAt` em `src/lib/extension-devices.ts` do app principal). Mudança de versão do consentimento exige reconectar.
- O funil de CRM da conexão é vinculado pelo gestor (não pelo cliente) depois da conexão técnica existir.
- Desconectar (revogar) é imediato, pelo botão na plataforma ou no popup da extensão.
