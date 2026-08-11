import { requireAdmin } from "../../../../lib/admin/auth";
import {
  adminServiceFetch,
  readJsonBody,
} from "../../../../lib/admin/dal";
import { AdminError } from "../../../../lib/admin/errors";
import {
  adminErrorResponse,
  adminJson,
} from "../../../../lib/admin/http";

type BusinessRow = {
  owner_id?: string | null;
  email?: string | null;
  [key: string]: unknown;
};

type ProfileRow = {
  id?: string | null;
  email?: string | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUSINESS_SELECT = [
  "id",
  "owner_id",
  "slug",
  "name",
  "description",
  "whatsapp_order_number",
  "created_at",
  "category",
  "city",
  "district",
  "neighborhood",
  "address",
  "delivery_status",
  "logo_text",
  "subscription_status",
  "subscription_started_at",
  "subscription_expires_at",
  "is_active",
].join(",");

async function fetchBusinesses() {
  const response = await adminServiceFetch(
    `/rest/v1/businesses?select=${BUSINESS_SELECT}&order=created_at.desc`,
  );
  const body = await readJsonBody(response);

  if (!response.ok || !Array.isArray(body)) {
    throw new AdminError(
      "ADMIN_UNAVAILABLE",
      "İşletme listesi alınamadı.",
      503,
    );
  }

  return body as BusinessRow[];
}

async function fetchProfileEmails(ownerIds: string[]) {
  if (ownerIds.length === 0) return new Map<string, string>();

  const response = await adminServiceFetch(
    `/rest/v1/profiles?id=in.(${ownerIds
      .map((id) => encodeURIComponent(id))
      .join(",")})&select=id,email`,
  );
  const body = await readJsonBody(response);

  if (!response.ok || !Array.isArray(body)) {
    return new Map<string, string>();
  }

  return new Map(
    (body as ProfileRow[])
      .filter((profile) => profile.id && profile.email)
      .map((profile) => [profile.id as string, profile.email as string]),
  );
}

async function attachOwnerEmails(businesses: BusinessRow[]) {
  const ownerIds = Array.from(
    new Set(
      businesses
        .map((business) => business.owner_id)
        .filter(
          (ownerId): ownerId is string =>
            typeof ownerId === "string" && UUID_PATTERN.test(ownerId),
        ),
    ),
  );
  const profileEmails = await fetchProfileEmails(ownerIds);

  return businesses.map((business) => ({
    ...business,
    email: business.owner_id ? profileEmails.get(business.owner_id) ?? "" : "",
  }));
}

export async function GET() {
  try {
    await requireAdmin();
    const businesses = await attachOwnerEmails(await fetchBusinesses());
    return adminJson({ businesses });
  } catch (error) {
    return adminErrorResponse(error, "İşletme listesi alınamadı.");
  }
}
