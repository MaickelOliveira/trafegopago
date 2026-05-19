import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // instrumentationHook habilitado por padrão no Next.js 15+
  serverExternalPackages: [
    "@whiskeysockets/baileys",
    "jimp",
    "sharp",
    "@hapi/boom",
    "pino",
    "node-cron",
  ],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.fbcdn.net" },
      { protocol: "https", hostname: "**.facebook.com" },
      { protocol: "https", hostname: "**.cdninstagram.com" },
    ],
    unoptimized: true,
  },
};

export default nextConfig;
