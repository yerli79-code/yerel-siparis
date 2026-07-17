import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "İşletme Girişi | Yerel Sipariş",
  description: "İşletme hesabınıza giriş yapın.",
  robots: {
    index: false,
    follow: true,
  },
};

export default function LoginLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
