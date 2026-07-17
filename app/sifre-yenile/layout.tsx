import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Şifre Yenile | Yerel Sipariş",
  description: "Yerel Sipariş hesabınızın şifresini yenileyin.",
  robots: {
    index: false,
    follow: true,
  },
};

export default function PasswordResetLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
