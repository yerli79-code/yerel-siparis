import BusinessDetailClient from "./business-detail-client";

export default async function AdminBusinessDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <BusinessDetailClient businessId={id} />;
}
