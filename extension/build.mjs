import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync, existsSync } from "fs";

const OUT_DIR = "dist";

if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

// service-worker (declarado "type": "module" no manifest) e popup.js
// (carregado via <script type="module"> no popup.html) suportam ESM sem
// ressalva. content-script.js NÃO — content scripts do manifest.json rodam
// como script clássico por padrão, então precisa ser IIFE autocontido.
await esbuild.build({
  entryPoints: {
    "service-worker": "src/service-worker.ts",
    popup: "src/popup.ts",
  },
  bundle: true,
  format: "esm",
  target: "chrome116",
  outdir: OUT_DIR,
  minify: false,
  sourcemap: true,
});

// main-world roda no MAIN world (ver manifest.json) — mesma regra de script
// clássico do content-script, e além disso PRECISA ser autocontido: o
// mundo principal não tem acesso ao runtime de módulos da extensão.
await esbuild.build({
  entryPoints: { "content-script": "src/content-script.ts", "main-world": "src/main-world.ts" },
  bundle: true,
  format: "iife",
  target: "chrome116",
  outdir: OUT_DIR,
  minify: false,
  sourcemap: true,
});

cpSync("manifest.json", `${OUT_DIR}/manifest.json`);
cpSync("popup.html", `${OUT_DIR}/popup.html`);
cpSync("popup.css", `${OUT_DIR}/popup.css`);
cpSync("assets", `${OUT_DIR}/assets`, { recursive: true });

console.log(`Build ok — pasta pronta em ./${OUT_DIR} para "Carregar sem compactação" no chrome://extensions`);
