import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "İşletme Paneli | Yerel Sipariş",
  description: "Yerel Sipariş işletme yönetim paneli.",
  robots: {
    index: false,
    follow: true,
  },
};

export default function BusinessPanelLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
