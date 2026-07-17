export const metadata = {
  title: "Política de Privacidade — Nexo",
};

export default function PrivacidadePage() {
  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4">
      <div className="mx-auto max-w-3xl rounded-2xl bg-white p-8 shadow-sm border border-slate-200">
        <img src="/nexo-logo.png" alt="Nexo" className="h-10 w-auto object-contain mb-6" />
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Política de Privacidade</h1>
        <p className="text-sm text-slate-400 mb-8">Última atualização: 29 de junho de 2026</p>

        <div className="space-y-6 text-sm text-slate-700 leading-relaxed">
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">1. Quem somos</h2>
            <p>
              A Nexo é uma plataforma interna de gestão de tráfego pago, CRM e atendimento via
              WhatsApp, operada para uso da agência e de seus clientes. Esta política descreve
              como tratamos os dados acessados e processados pela plataforma.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">2. Quais dados coletamos</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>Dados de contas de anúncio</strong> (Meta Ads e Google Ads): nomes,
                status, métricas e orçamento de campanhas, conjuntos de anúncios e anúncios,
                obtidos via APIs oficiais (Meta Graph API e Google Ads API) com autorização
                explícita do responsável pela conta.
              </li>
              <li>
                <strong>Dados de leads/contatos</strong>: nome, telefone, e-mail e histórico de
                conversas via WhatsApp, usados para atendimento e gestão de relacionamento (CRM).
              </li>
              <li>
                <strong>Dados de uso da plataforma</strong>: login, ações realizadas por
                gestores e clientes dentro do sistema.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">3. Como usamos os dados</h2>
            <p>Os dados coletados são usados exclusivamente para:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Exibir relatórios e métricas de campanhas de tráfego pago aos clientes responsáveis por cada conta;</li>
              <li>Permitir a gestão (pausar/ativar campanhas, editar orçamento) por usuários autorizados;</li>
              <li>Operar o atendimento e CRM via WhatsApp, incluindo respostas automatizadas por IA;</li>
              <li>Gerar relatórios financeiros e de desempenho internos da agência.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">4. Integração com contas Google e Meta</h2>
            <p>
              Ao autorizar a conexão com sua conta Google (Google Ads/Calendar) ou Meta
              (Facebook/Instagram Ads), a plataforma recebe um token de acesso usado somente
              para ler e, quando autorizado, editar dados das contas de anúncio e agenda
              vinculadas. Esse token é armazenado de forma restrita ao servidor da aplicação e
              nunca é exposto ao navegador ou compartilhado com terceiros.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">5. Compartilhamento de dados</h2>
            <p>
              Não vendemos nem compartilhamos dados com terceiros para fins de publicidade.
              Os dados só são transmitidos às próprias APIs de origem (Meta, Google, provedores
              de WhatsApp Business API) estritamente para a operação dos recursos descritos
              acima.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">6. Armazenamento e segurança</h2>
            <p>
              Os dados são armazenados em servidores controlados pela agência, com acesso
              restrito a usuários autenticados e autorizados (gestores e clientes vinculados a
              cada conta). Senhas são armazenadas de forma criptografada.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">7. Retenção e exclusão</h2>
            <p>
              Os dados são mantidos enquanto a conta do cliente estiver ativa na plataforma.
              A exclusão de dados pode ser solicitada a qualquer momento pelo contato abaixo.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">8. Contato</h2>
            <p>
              Para dúvidas sobre esta política ou solicitações relacionadas aos seus dados,
              entre em contato: <a href="mailto:nexoprotp@gmail.com" className="text-blue-600 underline">nexoprotp@gmail.com</a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
