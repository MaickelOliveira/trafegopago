// Verificação manual de stripJsonToolCallLeaks e sanitizeForWhatsApp.
// Rodar: npx tsx scripts/verify-sanitize.ts
import { stripJsonToolCallLeaks, sanitizeForWhatsApp } from "../src/lib/gemini-agent";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const PHONE = "5544999999999";

console.log("\n=== BUG 1: stripJsonToolCallLeaks ===\n");

// 1. Caso real do incidente (Vitalli 04/08): JSON solto com action_input string de aspas simples
{
  const text = `Recebi os dados de vocês, muito obrigada! 😊\n\nCom vocês três, o valor total fica R$ 285,00.\n\nDados para o Pix:\nChave: CNPJ 63.529.514/0001-59\n\n{\n "action": "enviar_resumo",\n "action_input": "{'motivo': 'DADOS RECEBIDOS: cliente enviou dados para Almoço Dia dos Pais — aguardando pagamento'}"\n}`;
  const r = stripJsonToolCallLeaks(text, PHONE);
  check("1a. JSON removido do texto", !r.text.includes("{") && !r.text.includes("action"));
  check("1b. texto útil preservado", r.text.includes("R$ 285,00") && r.text.includes("63.529.514"));
  check(
    "1c. motivo recuperado",
    r.recovered.length === 1 &&
      r.recovered[0].type === "resumo_solicitado" &&
      r.recovered[0].motivo === "DADOS RECEBIDOS: cliente enviou dados para Almoço Dia dos Pais — aguardando pagamento",
    JSON.stringify(r.recovered),
  );
}

// 2. Mesmo bloco dentro de ```json fence
{
  const text = `Perfeito!\n\n\`\`\`json\n{\n "action": "enviar_resumo",\n "action_input": "{'motivo': 'PAGAMENTO PIX: comprovante recebido'}"\n}\n\`\`\``;
  const r = stripJsonToolCallLeaks(text, PHONE);
  check("2a. bloco e fence removidos", !r.text.includes("{") && !r.text.includes("```"), JSON.stringify(r.text));
  check(
    "2b. motivo recuperado do fence",
    r.recovered.length === 1 && r.recovered[0].type === "resumo_solicitado" && r.recovered[0].motivo === "PAGAMENTO PIX: comprovante recebido",
    JSON.stringify(r.recovered),
  );
}

// 3. action_input como objeto JSON válido
{
  const text = `Ok!\n{"action":"enviar_resumo","action_input":{"motivo":"PAGAMENTO PIX: comprovante recebido"}}`;
  const r = stripJsonToolCallLeaks(text, PHONE);
  check(
    "3. parse direto de objeto",
    r.recovered.length === 1 && r.recovered[0].type === "resumo_solicitado" && r.recovered[0].motivo === "PAGAMENTO PIX: comprovante recebido",
    JSON.stringify(r.recovered),
  );
}

// 4. Chaves aninhadas dentro da string do motivo
{
  const text = `Certo.\n{"action": "enviar_resumo", "action_input": "{'motivo': 'DADOS: {nome: Ana}'}"}`;
  const r = stripJsonToolCallLeaks(text, PHONE);
  check("4a. contagem fecha no } externo", r.text.trim() === "Certo.", JSON.stringify(r.text));
  check(
    "4b. motivo com chaves internas",
    r.recovered.length === 1 && r.recovered[0].type === "resumo_solicitado" && r.recovered[0].motivo === "DADOS: {nome: Ana}",
    JSON.stringify(r.recovered),
  );
}

// 5. JSON truncado (resposta cortada)
{
  const text = `Anotado!\n{"action": "enviar_resumo", "action_input": "{'motivo': 'DADOS RECEBIDOS: cliente env`;
  const r = stripJsonToolCallLeaks(text, PHONE);
  check("5a. bloco truncado removido", r.text.trim() === "Anotado!", JSON.stringify(r.text));
  check("5b. action fallback gerada", r.recovered.length === 1 && r.recovered[0].type === "resumo_solicitado", JSON.stringify(r.recovered));
}

// 6. Outra ferramenta vazada (não executar retroativamente, só avisar)
{
  const text = `Vou agendar!\n{"action": "agendar_compromisso", "action_input": "{'titulo': 'Consulta', 'data': '2026-08-10', 'hora_inicio': '14:00'}"}`;
  const r = stripJsonToolCallLeaks(text, PHONE);
  check("6a. bloco removido", r.text.trim() === "Vou agendar!", JSON.stringify(r.text));
  check(
    "6b. aviso de não-executada",
    r.recovered.length === 1 &&
      r.recovered[0].type === "resumo_solicitado" &&
      r.recovered[0].motivo.includes("agendar_compromisso") &&
      r.recovered[0].motivo.includes("NÃO foi executada"),
    JSON.stringify(r.recovered),
  );
}

// 7. Falso positivo: chaves sem marcador de tool call
{
  const text = `Nosso combo {família} sai por R$ 100 e o {casal} por R$ 80.`;
  const r = stripJsonToolCallLeaks(text, PHONE);
  check("7. texto com chaves comuns intocado", r.text === text && r.recovered.length === 0, JSON.stringify(r));
}

// 8. Texto normal sem chaves
{
  const text = `Olá! Tudo bem? O valor é R$ 200,00 por adulto.`;
  const r = stripJsonToolCallLeaks(text, PHONE);
  check("8. texto normal intocado", r.text === text && r.recovered.length === 0);
}

console.log("\n=== BUG 2: sanitizeForWhatsApp (split de centavos) ===\n");

// 9. Caso real: "R$ 285,00. Segue" não pode ganhar quebra no meio
{
  const out = sanitizeForWhatsApp("O valor total fica em R$ 285,00. Segue a chave Pix.");
  check("9. R$ 285,00. sem quebra", !out.includes("285,\n"), JSON.stringify(out));
}

// 10. Milhar + centavos
{
  const out = sanitizeForWhatsApp("O pacote custa R$ 1.997,00. Podemos prosseguir?");
  check("10. R$ 1.997,00. sem quebra", !out.includes(",\n"), JSON.stringify(out));
}

// 11. Proteção antiga da L246 continua (caso ",NN" colado em número de item)
{
  const out = sanitizeForWhatsApp("O total é R$ 19,152. Confirma?");
  check("11. proteção de centavos L246 mantida", out.includes("19,15"), JSON.stringify(out));
}

// 12. Lista numerada legítima continua quebrando
{
  const out = sanitizeForWhatsApp("Temos duas opções: 1. Standard Duplo 2. Standard Individual");
  check("12. lista numerada ainda quebra", out.includes("\n\n1. ") && out.includes("\n\n2. "), JSON.stringify(out));
}

// 13. Horário não quebra (guard existente)
{
  const out = sanitizeForWhatsApp("Fechamos às 12:30. Como posso ajudar?");
  check("13. horário 12:30. intocado", !out.includes("12:\n"), JSON.stringify(out));
}

// 14. Caso real (Vitalli, lead Cristina, 05/08/2026): o próprio Gemini gerou a
// quebra "R$ 190,\n\n00." no texto bruto — antes de qualquer regra de
// sanitização rodar. Confirma que a regra de reparo (topo de sanitizeForWhatsApp)
// junta de volta o valor, não importa a origem da quebra.
{
  const raw = "Perfeito! 🥩\n\nPara o Dia dos Pais (09/08), o valor total para 2 adultos e uma criança de 4 anos fica R$ 190,\n\n00.\n\n\n\nPara que eu possa registrar sua reserva, por gentileza, me informe o nome completo e a idade de cada participante.\n\nDados para o Pix (pagamento integral):\n• Chave: CNPJ 63.529.514/0001-59\n• Favorecido: Vitalli\n\nAssim que me passar os nomes e idades, já deixo tudo reservado para vocês! 😊";
  const out = sanitizeForWhatsApp(raw);
  check("14. R$ 190,00 (quebra gerada pelo modelo) reparado", out.includes("R$ 190,00.") && !out.includes("190,\n"), JSON.stringify(out.slice(0, 140)));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
