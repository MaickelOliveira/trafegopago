// Empacota ./dist num .zip pronto pra upload na Chrome Web Store — usa o
// binário `zip` do sistema (disponível por padrão em macOS/Linux) em vez de
// adicionar mais uma dependência npm só pra isso.
import { execSync } from "child_process";
import { existsSync, rmSync } from "fs";

const OUT_FILE = "conector-whatsapp.zip";

if (!existsSync("dist")) {
  console.error('Pasta "dist" não encontrada — rode "npm run build" primeiro.');
  process.exit(1);
}

if (existsSync(OUT_FILE)) rmSync(OUT_FILE);

execSync(`cd dist && zip -r -X ../${OUT_FILE} .`, { stdio: "inherit" });
console.log(`Pacote gerado: ${OUT_FILE}`);
