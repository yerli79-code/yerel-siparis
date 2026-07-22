import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://yerelsiparis.com"),
  title: "Yerel Sipariş",
  description:
    "Yerel işletmelerden kolayca sipariş vermenizi sağlayan hızlı ve pratik sipariş platformu.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#127C92",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
