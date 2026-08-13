# Privacidade — Conector WhatsApp

A política de privacidade completa (a mesma referenciada no formulário da Chrome Web Store e linkada no popup da extensão) vive na plataforma, pra ter uma única fonte de verdade:

**`{PLATFORM_BASE_URL}/privacidade/extensao-whatsapp`**

(código-fonte dessa página: `src/app/privacidade/extensao-whatsapp/page.tsx` no projeto principal, não neste diretório)

## Resumo (não substitui a política completa)

- A extensão reporta **estado da conexão** (conectado/aguardando QR/desconectado) e, a partir da v3.0.0 do consentimento, também **nome de contato, telefone, texto de mensagens novas e contexto de anúncio de origem** (quando houver) — pra criar/atualizar leads no CRM (mesma finalidade da Evolution API/WPPConnect). Nunca lê mídia, histórico completo de uma conversa, conversas em grupo, ou conversas que já existiam antes da conexão.
- **A partir da v4.0.0, se o Agente IA estiver ativo na conexão (decisão do gestor, não automática), a extensão ENVIA a resposta gerada automaticamente** — a única ação de escrita que ela faz, sem exceção (nunca mensagem em massa, nunca outra automação).
- Nunca acessa cookies, `localStorage`, `IndexedDB` ou qualquer credencial de autenticação do WhatsApp — em nenhuma versão.
- **⚠️ Usa uma técnica não-oficial de leitura (desde v3.0.0) e escrita (desde v4.0.0)** (`@wppconnect/wa-js` injetado no mundo principal da página, ver `src/main-world.ts`) pra ler mensagem/telefone/nome/contexto de anúncio, e enviar a resposta da IA quando ativa — dado/ação que não são expostos/possíveis de forma confiável só pelo DOM visível. Isso está fora dos termos de uso do WhatsApp e carrega risco real (não determinístico) de restrição/banimento da conta conectada — envio automatizado é o padrão que sistemas de detecção de bot mais observam, por isso é risco mais sério que só leitura. Recai sobre o número PESSOAL do cliente, não um número dedicado da agência. Disclosure completo na tela de consentimento e na política de privacidade da plataforma.
- O identificador de dispositivo é aleatório, não pessoal — não identifica o usuário sozinho.
- Consentimento é obrigatório antes do primeiro pareamento (tela na própria plataforma) e fica registrado com versão e data (`consentVersion`/`consentAt` em `src/lib/extension-devices.ts` do app principal). Mudança de versão do consentimento exige reconectar.
- O funil de CRM e o Agente IA da conexão são vinculados pelo gestor (não pelo cliente) depois da conexão técnica existir.
- Desconectar (revogar) é imediato, pelo botão na plataforma ou no popup da extensão.
