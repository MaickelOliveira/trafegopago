import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async redirects() { return [
    { source: "/gestor/:clientId/pousada/:path*", destination: "/gestor/:clientId/crm", permanent: false },
    { source: "/gestor/:clientId/whatsapp-extensao", destination: "/gestor/whatsapp", permanent: false },
    { source: "/cliente/whatsapp-extensao", destination: "/cliente/agente-ia", permanent: false },
    { source: "/cliente/pousada/:path*", destination: "/cliente/crm", permanent: false },
  ]; },
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
      ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
    ] }];
  },
  // instrumentationHook habilitado por padrão no Next.js 15+
  serverExternalPackages: [
    "sharp",
    "pg",
    "googleapis",
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
