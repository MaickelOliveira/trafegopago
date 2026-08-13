// Empacota ./dist num .zip pronto pra upload na Chrome Web Store — usa o
// binário `zip` do sistema (disponível por padrão em macOS/Linux) em vez de
// adicionar mais uma dependência npm só pra isso.
import { execSync } from "child_process";
import { existsSync, rmSync, mkdirSync, copyFileSync } from "fs";

const OUT_FILE = "conector-whatsapp.zip";
// ⚠️ O Dockerfile de produção NUNCA copia a pasta extension/ pra imagem final
// (só public/, .next/standalone, .next/static, wa-service.js, node_modules) —
// um link de download apontando pra dentro de extension/ quebraria em
// produção. Copia o .zip pra public/downloads/ (que É copiada) toda vez que
// o pacote é gerado, pra /extensao-download sempre servir a versão mais nova
// sem precisar de passo manual extra.
const PUBLIC_DOWNLOAD_DIR = "../public/downloads";
const PUBLIC_DOWNLOAD_FILE = `${PUBLIC_DOWNLOAD_DIR}/${OUT_FILE}`;

if (!existsSync("dist")) {
  console.error('Pasta "dist" não encontrada — rode "npm run build" primeiro.');
  process.exit(1);
}

if (existsSync(OUT_FILE)) rmSync(OUT_FILE);

execSync(`cd dist && zip -r -X ../${OUT_FILE} .`, { stdio: "inherit" });
console.log(`Pacote gerado: ${OUT_FILE}`);

mkdirSync(PUBLIC_DOWNLOAD_DIR, { recursive: true });
copyFileSync(OUT_FILE, PUBLIC_DOWNLOAD_FILE);
console.log(`Copiado pra ${PUBLIC_DOWNLOAD_FILE} (servido em /extensao-download)`);
