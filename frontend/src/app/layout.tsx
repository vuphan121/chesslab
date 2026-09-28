import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Newsreader, JetBrains_Mono } from "next/font/google";
import AuthGate from "@/components/auth/AuthGate";
import ServiceWorkerRegister from "@/components/pwa/ServiceWorkerRegister";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-serif",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["500", "700"],
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
