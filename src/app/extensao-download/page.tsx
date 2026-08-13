export const metadata = {
  title: "Baixar Conector WhatsApp — Nexo",
};

// Versão exibida aqui é só texto informativo — não é lida de extension/manifest.json
// (essa pasta não existe na imagem de produção). Atualize manualmente junto com
// extension/manifest.json sempre que rodar "npm run dist" pra gerar um novo pacote.
const EXTENSION_VERSION = "1.2.0";

const steps = [
  {
    title: "Baixe e extraia o arquivo",
    text: "Clique no botão de download acima. Depois, encontre o arquivo conector-whatsapp.zip (geralmente na pasta Downloads) e extraia/descompacte ele — no Windows, clique com o botão direito e escolha \"Extrair tudo\"; no Mac, basta dar dois cliques.",
  },
  {
    title: "Abra a página de extensões do Chrome",
    text: "Na barra de endereço do Chrome, digite chrome://extensions e aperte Enter.",
  },
  {
    title: "Ative o \"Modo do desenvolvedor\"",
    text: "No canto superior direito da página, ative a chave \"Modo do desenvolvedor\". Sem isso, o Chrome não deixa carregar a extensão manualmente.",
  },
  {
    title: "Clique em \"Carregar sem compactação\"",
    text: "Um botão novo vai aparecer no topo da página. Clique nele e selecione a PASTA que você extraiu no passo 1 (não o arquivo .zip em si).",
  },
  {
    title: "Confirme que o ícone apareceu",
    text: "O ícone da extensão \"Nexo — Conector WhatsApp\" deve aparecer na barra de extensões do Chrome (ícone de peça de quebra-cabeça, no canto superior direito do navegador). Pode fixar o ícone clicando no alfinete pra deixar sempre visível.",
  },
  {
    title: "Abra e conecte o WhatsApp Web normalmente",
    text: "Acesse web.whatsapp.com e conecte com o QR Code do seu próprio celular, do jeito que você já faz sempre. A extensão só começa a funcionar com o WhatsApp Web já aberto e conectado.",
  },
  {
    title: "Gere o código de pareamento na plataforma",
    text: "Faça login na plataforma Nexo e vá até a página \"Extensão WA\" pra gerar um código de pareamento.",
  },
  {
    title: "Cole o código no popup da extensão",
    text: "Clique no ícone da extensão (barra do Chrome), cole o código gerado e confirme. Quando conectar, uma aba nova vai abrir mostrando o status \"conectado\" na plataforma.",
  },
];

export default function ExtensaoDownloadPage() {
  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4">
      <div className="mx-auto max-w-3xl">
        <div className="rounded-2xl bg-white p-8 shadow-sm border border-slate-200">
          <img src="/nexo-logo.png" alt="Nexo" className="h-10 w-auto object-contain mb-6" />

          <h1 className="text-2xl font-bold text-slate-900 mb-2">Nexo — Conector WhatsApp</h1>
          <p className="text-sm text-slate-500 mb-6">
            Conecta o WhatsApp Web que você já usa no navegador à sua conta Nexo — sem precisar de um número dedicado. Cria e atualiza seus leads no CRM automaticamente a partir das conversas.
          </p>

          <a
            href="/downloads/conector-whatsapp.zip"
            download
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-6 py-3 text-sm transition-colors"
          >
            ⬇ Baixar extensão (.zip)
          </a>
          <p className="text-xs text-slate-400 mt-2">Versão {EXTENSION_VERSION} · arquivo .zip · Google Chrome ou navegadores baseados em Chromium (Edge, Brave)</p>

          <section className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <h2 className="text-sm font-semibold text-amber-900 mb-1">⚠️ O Chrome vai avisar &quot;extensão não verificada&quot;</h2>
            <p className="text-sm text-amber-800">
              Isso é esperado — a extensão ainda não está publicada na Chrome Web Store, por isso foi instalada manualmente (modo desenvolvedor). Não é um problema de segurança, só um aviso padrão do Chrome pra qualquer extensão instalada fora da loja.
            </p>
          </section>
        </div>

        <div className="rounded-2xl bg-white p-8 shadow-sm border border-slate-200 mt-6">
          <h2 className="text-lg font-bold text-slate-900 mb-4">Como instalar — passo a passo</h2>
          <ol className="space-y-4">
            {steps.map((step, i) => (
              <li key={step.title} className="flex gap-3">
                <span className="flex-none w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-semibold flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{step.title}</p>
                  <p className="text-sm text-slate-600 mt-0.5">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <p className="text-xs text-slate-400 text-center mt-6">
          Antes de conectar, leia a{" "}
          <a href="/privacidade/extensao-whatsapp" className="underline hover:text-slate-600">
            política de privacidade e o aviso de risco
          </a>{" "}
          da extensão.
        </p>
      </div>
    </div>
  );
}
