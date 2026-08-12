export const metadata = {
  title: "Privacidade — Conector WhatsApp (extensão) — Nexo",
};

export default function PrivacidadeExtensaoPage() {
  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4">
      <div className="mx-auto max-w-3xl rounded-2xl bg-white p-8 shadow-sm border border-slate-200">
        <img src="/nexo-logo.png" alt="Nexo" className="h-10 w-auto object-contain mb-6" />
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Conector WhatsApp — Privacidade, termos e exclusão de dados</h1>
        <p className="text-sm text-slate-400 mb-8">Extensão do Chrome &quot;Conector WhatsApp — Tráfego Pago Plataforma&quot;</p>

        <div className="space-y-6 text-sm text-slate-700 leading-relaxed">
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">1. O que a extensão faz</h2>
            <p>
              A extensão vincula a aba do WhatsApp Web que você já abriu e conectou (com seu próprio celular, via QR Code do próprio WhatsApp) à sua conta na plataforma Nexo. Ela serve apenas para reportar o <strong>status</strong> dessa conexão (conectado, aguardando QR, desconectado) — não é uma integração oficial do WhatsApp/Meta.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">2. Quais dados a extensão acessa</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Presença visual de elementos da página do WhatsApp Web (ex: se a lista de conversas está visível, se há um QR Code na tela) — só para saber o estado da conexão.</li>
              <li>Um identificador aleatório do próprio dispositivo/instalação da extensão (não identifica você pessoalmente, só distingue uma instalação de outra).</li>
            </ul>
            <p className="mt-2 font-medium">A extensão nunca acessa, lê ou copia:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Cookies, tokens ou credenciais de login do WhatsApp;</li>
              <li>IndexedDB, LocalStorage ou SessionStorage do WhatsApp Web;</li>
              <li>O conteúdo das suas conversas, contatos ou mídias.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">3. O que é enviado ao servidor</h2>
            <p>Apenas: estado da conexão (conectado/aguardando/desconectado), o identificador do dispositivo, e o horário do último sinal de atividade (heartbeat). Nenhum conteúdo de mensagem é enviado.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">4. Por quanto tempo é armazenado</h2>
            <p>O registro do dispositivo (status e horário da última atividade) fica salvo enquanto a conexão estiver ativa ou até você desconectá-la. Ao desconectar, o registro é marcado como revogado e deixa de ser usado — pode ser excluído definitivamente mediante solicitação (seção 6).</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">5. Como desconectar</h2>
            <p>A qualquer momento, pelo botão &quot;Desconectar&quot; na página &quot;Extensão WA&quot; dentro da plataforma, ou removendo a extensão do Chrome.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">6. Como solicitar exclusão de dados</h2>
            <p>Envie um pedido para o suporte da agência informando sua conta — o registro do dispositivo e o histórico de auditoria relacionado a ele serão apagados permanentemente.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">7. Aviso importante</h2>
            <p>Este método depende do WhatsApp Web permanecer aberto e conectado no seu navegador, e do computador permanecer ligado — não é um método de conexão em nuvem/24h como as integrações oficiais da plataforma. Não é um produto do WhatsApp Inc./Meta.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
