export const metadata = {
  title: "Privacidade — Conector WhatsApp (extensão) — Nexo",
};

export default function PrivacidadeExtensaoPage() {
  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4">
      <div className="mx-auto max-w-3xl rounded-2xl bg-white p-8 shadow-sm border border-slate-200">
        <img src="/nexo-logo.png" alt="Nexo" className="h-10 w-auto object-contain mb-6" />
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Conector WhatsApp — Privacidade, termos e exclusão de dados</h1>
        <p className="text-sm text-slate-400 mb-8">Extensão do Chrome &quot;Conector WhatsApp — Tráfego Pago Plataforma&quot; — versão do consentimento 4.0.0</p>

        <div className="space-y-6 text-sm text-slate-700 leading-relaxed">
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <h2 className="text-base font-semibold text-amber-900 mb-2">⚠️ Aviso de risco — leia antes de conectar</h2>
            <p className="text-amber-800">
              Pra ler mensagem, nome de contato e contexto de anúncio de origem — e, quando o Agente IA estiver ativado nessa conexão, pra <strong>enviar</strong> a resposta automática — a extensão usa uma biblioteca de terceiros (<code className="font-mono bg-amber-100 px-1 rounded">@wppconnect/wa-js</code>) injetada na própria página do WhatsApp Web, que lê e escreve no estado interno já decodificado da aplicação — a mesma técnica usada por bibliotecas de automação de WhatsApp não-oficiais. Isso está <strong>fora dos termos de uso do WhatsApp</strong> e carrega um risco real, embora não determinístico, de restrição/banimento da conta conectada — <strong>envio automático de mensagem é justamente o padrão que sistemas de detecção de bot mais observam</strong>, por isso é um risco mais sério que só leitura. Diferente das integrações Evolution API/WPPConnect da plataforma (que usam um número dedicado da agência), aqui o número em risco é o <strong>seu número pessoal</strong>. Fora enviar a resposta da IA quando ativada, a extensão não envia mensagem nem executa nenhuma outra ação no WhatsApp.
            </p>
          </section>

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
              <li><strong>Nome do contato, telefone e o conteúdo de mensagens de texto novas</strong> — lidos do estado interno do WhatsApp Web (não mais só o que aparece visualmente na lista), usados pra criar/atualizar o lead correspondente no CRM da plataforma. A extensão não abre o histórico de conversas antigas, e nunca lê mídia (imagem, áudio, vídeo, figurinha) — só texto.</li>
              <li><strong>Contexto de anúncio de origem</strong> (campanha/conjunto/anúncio), quando a mensagem vier de um clique em anúncio Meta — mesmo rastreio de campanha das outras integrações de WhatsApp da plataforma.</li>
              <li>Um identificador aleatório do próprio dispositivo/instalação da extensão (não identifica você pessoalmente, só distingue uma instalação de outra).</li>
            </ul>
            <p className="mt-2 font-medium">Se o Agente IA estiver ativado nesta conexão (decisão do seu gestor de tráfego, não automática):</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>A resposta gerada pela IA é <strong>enviada automaticamente</strong> pelo seu WhatsApp — essa é a única ação de escrita que a extensão faz, sem exceção (nunca mensagem em massa, nunca outra automação).</li>
            </ul>
            <p className="mt-2 font-medium">A extensão nunca acessa, lê ou copia:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Cookies, tokens ou credenciais de login do WhatsApp;</li>
              <li>IndexedDB, LocalStorage ou SessionStorage do WhatsApp Web;</li>
              <li>Mídia (imagem, áudio, vídeo) ou o histórico completo de conversas antigas;</li>
              <li>Conversas em grupo (só conversas individuais viram lead);</li>
              <li>Conversas que já existiam antes de você conectar a extensão — só mensagens novas a partir da conexão são consideradas.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">3. O que é enviado ao servidor (e o que volta do servidor)</h2>
            <p>Ao servidor: estado da conexão, o identificador do dispositivo, horário do último sinal de atividade (heartbeat), e — quando há mensagem nova — nome do contato, telefone, o texto da mensagem e o contexto de anúncio de origem (se houver), pra criar/atualizar o lead no funil vinculado pelo seu gestor de tráfego. Do servidor: se o Agente IA estiver ativo, o texto da resposta que a extensão deve enviar de volta pelo seu WhatsApp — buscado periodicamente enquanto a aba estiver aberta (não é uma conexão em tempo real).</p>
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
            <p>Este método depende do WhatsApp Web permanecer aberto e conectado no seu navegador, e do computador permanecer ligado — <strong>não é um método de conexão em nuvem/24h</strong> como as integrações oficiais da plataforma (Evolution API, WPPConnect, API Oficial Meta). Se o computador desligar, a conexão para até você religar. Não é um produto do WhatsApp Inc./Meta, e usa uma técnica de leitura não-oficial (ver aviso de risco no topo desta página).</p>
          </section>
        </div>
      </div>
    </div>
  );
}
