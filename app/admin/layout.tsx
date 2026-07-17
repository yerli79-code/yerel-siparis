import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin Paneli | Yerel Sipariş",
  description: "Yerel Sipariş yönetim paneli.",
  robots: {
    index: false,
    follow: true,
  },
};

export default function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
