import { headers } from "next/headers";
import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Use the fonts already bundled with our locked Next.js package so builds do not
// depend on Google Fonts being reachable. Both are served by this app.
const geistSans = localFont({
  src: "../../node_modules/next/dist/next-devtools/server/font/geist-latin.woff2",
  weight: "100 900",
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = localFont({
  src: "../../node_modules/next/dist/next-devtools/server/font/geist-mono-latin.woff2",
  weight: "100 900",
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Nexo — Dashboard de Campanhas",
  description: "Dashboard inteligente para gestão de tráfego pago: Meta Ads e Google Ads",
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
    apple: "/favicon.png",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await headers(); // Request-specific CSP nonces must never be served from a static page.
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
