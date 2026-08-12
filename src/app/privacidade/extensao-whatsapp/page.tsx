export const metadata = {
  title: "Privacidade — Conector WhatsApp (extensão) — Nexo",
};

export default function PrivacidadeExtensaoPage() {
  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4">
      <div className="mx-auto max-w-3xl rounded-2xl bg-white p-8 shadow-sm border border-slate-200">
        <img src="/nexo-logo.png" alt="Nexo" className="h-10 w-auto object-contain mb-6" />
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Conector WhatsApp — Privacidade, termos e exclusão de dados</h1>
        <p className="text-sm text-slate-400 mb-8">Extensão do Chrome &quot;Conector WhatsApp — Tráfego Pago Plataforma&quot; — versão do consentimento 2.0.0</p>

        <div className="space-y-6 text-sm text-slate-700 leading-relaxed">
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">1. O que a extensão faz</h2>
            <p>
              A extensão vincula a aba do WhatsApp Web que você já abriu e conectou (com seu próprio celular, via QR Code do próprio WhatsApp) à sua conta na plataforma Nexo. Ela reporta o <strong>status</strong> dessa conexão (conectado, aguardando QR, desconectado) e cria/atualiza <strong>leads no seu CRM</strong> a partir de conversas novas — não é uma integração oficial do WhatsApp/Meta.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">2. Quais dados a extensão acessa</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Presença visual de elementos da página do WhatsApp Web (ex: se a lista de conversas está visível, se há um QR Code na tela) — pra saber o estado da conexão.</li>
              <li><strong>Nome do contato e a prévia da última mensagem</strong> de cada conversa da sua lista, quando muda — usados só pra criar/atualizar o lead correspondente no CRM da plataforma. A extensão não abre a conversa nem lê o histórico completo, só a prévia já visível na lista.</li>
              <li>O número de telefone, quando tecnicamente possível de identificar a partir da própria lista (nem sempre disponível — em alguns casos só o nome do contato é usado).</li>
              <li>Um identificador aleatório do próprio dispositivo/instalação da extensão (não identifica você pessoalmente, só distingue uma instalação de outra).</li>
            </ul>
            <p className="mt-2 font-medium">A extensão nunca acessa, lê ou copia:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Cookies, tokens ou credenciais de login do WhatsApp;</li>
              <li>IndexedDB, LocalStorage ou SessionStorage do WhatsApp Web;</li>
              <li>O histórico completo das conversas, mídias, ou dados de clique de anúncio/campanha (esse último dado só existe no protocolo interno do WhatsApp, não aparece na tela — nem a extensão nem nenhum outro método baseado em navegador consegue captar isso).</li>
              <li>Conversas que já existiam antes de você conectar a extensão — só mensagens novas a partir da conexão são consideradas.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">3. O que é enviado ao servidor</h2>
            <p>Estado da conexão, o identificador do dispositivo, horário do último sinal de atividade (heartbeat), e — quando há mensagem nova — nome do contato, telefone (se identificável) e a prévia da última mensagem, pra criar/atualizar o lead no funil escolhido por você na hora de gerar o código de conexão.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">4. Por quanto tempo é armazenado</h2>
            <p>O registro do dispositivo (status e horário da última atividade) fica salvo enquanto a conexão estiver ativa ou até você desconectá-la. Ao desconectar, o registro é marcado como revogado e deixa de ser usado. Os leads e mensagens criados no CRM seguem a retenção normal da plataforma (não são apagados automaticamente ao desconectar a extensão) — podem ser excluídos manualmente pelo CRM ou mediante solicitação (seção 6).</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">5. Como desconectar</h2>
            <p>A qualquer momento, pelo botão &quot;Desconectar&quot; na página &quot;Extensão WA&quot; dentro da plataforma ou no popup da extensão, ou removendo a extensão do Chrome.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">6. Como solicitar exclusão de dados</h2>
            <p>Envie um pedido para o suporte da agência informando sua conta — o registro do dispositivo e o histórico de auditoria relacionado a ele serão apagados permanentemente. Exclusão de leads/conversas específicas já criadas no CRM pode ser feita diretamente pelo painel, ou mediante o mesmo pedido.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">7. Avisos importantes</h2>
            <p>Este método depende do WhatsApp Web permanecer aberto e conectado no seu navegador, e do computador permanecer ligado — <strong>não é um método de conexão em nuvem/24h</strong> como as integrações oficiais da plataforma (Evolution API, WPPConnect, API Oficial Meta). Se o computador desligar, a conexão para até você religar. Não é um produto do WhatsApp Inc./Meta.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
