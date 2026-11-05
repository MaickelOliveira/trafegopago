function wrapByWords(text: string, maxLen: number, chunks: string[]): string {
  const words = text.split(" ");
  let wordBuf = "";
  for (const word of words) {
    const wjoined = wordBuf ? wordBuf + " " + word : word;
    if (wjoined.length <= maxLen) {
      wordBuf = wjoined;
    } else {
      if (wordBuf) chunks.push(wordBuf);
      // Só corta uma palavra isolada se ela sozinha já for maior que maxLen.
      wordBuf = word.length <= maxLen ? word : word.slice(0, maxLen);
    }
  }
  return wordBuf;
}

// Divide no ponto/exclamação/interrogação seguido de espaço — nunca corta no
// meio de uma frase. Só cai pra quebra por palavra quando uma frase sozinha
// já é maior que maxLen. Sem isso, uma linha/parágrafo grande demais caía
// direto na quebra por palavra e podia terminar uma bolha no meio de uma
// frase (ex.: "...(dias 16 e" | "17) é em agosto...").
function wrapBySentences(text: string, maxLen: number, chunks: string[]): string {
  const sentences = text.split(/(?<=[.!?])\s+(?=\S)/).map((s) => s.trim()).filter(Boolean);
  let buf = "";
  for (const sentence of sentences) {
    const joined = buf ? buf + " " + sentence : sentence;
    if (joined.length <= maxLen) {
      buf = joined;
    } else {
      if (buf) chunks.push(buf);
      buf = sentence.length <= maxLen ? sentence : wrapByWords(sentence, maxLen, chunks);
    }
  }
  return buf;
}

/**
 * Divide uma resposta longa em partes menores respeitando parágrafos e frases.
 * Prioridade: dupla quebra → quebra simples → ponto/exclamação/interrogação → tamanho máximo.
 */
export function splitMessage(text: string, maxLen = 300): string[] {
  // Corrige quebras acidentais em expressões numéricas:
  //   "24/\n\n7"  → "24/7"   (fração/horário partido)
  //   "1\n\n2-"  → "12-"    (data/número partido)
  //   "1.997,\n\n00"  → "1.997,00"  (valor decimal/monetário partido na vírgula)
  const trimmed = text
    .trim()
    .replace(/(\d+\/)\s*\n[\s\n]*(\d)/g, "$1$2")
    .replace(/(\d)\s*\n[\s\n]+(\d[-.:\/])/g, "$1$2")
    .replace(/(\d),\s*\n[\s\n]*(\d)/g, "$1,$2")
    // Reconecta quando linha termina com hífen e a próxima começa com dígito
    // ex: "NR-\n\n1." → "NR-1."
    .replace(/(-)\s*\n[\s\n]*(\d)/g, "$1$2");

  if (trimmed.length <= maxLen) return [trimmed];

  const chunks: string[] = [];

  // 1ª tentativa: dividir por parágrafo (linha em branco)
  const paragraphs = trimmed.split(/\n\s*\n/);
  let current = "";

  // Detecta seção numerada: "1. TÍTULO", "*1. TÍTULO"
  const isSection = (p: string) => /^\*?\d+[\.\)]\s/.test(p);
  // Detecta sub-seção com bullet bold: "• *Malha X:*", "• *Fio X:*", "• *Postes:*"
  const isSubSection = (p: string) => /^•\s*\*[^*\n]+\*/.test(p);
  console.log(`[split v3] paras=${paragraphs.length} maxLen=${maxLen}`);

  for (const para of paragraphs) {
    const piece = para.trim();
    if (!piece) continue;

    // Seções e sub-seções SEMPRE começam uma nova bolha
    if ((isSection(piece) || isSubSection(piece)) && current) {
      chunks.push(current);
      current = "";
    }

    if ((current + (current ? "\n\n" : "") + piece).length <= maxLen) {
      current += (current ? "\n\n" : "") + piece;
    } else {
      if (current) chunks.push(current);
      current = "";

      if (piece.length > maxLen) {
        // Parágrafo maior que maxLen: divide por linha (nunca corta no meio de uma linha)
        const lines = piece.split("\n");
        let lineBuf = "";
        for (const line of lines) {
          const joined = lineBuf ? lineBuf + "\n" + line : line;
          if (joined.length <= maxLen) {
            lineBuf = joined;
          } else {
            if (lineBuf) chunks.push(lineBuf);
            if (line.length <= maxLen) {
              lineBuf = line;
            } else {
              // Linha sozinha maior que maxLen: quebra por frase (nunca por palavra
              // direto) — NUNCA descarta o restante do texto.
              lineBuf = wrapBySentences(line, maxLen, chunks);
            }
          }
        }
        current = lineBuf;
      } else {
        current = piece;
      }
    }
  }

  if (current) chunks.push(current);

  // Pós-processamento: absorve chunk que seja APENAS dígitos soltos (ex: "1", "12.", "7-")
  // OU um fragmento de texto muito curto que sobrou da quebra por palavra (ex: "informação.").
  // Isso evita que a última palavra de uma frase vire uma bolha isolada e estranha no WhatsApp.
  // Não mexe em chunks que iniciam uma seção/subseção nova ("1." ou "• *Título*"), pois ali
  // a quebra em bolha própria é intencional.
  const isTinyFragment = (s: string) => {
    const t = s.trim();
    if (!t) return false;
    if (isSection(t) || isSubSection(t)) return false;
    return /^\d{1,4}[-.\s]*$/.test(t) || t.length < 25;
  };
  const merged: string[] = [];
  for (const chunk of chunks.filter(Boolean)) {
    if (isTinyFragment(chunk) && merged.length > 0) {
      const prev = merged[merged.length - 1];
      const sep = /[\s\n\/]$/.test(prev) ? "" : " ";
      merged[merged.length - 1] = prev + sep + chunk.trim();
    } else {
      merged.push(chunk);
    }
  }

  // Pós-processamento: nunca deixa uma bolha terminar com parênteses "abertos"
  // (ex: "...no domingo (dia" | "16) ou..." — já aconteceu na prática com o
  // Vitalli). Se uma bolha tem mais "(" do que ")", gruda ela na próxima até
  // fechar — mesma ideia do merge de fragmento curto acima, mas para parênteses.
  const unclosedParens = (s: string) => {
    let depth = 0;
    for (const ch of s) {
      if (ch === "(") depth++;
      else if (ch === ")") depth = Math.max(0, depth - 1);
    }
    return depth;
  };
  const parenFixed: string[] = [];
  for (const chunk of merged) {
    const last = parenFixed[parenFixed.length - 1];
    if (last !== undefined && unclosedParens(last) > 0) {
      const sep = /[\s\n]$/.test(last) ? "" : " ";
      parenFixed[parenFixed.length - 1] = last + sep + chunk;
    } else {
      parenFixed.push(chunk);
    }
  }

  // Pós-processamento: nunca deixa uma bolha terminar com vírgula decimal
  // "solta" (ex: "...é de R$ 330," | "00." — já aconteceu na prática com o
  // Vitalli, duas vezes na mesma mensagem). Uma vírgula logo após um dígito,
  // bem no fim da bolha, nunca é o fim natural de uma frase — é sempre um
  // valor decimal partido ao meio. Gruda na próxima bolha até sair da vírgula.
  const endsWithDanglingComma = (s: string) => /\d,\s*$/.test(s);
  const commaFixed: string[] = [];
  for (const chunk of parenFixed) {
    const last = commaFixed[commaFixed.length - 1];
    if (last !== undefined && endsWithDanglingComma(last)) {
      const sep = /[\s\n]$/.test(last) ? "" : " ";
      commaFixed[commaFixed.length - 1] = last + sep + chunk;
    } else {
      commaFixed.push(chunk);
    }
  }
  return commaFixed;
}
