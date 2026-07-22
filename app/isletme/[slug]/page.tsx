import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getPublicBusinessBySlug,
  type PublicBusiness,
} from "../../../lib/public-business-server";
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

function getNonEmptyValue(value: string | null | undefined) {
  const normalizedValue = value?.trim();
  return normalizedValue || null;
}

function getPublicImageUrl(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const normalizedValue = getNonEmptyValue(value);
    if (!normalizedValue) continue;

    try {
      const url = new URL(normalizedValue);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return normalizedValue;
      }
    } catch {
      // Ignore invalid or relative image URLs.
    }
  }

  return null;
}

function getStructuredAddress(business: PublicBusiness) {
  const streetAddress = getNonEmptyValue(business.address);
  const addressLocality = getNonEmptyValue(business.district);
  const addressRegion = getNonEmptyValue(business.city);

  if (!streetAddress && !addressLocality && !addressRegion) return null;

  return {
    "@type": "PostalAddress",
    ...(streetAddress ? { streetAddress } : {}),
    ...(addressLocality ? { addressLocality } : {}),
    ...(addressRegion ? { addressRegion } : {}),
  };
}

function getBusinessJsonLd(business: PublicBusiness) {
  const canonicalUrl = getCanonicalUrl(business.slug);
  const description = getNonEmptyValue(business.description);
  const image = getPublicImageUrl(
    business.coverImageUrl,
    business.logoUrl,
  );
  const telephone = getNonEmptyValue(business.whatsappOrderNumber);
  const address = getStructuredAddress(business);

  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: business.name,
    url: canonicalUrl,
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
    ...(telephone ? { telephone } : {}),
    ...(address ? { address } : {}),
  };
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

  const businessJsonLd = getBusinessJsonLd(business);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(businessJsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <PublicBusinessPageClient
        initialBusiness={business}
        slug={business.slug}
      />
    </>
  );
}
