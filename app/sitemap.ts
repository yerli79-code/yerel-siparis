import type { MetadataRoute } from "next";

import { getPublicBusinessSlugs } from "../lib/public-business-server";

const siteUrl = "https://yerelsiparis.com";

export const revalidate = 1800;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const publicBusinessSlugs = await getPublicBusinessSlugs();

  return [
    { url: `${siteUrl}/` },
    ...publicBusinessSlugs.map((slug) => ({
      url: `${siteUrl}/isletme/${encodeURIComponent(slug)}`,
    })),
  ];
}
