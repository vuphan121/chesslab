import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import AuthGate from "@/components/auth/AuthGate";
import ServiceWorkerRegister from "@/components/pwa/ServiceWorkerRegister";
import "./globals.css";

const spaceGrotesk = localFont({
  src: "./fonts/space-grotesk-latin.woff2",
  weight: "300 700",
  display: "swap",
  variable: "--font-sans",
});

const newsreader = localFont({
  src: [
    { path: "./fonts/newsreader-latin.woff2", weight: "400 600", style: "normal" },
    { path: "./fonts/newsreader-italic-latin.woff2", weight: "400 600", style: "italic" },
  ],
  display: "swap",
  variable: "--font-serif",
});

const jetbrainsMono = localFont({
  src: "./fonts/jetbrains-mono-latin.woff2",
  weight: "500 700",
  display: "swap",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Chesslab",
  description: "AI-powered chess opening prep",
  applicationName: "Chesslab",
  appleWebApp: { capable: true, title: "Chesslab", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`h-full ${spaceGrotesk.variable} ${newsreader.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-full flex flex-col">
        <ServiceWorkerRegister />
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
