"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

// ─── Perguntas universais (sem seleção de nicho — nicho é definido pelo gestor) ─
const UNIVERSAL_QUESTIONS = [
  { id: "nome_negocio", label: "Nome do negócio", type: "text", placeholder: "Ex: Clínica Bem Estar", required: true },
  { id: "cidade", label: "Cidade / região de atendimento", type: "text", placeholder: "Ex: São Paulo - SP", required: true },
  { id: "horario", label: "Horário de funcionamento", type: "text", placeholder: "Ex: Seg a Sex das 8h às 18h, Sáb das 8h às 12h", required: true },
  { id: "servico_principal", label: "Principal produto / serviço que oferece", type: "textarea", placeholder: "Descreva brevemente o que você faz...", required: true },
  { id: "publico_alvo", label: "Quem é o seu cliente ideal?", type: "textarea", placeholder: "Ex: Mulheres entre 25-45 anos que querem emagrecer com saúde", required: true },
  { id: "diferencial", label: "Qual é o seu diferencial em relação à concorrência?", type: "textarea", placeholder: "O que faz você ser melhor ou diferente?", required: true },
  { id: "cta_principal", label: "Qual a ação principal que a IA deve pedir ao lead?", type: "text", placeholder: "Ex: Agendar consulta, Solicitar orçamento, Visitar loja", required: true },
  { id: "ticket_medio", label: "Ticket médio (valor aproximado do seu serviço/produto)", type: "text", placeholder: "Ex: R$ 150 por sessão / R$ 2.500 o pacote", required: false },
  { id: "objecoes", label: "Quais são as principais objeções / dúvidas dos clientes?", type: "textarea", placeholder: "Ex: Preço alto, falta de tempo, medo do resultado...", required: false },
  { id: "nome_assistente", label: "Como a IA deve se apresentar? (nome do assistente)", type: "text", placeholder: "Ex: Ana, Carlos, Assistente da Clínica...", required: false },
  { id: "tom_comunicacao", label: "Qual o tom de comunicação desejado?", type: "select", options: ["Formal e profissional", "Descontraído e amigável", "Consultivo e especialista", "Direto ao ponto"], required: true },
  { id: "info_extra", label: "Alguma informação extra importante que a IA precisa saber?", type: "textarea", placeholder: "Promoções, restrições, informações específicas...", required: false },
];

// ─── Perguntas por nicho ─────────────────────────────────────────────────────
const NICHE_QUESTIONS: Record<string, Array<{ id: string; label: string; type: string; placeholder?: string; options?: string[]; required?: boolean }>> = {
  "Pousada / Hotel Fazenda": [
    { id: "acomodacoes", label: "Quais categorias de acomodação você oferece?", type: "textarea", placeholder: "Ex: Chalé casal, suíte família, dormitório compartilhado..." },
    { id: "aceita_pets", label: "Aceita pets?", type: "select", options: ["Sim, aceita pets", "Não aceita pets", "Apenas pets pequenos"] },
    { id: "cafe_manha", label: "Café da manhã incluso?", type: "select", options: ["Sim, incluso", "Não incluso", "Opcional com custo adicional"] },
    { id: "atividades", label: "Quais atividades / atrativos oferece?", type: "textarea", placeholder: "Ex: Piscina, trilha, passeio a cavalo, tirolesa..." },
    { id: "politica_cancelamento", label: "Política de cancelamento", type: "textarea", placeholder: "Ex: Cancelamento gratuito até 48h antes, após isso cobra 30%..." },
    { id: "diaria_partir_de", label: "Diárias a partir de R$", type: "text", placeholder: "Ex: R$ 350 por casal" },
    { id: "capacidade", label: "Capacidade máxima de hóspedes", type: "text", placeholder: "Ex: 40 pessoas" },
  ],
  "Dentista / Clínica Odontológica": [
    { id: "especialidades", label: "Quais especialidades atende?", type: "textarea", placeholder: "Ex: Clínica geral, ortodontia, implante, clareamento..." },
    { id: "planos_aceitos", label: "Aceita planos dentários? Quais?", type: "textarea", placeholder: "Ex: Amil, SulAmérica, Unimed... ou particular apenas" },
    { id: "emergencia", label: "Atende emergências?", type: "select", options: ["Sim, atende emergências", "Não, somente agendamento", "Apenas para pacientes cadastrados"] },
    { id: "horario_sabado", label: "Atende aos sábados?", type: "select", options: ["Sim", "Não"] },
    { id: "primeira_consulta", label: "Primeira consulta / avaliação é gratuita?", type: "select", options: ["Sim, gratuita", "Não, tem custo", "Depende do procedimento"] },
  ],
  "Construtora / Reforma": [
    { id: "tipo_construcao", label: "Tipos de serviço que oferece", type: "textarea", placeholder: "Ex: Construção residencial, comercial, reformas, acabamento..." },
    { id: "faz_financiamento", label: "Facilita financiamento / parcelamento?", type: "select", options: ["Sim", "Não", "Em casos específicos"] },
    { id: "area_atuacao", label: "Estados / regiões onde atua", type: "text", placeholder: "Ex: SP, RJ, MG" },
    { id: "prazo_medio", label: "Prazo médio de uma obra", type: "text", placeholder: "Ex: Residência padrão em 8 meses" },
    { id: "area_minima", label: "Área mínima de projeto atendida (m²)", type: "text", placeholder: "Ex: A partir de 50m²" },
    { id: "garantia", label: "Oferece garantia? Qual?", type: "text", placeholder: "Ex: 5 anos estrutural, 1 ano acabamento" },
  ],
  "Clínica de Estética": [
    { id: "procedimentos", label: "Principais procedimentos oferecidos", type: "textarea", placeholder: "Ex: Botox, preenchimento, laser, drenagem linfática..." },
    { id: "aparelhos", label: "Aparelhos / equipamentos que possui", type: "textarea", placeholder: "Ex: Laser CO2, radiofrequência, ultrassom focalizado..." },
    { id: "medico_responsavel", label: "Tem médico responsável?", type: "select", options: ["Sim, médico residente", "Sim, supervisão médica", "Não"] },
    { id: "sessoes_resultado", label: "Em quantas sessões o cliente vê resultado (geral)?", type: "text", placeholder: "Ex: A maioria dos procedimentos em 3-5 sessões" },
    { id: "avaliacao_gratuita", label: "Faz avaliação gratuita?", type: "select", options: ["Sim, avaliação gratuita", "Não, cobrada", "Apenas presencial"] },
    { id: "parcelamento", label: "Aceita parcelamento? Em quantas vezes?", type: "text", placeholder: "Ex: Até 12x no cartão" },
  ],
  "Gráfica / Comunicação Visual": [
    { id: "produtos_principais", label: "Principais produtos que produz", type: "textarea", placeholder: "Ex: Banner, cartão de visita, panfleto, camiseta, adesivo..." },
    { id: "arte_inclusa", label: "Arte / criação gráfica está inclusa?", type: "select", options: ["Sim, incluída no preço", "Não, cliente traz o arquivo", "Opcional com custo extra"] },
    { id: "prazo_entrega", label: "Prazo de entrega padrão", type: "text", placeholder: "Ex: 2 dias úteis para cartão, 1 dia para banner" },
    { id: "faz_entrega", label: "Faz entrega / envio?", type: "select", options: ["Sim, entrega local", "Sim, envio nacional (correios/transportadora)", "Não, retirada no local"] },
    { id: "pedido_minimo", label: "Valor ou quantidade mínima de pedido?", type: "text", placeholder: "Ex: Mínimo de 100 cartões / R$ 50 em pedidos" },
    { id: "tempo_urgencia", label: "Atende com urgência? Em quanto tempo?", type: "text", placeholder: "Ex: Sim, com adicional de 20% em 24h" },
  ],
  "Imobiliária": [
    { id: "tipo_imoveis", label: "Tipos de imóveis que trabalha", type: "textarea", placeholder: "Ex: Residencial, comercial, rural, lotes, temporada..." },
    { id: "operacoes", label: "Tipo de operação", type: "select", options: ["Venda e locação", "Somente venda", "Somente locação", "Venda, locação e temporada"] },
    { id: "regioes", label: "Bairros / regiões de atuação", type: "textarea", placeholder: "Ex: Centro, Zona Sul, condomínios fechados..." },
    { id: "financiamento_caixa", label: "Tem imóveis financiáveis pela Caixa / bancos?", type: "select", options: ["Sim", "Não", "Alguns imóveis"] },
    { id: "avaliacao_imovel", label: "Faz avaliação de imóvel gratuita?", type: "select", options: ["Sim", "Não"] },
    { id: "numero_imoveis", label: "Quantos imóveis possui em carteira (aproximado)?", type: "text", placeholder: "Ex: +200 imóveis" },
  ],
  "Barbearia": [
    { id: "servicos", label: "Serviços disponíveis", type: "textarea", placeholder: "Ex: Corte masculino, barba, hidratação, sobrancelha..." },
    { id: "agenda_online", label: "Tem agendamento online?", type: "select", options: ["Sim, pelo WhatsApp", "Sim, app próprio", "Sim, AgendaApp/similar", "Não, presencial"] },
    { id: "atende_sem_hora", label: "Atende sem hora marcada (walk-in)?", type: "select", options: ["Sim, sempre", "Sim, quando tem vaga", "Não, somente agendado"] },
    { id: "funciona_domingo", label: "Funciona aos domingos?", type: "select", options: ["Sim", "Não", "Domingos alternados"] },
    { id: "estacionamento", label: "Tem estacionamento?", type: "select", options: ["Sim, próprio", "Sim, conveniado", "Não"] },
    { id: "numero_cadeiras", label: "Quantas cadeiras / barbeiros?", type: "text", placeholder: "Ex: 4 barbeiros" },
  ],
  "Salão de Beleza": [
    { id: "servicos_salao", label: "Principais serviços oferecidos", type: "textarea", placeholder: "Ex: Corte, coloração, escova, progressiva, manicure..." },
    { id: "profissional_afro", label: "Tem profissional especializado em cabelo afro / crespo?", type: "select", options: ["Sim", "Não"] },
    { id: "aceita_criancas", label: "Atende crianças?", type: "select", options: ["Sim", "Não"] },
    { id: "produtos_usados", label: "Quais marcas / linhas de produtos utiliza?", type: "textarea", placeholder: "Ex: Loreal, Wella, produtos veganos..." },
    { id: "funciona_agendamento", label: "Funciona com agendamento?", type: "select", options: ["Obrigatório agendar", "Preferível, mas aceita sem hora", "Sem necessidade de agendamento"] },
    { id: "numero_profissionais", label: "Quantos profissionais trabalham no salão?", type: "text", placeholder: "Ex: 5 profissionais" },
  ],
  "Manicure / Nail Designer": [
    { id: "especialidades_nail", label: "Especialidades / técnicas", type: "textarea", placeholder: "Ex: Gel, acrigel, fibra de vidro, encapsulamento, nail art..." },
    { id: "atende_domicilio", label: "Atende a domicílio?", type: "select", options: ["Sim, atende a domicílio", "Somente no estúdio", "Ambas as opções"] },
    { id: "duracao_procedimento", label: "Duração média de cada procedimento", type: "textarea", placeholder: "Ex: Gel completo 2h, francesinha 45min..." },
    { id: "agenda_nail", label: "Como é feito o agendamento?", type: "select", options: ["WhatsApp", "Instagram", "App de agendamento", "Telefone"] },
    { id: "valor_manutencao", label: "Frequência recomendada de manutenção", type: "text", placeholder: "Ex: A cada 21 dias" },
  ],
  "Nutricionista": [
    { id: "especialidade_nutri", label: "Especialidade(s) de atuação", type: "textarea", placeholder: "Ex: Emagrecimento, esportiva, infantil, pré e pós-operatório..." },
    { id: "atende_online_nutri", label: "Atende online?", type: "select", options: ["Sim, presencial e online", "Somente presencial", "Somente online"] },
    { id: "plano_saude_nutri", label: "Aceita plano de saúde?", type: "select", options: ["Sim", "Não, particular apenas", "Alguns planos"] },
    { id: "duracao_consulta", label: "Duração da consulta", type: "text", placeholder: "Ex: 1h primeira consulta, 45min retorno" },
    { id: "retorno_nutri", label: "Com que frequência é o retorno?", type: "text", placeholder: "Ex: A cada 30 dias" },
  ],
  "Psicólogo / Terapeuta": [
    { id: "abordagem", label: "Abordagem terapêutica utilizada", type: "textarea", placeholder: "Ex: TCC, psicanálise, gestalt, sistêmica..." },
    { id: "atende_online_psi", label: "Atende online?", type: "select", options: ["Sim, presencial e online", "Somente presencial", "Somente online"] },
    { id: "plano_saude_psi", label: "Aceita plano de saúde?", type: "select", options: ["Sim", "Não, particular apenas", "Alguns planos"] },
    { id: "publico_psi", label: "Quais públicos atende?", type: "textarea", placeholder: "Ex: Adultos, adolescentes, crianças, casais, empresas..." },
    { id: "primeira_sessao", label: "Primeira sessão / triagem é gratuita?", type: "select", options: ["Sim, gratuita", "Não, cobrada normalmente", "Valor reduzido"] },
  ],
  "Personal Trainer / Academia": [
    { id: "tipo_treino", label: "Modalidades / tipos de treino", type: "textarea", placeholder: "Ex: Musculação, funcional, pilates, crossfit, emagrecimento..." },
    { id: "modalidade_atendimento", label: "Modalidade de atendimento", type: "select", options: ["Presencial (academia/estúdio)", "Domicílio", "Online", "Todas as modalidades"] },
    { id: "nivel_aluno", label: "Atende todos os níveis?", type: "select", options: ["Sim, do iniciante ao avançado", "Somente iniciantes", "Somente intermediário/avançado"] },
    { id: "avaliacao_fisica", label: "Inclui avaliação física?", type: "select", options: ["Sim, gratuita", "Sim, paga", "Não"] },
    { id: "frequencia_semana", label: "Frequência de treino recomendada", type: "text", placeholder: "Ex: 3x por semana para iniciantes" },
  ],
  "Advogado / Escritório de Advocacia": [
    { id: "areas_atuacao", label: "Áreas de atuação", type: "textarea", placeholder: "Ex: Trabalhista, família, penal, cível, empresarial, previdenciário..." },
    { id: "atende_online_adv", label: "Atende online?", type: "select", options: ["Sim", "Não", "Apenas consultas online"] },
    { id: "consulta_gratuita_adv", label: "Tem consulta inicial gratuita?", type: "select", options: ["Sim", "Não", "Triagem gratuita"] },
    { id: "pessoa_fisica_juridica", label: "Atende pessoas físicas, jurídicas ou ambas?", type: "select", options: ["Ambas", "Somente pessoa física", "Somente pessoa jurídica"] },
    { id: "honorarios", label: "Modelo de honorários", type: "textarea", placeholder: "Ex: Fixo, êxito, hora trabalhada, mensalidade..." },
  ],
  "Contador / Contabilidade": [
    { id: "tipo_empresas", label: "Tipo de empresas / clientes que atende", type: "textarea", placeholder: "Ex: MEI, ME, EPP, profissionais liberais, startups..." },
    { id: "servicos_contabilidade", label: "Serviços oferecidos", type: "textarea", placeholder: "Ex: Abertura de empresa, BPO financeiro, IR pessoa física, folha de pagamento..." },
    { id: "atende_remoto_cont", label: "Atende de forma remota / digital?", type: "select", options: ["Sim, 100% digital", "Híbrido", "Somente presencial"] },
    { id: "regimes_tributarios", label: "Regimes tributários que domina", type: "textarea", placeholder: "Ex: Simples Nacional, Lucro Presumido, Lucro Real..." },
  ],
  "Restaurante / Delivery": [
    { id: "tipo_culinaria", label: "Tipo de culinária / cardápio principal", type: "text", placeholder: "Ex: Japonesa, brasileira, pizzaria, hamburguer artesanal..." },
    { id: "faz_delivery", label: "Faz delivery?", type: "select", options: ["Sim, pelo WhatsApp", "Sim, apps (iFood, Rappi...)", "Sim, WhatsApp + apps", "Não, somente no local"] },
    { id: "horario_funcionamento_rest", label: "Dias e horários de funcionamento", type: "text", placeholder: "Ex: Ter a Dom, 18h às 23h" },
    { id: "reserva_mesa", label: "Aceita reserva de mesa?", type: "select", options: ["Sim", "Não"] },
    { id: "opcao_vegetariana", label: "Tem opções vegetarianas / veganas?", type: "select", options: ["Sim", "Não", "Algumas opções"] },
    { id: "pedido_minimo_rest", label: "Valor mínimo para delivery?", type: "text", placeholder: "Ex: R$ 30 para delivery" },
  ],
  "Pet Shop / Veterinária": [
    { id: "servicos_pet", label: "Serviços disponíveis", type: "textarea", placeholder: "Ex: Consulta veterinária, banho e tosa, pet hotel, vacinas, cirurgia..." },
    { id: "atende_urgencia_pet", label: "Atende urgências?", type: "select", options: ["Sim, 24h", "Sim, durante o horário comercial", "Não"] },
    { id: "especies_atendidas", label: "Espécies atendidas", type: "textarea", placeholder: "Ex: Cães e gatos, exóticos, aves, répteis..." },
    { id: "pet_hotel", label: "Tem pet hotel / creche?", type: "select", options: ["Sim", "Não"] },
    { id: "delivery_racao", label: "Faz entrega de ração / produtos?", type: "select", options: ["Sim", "Não"] },
  ],
  "Médico / Clínica Médica": [
    { id: "especialidades_med", label: "Especialidades médicas disponíveis", type: "textarea", placeholder: "Ex: Clínica geral, dermatologia, cardiologia, ginecologia..." },
    { id: "planos_med", label: "Aceita planos de saúde? Quais?", type: "textarea", placeholder: "Ex: Unimed, Amil, SulAmérica... ou particular" },
    { id: "telemedicina", label: "Faz telemedicina / teleconsulta?", type: "select", options: ["Sim", "Não"] },
    { id: "urgencia_med", label: "Atende urgências / walk-in?", type: "select", options: ["Sim", "Não, somente agendado"] },
    { id: "exames_lab", label: "Realiza exames / procedimentos no local?", type: "textarea", placeholder: "Ex: Exames laboratoriais, raio-X, ECG..." },
  ],
  "Fotógrafo / Videomaker": [
    { id: "especialidade_foto", label: "Especialidade(s) de atuação", type: "textarea", placeholder: "Ex: Casamento, ensaio de família, produto, corporativo, eventos..." },
    { id: "area_atuacao_foto", label: "Onde atua (viaja para outras cidades?)", type: "text", placeholder: "Ex: São Paulo e Grande SP, viaja mediante taxa" },
    { id: "prazo_entrega_foto", label: "Prazo de entrega do material", type: "text", placeholder: "Ex: 30 dias para casamento, 7 dias para ensaio" },
    { id: "formato_entrega", label: "Formato de entrega", type: "textarea", placeholder: "Ex: Galeria online, pendrive, álbum impresso..." },
    { id: "contrato", label: "Exige contrato e sinal para reservar data?", type: "select", options: ["Sim", "Não"] },
  ],
  "Loja de Roupa / Boutique": [
    { id: "estilo_roupas", label: "Estilo / público da loja", type: "textarea", placeholder: "Ex: Moda feminina casual, plus size, infantil, social masculino..." },
    { id: "vende_online", label: "Vende online?", type: "select", options: ["Sim, pelo WhatsApp", "Sim, site/e-commerce", "Sim, ambos", "Não, somente loja física"] },
    { id: "tamanhos_disponiveis", label: "Tamanhos disponíveis", type: "text", placeholder: "Ex: P ao GG / 36 ao 54" },
    { id: "faz_entrega_roupas", label: "Faz entrega?", type: "select", options: ["Sim, local", "Sim, nacional", "Não"] },
    { id: "troca_devolucao", label: "Política de troca / devolução", type: "text", placeholder: "Ex: Troca em até 7 dias com nota fiscal" },
  ],
  "Automecânica / Oficina": [
    { id: "servicos_auto", label: "Serviços disponíveis", type: "textarea", placeholder: "Ex: Revisão, freios, suspensão, elétrica, ar-condicionado, funilaria..." },
    { id: "marcas_atendidas", label: "Marcas / modelos que atende", type: "text", placeholder: "Ex: Todas as marcas / somente VW e GM" },
    { id: "orcamento_gratuito", label: "Faz orçamento gratuito?", type: "select", options: ["Sim", "Não, cobrado e desconta no serviço"] },
    { id: "servico_guincho", label: "Tem serviço de guincho / reboque?", type: "select", options: ["Sim, próprio", "Sim, parceiro", "Não"] },
    { id: "garantia_servico", label: "Oferece garantia nos serviços?", type: "text", placeholder: "Ex: 6 meses em peças e mão de obra" },
  ],
};

const NICHES = Object.keys(NICHE_QUESTIONS);

const NICHE_ICONS: Record<string, string> = {
  "Pousada / Hotel Fazenda": "🏡",
  "Dentista / Clínica Odontológica": "🦷",
  "Construtora / Reforma": "🏗️",
  "Clínica de Estética": "✨",
  "Gráfica / Comunicação Visual": "🖨️",
  "Imobiliária": "🏠",
  "Barbearia": "💈",
  "Salão de Beleza": "💇",
  "Manicure / Nail Designer": "💅",
  "Nutricionista": "🥗",
  "Psicólogo / Terapeuta": "🧠",
  "Personal Trainer / Academia": "💪",
  "Advogado / Escritório de Advocacia": "⚖️",
  "Contador / Contabilidade": "📊",
  "Restaurante / Delivery": "🍽️",
  "Pet Shop / Veterinária": "🐾",
  "Médico / Clínica Médica": "🩺",
  "Fotógrafo / Videomaker": "📷",
  "Loja de Roupa / Boutique": "👗",
  "Automecânica / Oficina": "🔧",
};

export default function BriefingPage() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");
  const [preNiche, setPreNiche] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/briefing/${token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setError(data.error); return; }
        setClientName(data.clientName);
        if (data.niche) {
          setPreNiche(data.niche);
          setAnswers((a) => ({ ...a, nicho: data.niche }));
        }
      })
      .catch(() => setError("Erro ao carregar o formulário."))
      .finally(() => setLoading(false));
  }, [token]);

  const selectedNiche = preNiche;
  const nicheQuestions = selectedNiche ? (NICHE_QUESTIONS[selectedNiche] ?? []) : [];

  const allQuestions = UNIVERSAL_QUESTIONS;

  function setAnswer(id: string, value: string) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Valida campos obrigatórios
    for (const q of [...allQuestions, ...nicheQuestions]) {
      if (q.required && !answers[q.id]?.trim()) {
        alert(`Por favor, preencha o campo: "${q.label}"`);
        return;
      }
    }
    // Inclui o nicho nas respostas para referência
    const finalAnswers = selectedNiche ? { nicho: selectedNiche, ...answers } : answers;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/briefing/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: finalAnswers }),
      });
      const text = await res.text();
      let data: { error?: string; ok?: boolean } = {};
      try { data = JSON.parse(text); } catch { /* resposta não-JSON */ }
      if (!res.ok) {
        alert(data.error ?? `Erro ${res.status}`);
        return;
      }
      setSubmitted(true);
    } catch (err) {
      alert("Erro de conexão. Verifique sua internet e tente novamente.");
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-slate-500 text-sm animate-pulse">Carregando...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="text-4xl mb-4">❌</div>
          <p className="text-slate-900 font-semibold text-lg mb-2">Formulário indisponível</p>
          <p className="text-slate-500 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="text-6xl mb-6">✅</div>
          <h1 className="text-slate-900 font-bold text-2xl mb-3">Briefing enviado!</h1>
          <p className="text-slate-500 text-sm leading-relaxed">
            Recebemos todas as suas informações. Nossa equipe já foi notificada e entrará em contato em breve para configurar o seu assistente de IA no WhatsApp.
          </p>
          <p className="text-slate-400 text-xs mt-6">Você pode fechar esta janela.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 bg-violet-100 border border-violet-200 rounded-full px-4 py-1.5">
            <span className="text-violet-700 text-xs font-semibold uppercase tracking-wider">Configuração do Assistente de IA</span>
          </div>
          <h1 className="text-slate-900 text-2xl font-bold">
            Briefing — <span className="text-violet-600">{clientName}</span>
          </h1>
          {selectedNiche && (
            <div className="inline-flex items-center gap-2 bg-slate-100 border border-slate-200 rounded-full px-4 py-1.5">
              <span className="text-base">{NICHE_ICONS[selectedNiche] ?? "📋"}</span>
              <span className="text-slate-600 text-xs font-medium">{selectedNiche}</span>
            </div>
          )}
          <p className="text-slate-500 text-sm max-w-md mx-auto">
            Preencha as informações abaixo para configurarmos o seu assistente de WhatsApp com Inteligência Artificial.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Perguntas universais */}
          {allQuestions.map((q) => (
            <QuestionField
              key={q.id}
              question={q}
              value={answers[q.id] ?? ""}
              onChange={(v) => setAnswer(q.id, v)}
            />
          ))}

          {/* Perguntas específicas do nicho */}
          {nicheQuestions.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-violet-200" />
                <span className="text-violet-700 text-xs font-semibold uppercase tracking-wider">
                  {NICHE_ICONS[selectedNiche!] ?? "📋"} Sobre o seu negócio
                </span>
                <div className="h-px flex-1 bg-violet-200" />
              </div>
              {nicheQuestions.map((q) => (
                <QuestionField
                  key={q.id}
                  question={q}
                  value={answers[q.id] ?? ""}
                  onChange={(v) => setAnswer(q.id, v)}
                />
              ))}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold py-3.5 rounded-xl transition text-sm"
          >
            {submitting ? "Enviando..." : "Enviar Briefing ✅"}
          </button>
        </form>

        <p className="text-center text-slate-400 text-xs pb-6">
          Suas informações são confidenciais e usadas exclusivamente para configurar seu assistente de IA.
        </p>
      </div>
    </div>
  );
}

function QuestionField({
  question, value, onChange,
}: {
  question: { id: string; label: string; type: string; placeholder?: string; options?: string[]; required?: boolean };
  value: string;
  onChange: (v: string) => void;
}) {
  const inputClass = "w-full bg-white border border-slate-300 text-slate-900 rounded-xl px-4 py-3 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition placeholder:text-slate-400";

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-slate-700">
        {question.label}
        {question.required && <span className="text-violet-600 ml-1">*</span>}
      </label>

      {question.type === "select" ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass + " bg-white"}>
          <option value="">Selecione...</option>
          {question.options?.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ) : question.type === "textarea" ? (
        <textarea
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={question.placeholder}
          className={inputClass + " resize-none"}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={question.placeholder}
          className={inputClass}
        />
      )}
    </div>
  );
}
