import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicBusinessBySlug } from "../../../lib/public-business-server";
import PublicBusinessPageClient from "./PublicBusinessPageClient";

type BusinessPageProps = {
  params: Promise<{ slug: string }>;
};

function getBusinessDescription(name: string, description: string) {
  const normalizedDescription = description.trim();

  return (
    normalizedDescription ||
    `${name} işletmesinin menü ve sipariş bilgilerini Yerel Sipariş'te inceleyin.`
  );
}

function getCanonicalUrl(slug: string) {
  return `https://yerelsiparis.com/isletme/${encodeURIComponent(slug)}`;
}

export async function generateMetadata({
  params,
}: BusinessPageProps): Promise<Metadata> {
  const { slug } = await params;
  const business = await getPublicBusinessBySlug(slug);

  if (!business) notFound();

  return {
    title: `${business.name} | Yerel Sipariş`,
    description: getBusinessDescription(business.name, business.description),
    alternates: {
      canonical: getCanonicalUrl(business.slug),
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}

export default async function BusinessPage({ params }: BusinessPageProps) {
  const { slug } = await params;
  const business = await getPublicBusinessBySlug(slug);

  if (!business) notFound();

  return (
    <PublicBusinessPageClient
      initialBusiness={business}
      slug={business.slug}
    />
  );
}
