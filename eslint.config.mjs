import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Extensão Chrome tem seu próprio toolchain (tsc --noEmit) — não é código
    // Next/React, não faz sentido rodar as regras deste config nela.
    "extension/**",
  ]),
]);

export default eslintConfig;
